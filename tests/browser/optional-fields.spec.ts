import type { Locator, Page } from '@playwright/test';
import { createClient } from '@libsql/client';
import { pathToFileURL } from 'node:url';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';
import { readFormActionCommand, readFormActionReceipt } from './support/form-actions.js';

const expectOptional = async (field: Locator) => {
	await expect(field).toBeVisible();
	await expect(field).toHaveJSProperty('required', false);
	await expect(field).not.toHaveAttribute('aria-required', 'true');
};

const openPrivateComment = async (page: Page) => {
	const field = page.getByRole('textbox', {
		name: 'Commentaire privé du semestre (optionnel)',
		exact: true
	});
	await expect(async () => {
		if (!(await field.isVisible()))
			await page.getByRole('button', { name: 'Commentaire privé du semestre', exact: true }).click();
		await expect(field).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	return field;
};

test('optional module information and private comments stay optional and can be saved empty', async ({ app, page }) => {
	test.setTimeout(360000);
	await activate(page, app);
	const modulePath = `/enseignant/modules/${app.ids.module}`;
	const moduleEndpoint = `${modulePath}?/saveModule`;
	await page.goto(`${app.origin}${modulePath}?contexte=${app.ids.currentContext}`);
	await readyModuleEditor(page);
	const title = page.getByLabel('Nom du module', { exact: true });
	const description = page.getByLabel('Description (optionnel)', { exact: true });
	const objectives = page.getByLabel('Objectifs pédagogiques (optionnel)', { exact: true });
	await expect(title).toHaveJSProperty('required', true);
	await expect(title).toHaveAttribute('aria-required', 'true');
	await expectOptional(description);
	await expectOptional(objectives);
	await expect(description).toHaveAttribute('maxlength', '20000');
	const updatedTitle = `${await title.inputValue()} — informations facultatives`;
	await title.fill(updatedTitle);
	await description.fill('');
	await objectives.fill('');
	const moduleSaved = page.waitForResponse(
		(response) => response.url().endsWith(moduleEndpoint) && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first().click();
	const moduleResponse = await moduleSaved;
	expect(moduleResponse.status()).toBe(200);
	expect(await readFormActionCommand(moduleResponse.request())).toMatchObject({
		description: '',
		objectives: []
	});
	await expect(page.getByText('Module enregistré.', { exact: true })).toBeVisible();
	await page.reload();
	await readyModuleEditor(page);
	await expect(description).toHaveValue('');
	await expect(objectives).toHaveValue('');
	await expectOptional(description);
	await expectOptional(objectives);
	await title.fill('');
	await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first().click();
	await expect(title).toHaveAttribute('aria-invalid', 'true');
	await title.fill(updatedTitle);
	await page.goto(`${app.origin}/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`);
	const comment = await openPrivateComment(page);
	await expectOptional(comment);
	await expect(comment).toHaveAttribute('maxlength', '10000');
	const commentEndpoint = `/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}?/saveComment`;
	const saveComment = async (content: string) => {
		await comment.fill(content);
		const saved = page.waitForResponse(
			(response) => response.url().endsWith(commentEndpoint) && response.request().method() === 'POST'
		);
		await page.getByRole('button', { name: 'Enregistrer le commentaire', exact: true }).click();
		const response = await saved;
		expect(response.status()).toBe(200);
		expect(await readFormActionCommand(response.request())).toMatchObject({ content });
		await expect(page.getByText('Commentaire privé enregistré.', { exact: true })).toBeVisible();
	};
	await saveComment('Commentaire fictif à effacer.');
	await saveComment('');
	await page.reload();
	const reloadedComment = await openPrivateComment(page);
	await expect(reloadedComment).toHaveValue('');
	await expectOptional(reloadedComment);
});

test('correction and comment saves follow their own draft and keep unchanged failed requests retryable', async ({
	app,
	page
}) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`);
	const point = page.getByRole('textbox', { name: 'Total de points', exact: true });
	await expect(point).toBeEnabled();
	const savedPoint = await point.inputValue();
	const changedPoint = String(Number(savedPoint) > 0 ? Number(savedPoint) - 1 : 1);
	const saveCorrection = page.locator('button[type="submit"][form="correction-form"]');
	const comment = await openPrivateComment(page);
	const savedComment = await comment.inputValue();
	const saveComment = page.getByRole('button', { name: 'Enregistrer le commentaire', exact: true });
	await expect(saveCorrection).toBeDisabled();
	await expect(saveComment).toBeDisabled();
	await point.fill(changedPoint);
	await expect(saveCorrection).toBeEnabled();
	await expect(saveComment).toBeDisabled();
	await point.fill(savedPoint);
	await expect(saveCorrection).toBeDisabled();
	await comment.fill(`${savedComment} Commentaire fictif.`);
	await expect(saveComment).toBeEnabled();
	await expect(saveCorrection).toBeDisabled();
	await comment.fill(savedComment);
	await expect(saveComment).toBeDisabled();

	for (const operation of [
		{
			endpoint: '**/enseignant/notation/*/*?/saveAssessment',
			field: point,
			value: changedPoint,
			save: saveCorrection
		},
		{
			endpoint: '**/enseignant/notation/*/*?/saveComment',
			field: comment,
			value: `${savedComment} Commentaire fictif.`,
			save: saveComment
		}
	]) {
		const requests: unknown[] = [];
		await page.route(operation.endpoint, async (route) => {
			requests.push(await readFormActionCommand(route.request()));
			if (requests.length === 1) await route.abort('failed');
			else await route.continue();
		});
		await operation.field.fill(operation.value);
		await operation.save.click();
		await expect(
			page.getByRole('alert').getByText('Connexion interrompue. Vos saisies sont conservées ; réessayez.', {
				exact: true
			})
		).toBeVisible();
		await expect(operation.field).toHaveValue(operation.value);
		await expect(operation.save).toBeEnabled();
		const saved = page.waitForResponse(
			async (response) =>
				response.request().method() === 'POST' &&
				JSON.stringify(await readFormActionCommand(response.request())) === JSON.stringify(requests[0])
		);
		await operation.save.click();
		expect((await saved).status()).toBe(200);
		await expect(operation.save).toBeDisabled();
		expect(requests).toHaveLength(2);
		expect(requests[1]).toEqual(requests[0]);
		await page.unroute(operation.endpoint);
	}
});

test('an empty retained proposal comment is optional and saves without accepting points', async ({ app, page }) => {
	const database = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		const recordedPoints = () =>
			database.execute({
				sql: 'SELECT c.id, c.assessment_id, c.status, c.revision, s.line_id, s.points FROM correction c LEFT JOIN score s ON s.correction_id = c.id WHERE c.context_id = ? AND c.student_id = ? ORDER BY c.id, s.line_id',
				args: [app.ids.currentContext, app.ids.students[0]]
			});
		const before = (await recordedPoints()).rows;
		await activate(page, app);
		await page.goto(
			`${app.origin}/enseignant/propositions?proposition=${app.ids.proposals[0]}&contexte=${app.ids.currentContext}`
		);
		const comment = page.getByRole('textbox', {
			name: 'Commentaire retenu (optionnel)',
			exact: true
		});
		await expect(async () => {
			if (!(await comment.isVisible()))
				await page.getByRole('button', { name: 'Examiner le commentaire', exact: true }).click();
			await expect(comment).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 60000 });
		await expectOptional(comment);
		await expect(comment).toHaveAttribute('maxlength', '10000');
		await comment.fill('');
		const endpoint = '/enseignant/propositions?/decideProposal';
		const saved = page.waitForResponse(
			(response) => response.url().endsWith(endpoint) && response.request().method() === 'POST'
		);
		await page.getByRole('button', { name: 'Reprendre le commentaire', exact: true }).click();
		const response = await saved;
		expect(response.status()).toBe(200);
		const command = await readFormActionCommand<{ decision: unknown }>(response.request());
		expect(command.decision).toMatchObject({
			action: 'accept_comment',
			content: ''
		});
		expect(command.decision).not.toHaveProperty('scores');
		expect(await readFormActionReceipt(response)).toMatchObject({ state: 'pending', commentState: 'accepted' });
		await expect(comment).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Valider les points', exact: true })).toBeEnabled();
		expect((await recordedPoints()).rows).toEqual(before);
		const storedComment = await database.execute({
			sql: 'SELECT content FROM semester_comment WHERE context_id = ? AND student_id = ?',
			args: [app.ids.currentContext, app.ids.students[0]]
		});
		expect(storedComment.rows[0].content).toBe('');
		await page.goto(`${app.origin}/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`);
		await expect(await openPrivateComment(page)).toHaveValue('');
	} finally {
		database.close();
	}
});
