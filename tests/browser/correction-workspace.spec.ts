import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { createDatabase } from '../../src/lib/server/db/index.js';
import * as tables from '../../src/lib/server/db/schema.js';
import { createClass, createModule } from '../../src/lib/server/teaching/service.js';
import { getDetailedCorrection, getRubric, replaceRubric } from '../../src/lib/server/teaching/grading.js';
import { emptyModule } from '../../src/lib/teaching/types.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('criteria retain the workspace while calculation details and submission remain accessible', async ({
	page,
	app
}, info) => {
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	const db = createDatabase(client);
	const contextId = crypto.randomUUID();
	const studentId = crypto.randomUUID();
	const assessmentId = crypto.randomUUID();
	const groupId = crypto.randomUUID();
	try {
		const annualClass = await createClass(db, {
			name: 'Classe fictive · correction',
			academicYear: '2026-2027'
		});
		await db.insert(tables.students).values({ id: studentId, classId: annualClass.id, name: 'Bilal Test' });
		const module = await createModule(db, {
			...emptyModule(),
			title: 'Test UX — espace de correction',
			contexts: [{ id: contextId, classId: annualClass.id, lessons: [] }]
		});
		const initial = await getRubric(db, module.id);
		await replaceRubric(db, module.id, {
			expectedRevision: initial.module.revision,
			assessments: [
				{
					id: assessmentId,
					title: 'Dossier',
					kind: 'other',
					purpose: 'graded',
					groups: [{ id: groupId, title: 'Critères' }],
					lines: [8, 6, 6].map((maxPoints, index) => ({
						id: crypto.randomUUID(),
						groupId,
						label: `Critère ${index + 1}`,
						description: 'Précision de l’analyse et justification des choix présentés.',
						maxPoints
					}))
				}
			],
			results: [
				{
					id: crypto.randomUUID(),
					title: 'Note finale',
					rule: { kind: 'points_ratio', assessmentIds: [assessmentId] }
				}
			],
			contexts: initial.contexts.map((context) => ({
				id: context.id,
				expectedRevision: context.expectedRevision,
				deadlines: []
			}))
		});
	} finally {
		client.close();
	}
	await page.setViewportSize(
		info.project.name === 'desktop' ? { width: 1728, height: 851 } : { width: 375, height: 667 }
	);
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/notation/${contextId}/${studentId}`);
	const last = page.getByRole('textbox', { name: /^Critère 3(?: \(optionnel\))?$/ });
	await expect(last).toBeEnabled();
	await expect(page.getByText('Aucune modification en attente.', { exact: true })).toBeVisible();
	if (info.project.name === 'desktop') {
		await expect(last).toBeInViewport();
		const space = await page.locator('.correction-body').boundingBox();
		const footer = await page.locator('#correction-summary').boundingBox();
		expect(space!.height).toBeGreaterThan(footer!.height * 2);
	}
	await expect(async () => {
		const trigger = page.getByRole('button', { name: 'Modifier la remise', exact: true });
		if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
		await expect(trigger).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 });
	}).toPass({ timeout: 15000 });
	const url = page.getByRole('textbox', { name: 'Lien de la remise (optionnel)', exact: true });
	const save = page.getByRole('button', { name: 'Enregistrer Dossier', exact: true });
	const linkError = 'Renseignez un lien HTTPS valide, sans identifiant ni mot de passe.';
	await url.focus();
	// Assistive or autofill input can update the draft without dispatching change.
	await url.evaluate((field: HTMLInputElement) => {
		field.value = 'http://example.com/remise-test';
		field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
	});
	await url.press('Tab');
	await expect(save).toBeEnabled();
	await page.screenshot({ path: info.outputPath('first-http-submission.png'), fullPage: true });
	await expect(url).toHaveAttribute('aria-invalid', 'true');
	await expect(url).toHaveAccessibleDescription(new RegExp(linkError));
	const feedback = page.getByRole('group', { name: 'Vérifiez la correction', exact: true });
	await expect(feedback).toContainText(linkError);
	for (const colorScheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme });
		await expect
			.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
			.toBe(colorScheme === 'dark');
		await page.screenshot({
			path: info.outputPath(`submission-error-${colorScheme}.png`),
			fullPage: true
		});
		expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
	}
	await page.getByRole('button', { name: 'Modifier la remise', exact: true }).click();
	await expect(url).toHaveCount(0);
	const errorLink = feedback.getByRole('button', {
		name: `Lien de la remise · ${linkError}`,
		exact: true
	});
	await expect(errorLink).toBeVisible();
	await errorLink.focus();
	await page.keyboard.press('Enter');
	await expect(url).toBeFocused();
	await expect(url).toBeInViewport();
	await expect
		.poll(() =>
			url.evaluate((field) => {
				const bounds = field.getBoundingClientRect();
				return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.id;
			})
		)
		.toBe('submission-url');
	await expect(url).toHaveValue('http://example.com/remise-test');
	await expect(url).toHaveAttribute('aria-invalid', 'true');
	await page.screenshot({ path: info.outputPath('submission-error-focused.png') });
	await url.fill('');
	await url.press('Tab');
	await expect(url).not.toHaveAttribute('aria-invalid', 'true');
	await expect(feedback).toHaveCount(0);
	await expect(save).toBeDisabled();
	await last.fill('3');
	let writes = 0;
	page.on('request', (request) => {
		if (request.method() === 'POST' && request.url().endsWith('?/saveAssessment')) writes++;
	});
	const verificationClient = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		const verificationDb = createDatabase(verificationClient);
		const before = await getDetailedCorrection(verificationDb, contextId, studentId);
		const rubric = before.rubric;
		const response = await page.request.patch(
			`${app.origin}/api/teaching/contexts/${contextId}/students/${studentId}/assessments/${assessmentId}`,
			{
				headers: { origin: app.origin },
				data: {
					expectedRevision: 0,
					rubricRevision: rubric.module.revision,
					status: 'to_evaluate',
					submissionUrl: 'http://example.test/submission',
					submittedAt: null,
					latenessDecision: 'automatic',
					scores: rubric.assessments[0].lines.map((line) => ({ lineId: line.id, points: 3 }))
				}
			}
		);
		expect(response.status()).toBe(422);
		expect((await response.json()).fields.submissionUrl).toBeTruthy();
		expect(await getDetailedCorrection(verificationDb, contextId, studentId)).toEqual(before);
		await expect(last).toHaveValue('3');
	} finally {
		verificationClient.close();
	}
	const serverWrites = writes;
	for (const invalidLink of ['not-a-link', 'http://example.com/remise-test']) {
		await url.fill(invalidLink);
		await url.press('Tab');
		await expect(url).toHaveAttribute('aria-invalid', 'true');
		await expect(url).toHaveAccessibleDescription(
			/Renseignez un lien HTTPS valide, sans identifiant ni mot de passe\./
		);
		await expect(save).toBeEnabled();
		await expect(page.locator('.save-state')).toHaveText(
			'Corrigez les champs signalés avant d’enregistrer. Vos saisies sont conservées.'
		);
		await expect(page.getByRole('group', { name: 'Vérifiez la correction', exact: true })).toContainText(
			'Renseignez un lien HTTPS valide, sans identifiant ni mot de passe.'
		);
		await url.focus();
		await expect(url).toBeFocused();
		expect(writes).toBe(serverWrites);
		await expect(url).toHaveValue(invalidLink);
		await expect(last).toHaveValue('3');
	}
	await page.screenshot({ path: info.outputPath('invalid-submission.png'), fullPage: true });
	await page.getByRole('link', { name: 'Voir le barème', exact: true }).click();
	const leaveDialog = page.getByRole('alertdialog');
	await expect(leaveDialog).toBeVisible();
	await leaveDialog.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(url).toHaveValue('http://example.com/remise-test');
	await expect(last).toHaveValue('3');
	await url.fill('https://example.test/submission');
	await expect(url).not.toHaveAttribute('aria-invalid', 'true');
	await expect(feedback).toHaveCount(0);
	await expect(save).toBeEnabled();
	await url.press('Tab');
	await page.getByRole('textbox', { name: /^Critère 1(?: \(optionnel\))?$/ }).fill('0');
	await page.getByRole('textbox', { name: /^Critère 2(?: \(optionnel\))?$/ }).fill('0');
	await page.getByRole('combobox', { name: 'Statut de l’évaluation', exact: true }).selectOption('graded');
	const response = page.waitForResponse(
		(response) => response.request().method() === 'POST' && response.url().endsWith('?/saveAssessment')
	);
	await page.getByRole('button', { name: 'Enregistrer Dossier', exact: true }).click();
	expect((await response).status()).toBe(200);
	await expect(save).toBeDisabled();
	await url.fill('http://example.com/remise-test');
	await url.press('Tab');
	await expect(save).toBeEnabled();
	await url.fill('https://example.test/submission');
	await url.press('Tab');
	await expect(url).not.toHaveAttribute('aria-invalid', 'true');
	await expect(save).toBeDisabled();
	await expect(page.locator('.save-state')).toHaveText('Aucune modification en attente.');
	await last.fill('4');
	await expect(save).toBeEnabled();
	await last.fill('3');
	await expect(save).toBeDisabled();
	const details = page.getByRole('button', { name: 'Détails du bilan', exact: true });
	await details.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('region', { name: 'Détails du bilan', exact: true })).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(
		page.getByRole('button', { name: 'Télécharger le PDF individuel de Bilal Test', exact: true })
	).toBeFocused();
	await page.getByRole('button', { name: 'Détails du bilan', exact: true }).click();
	for (const colorScheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
		await expect
			.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
			.toBe(colorScheme === 'dark');
		await page.screenshot({
			path: info.outputPath(`workspace-${colorScheme}.png`),
			fullPage: true
		});
		expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
	}
});
