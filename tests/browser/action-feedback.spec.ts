import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Locator, Page, Route } from '@playwright/test';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';
import { fulfillFormAction, readFormActionCommand, readFormActionReceipt } from './support/form-actions.js';

test.beforeEach(({ page }) => {
	page.setDefaultTimeout(15000);
});

const errorToasts = (page: Page) =>
	page.locator('[data-sonner-toast][data-type="error"], [data-sonner-toast][data-type="warning"]');
const successes = (page: Page) => page.locator('[data-sonner-toast][data-type="success"]');
const expectFailureFeedback = async (page: Page, alert: Locator) => {
	await expect(alert).toBeVisible();
	await page.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
	);
	await expect.poll(() => errorToasts(page).count()).toBeGreaterThan(0);
};
async function malformed(route: Route) {
	await route.fulfill({ status: 200, json: {} });
}
async function openNewClass(page: Page) {
	await expect(async () => {
		await page.getByRole('button', { name: 'Nouvelle classe', exact: true }).click();
		await expect(page.getByRole('dialog', { name: 'Nouvelle classe' })).toBeVisible({
			timeout: 1000
		});
	}).toPass({ timeout: 60000 });
	const dialog = page.getByRole('dialog', { name: 'Nouvelle classe' });
	await dialog.getByLabel('Nom de la classe').fill('Classe feedback fictive');
	return dialog;
}

test('profile failures stay inline beyond eight seconds, keep fields and never claim success', async ({
	page,
	app
}) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/compte');
	const name = page.getByRole('textbox', { name: 'Nom et prénom' });
	const save = page.getByRole('button', { name: 'Enregistrer', exact: true });
	await expect(page.getByRole('button', { name: 'Annuler', exact: true })).toBeEnabled();
	await expect(save).toBeDisabled();
	await name.fill('Brouillon feedback conservé');
	const endpoint = '**/enseignant/compte?/updateProfile';
	for (const failure of [422, 401, 409, 500, 'empty', 'json', 'network'] as const) {
		await page.route(endpoint, (route) =>
			failure === 'network'
				? route.abort('failed')
				: failure === 'json'
					? route.fulfill({ status: 200, body: '{invalid', contentType: 'application/json' })
					: failure === 'empty'
						? malformed(route)
						: fulfillFormAction(route, {
								status: failure,
								message: 'Échec fictif conservé',
								fields: { name: 'Nom fictif à vérifier' }
							})
		);
		await save.click();
		if (failure === 422) {
			await expect(name).toHaveAttribute('aria-invalid', 'true');
			await expect(name).toHaveAttribute('aria-describedby', /(?:^|\s)profile-full-name-error(?:\s|$)/);
			await expect(name).toBeFocused();
		} else {
			await expectFailureFeedback(page, page.getByRole('alert'));
			await expect(page.getByRole('alert')).toBeFocused();
		}
		await expect(name).toHaveValue('Brouillon feedback conservé');
		await expect(successes(page)).toHaveCount(0);
		await page.unroute(endpoint);
	}
	await page.waitForTimeout(8500);
	await expect(page.getByRole('alert')).toBeVisible();
	for (const width of [320, 390, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme });
			await expect(page.getByRole('alert')).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		}
	}
	await save.click();
	await expect(successes(page).filter({ hasText: 'Votre nom a été enregistré.' })).toHaveCount(1);
});

test('class, roster import, edit, deletion and attachment close only after decoded receipts', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/classes');
	const dialog = await openNewClass(page);
	await page.route('**/enseignant/classes?/createClass', malformed);
	await dialog.getByRole('button', { name: 'Créer la classe', exact: true }).click();
	await expectFailureFeedback(page, dialog.getByRole('alert'));
	await expect(dialog.getByLabel('Nom de la classe')).toHaveValue('Classe feedback fictive');
	await expect(successes(page).filter({ hasText: 'La classe a été créée.' })).toHaveCount(0);
	await page.unroute('**/enseignant/classes?/createClass');
	await dialog.getByRole('button', { name: 'Créer la classe', exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await expect(page.getByRole('heading', { name: 'Classe feedback fictive', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Importer une liste', exact: true }).click();
	const roster = page.getByRole('dialog', { name: 'Importer les étudiants' });
	await roster.getByLabel('Liste des étudiants', { exact: true }).fill('Étudiant feedback fictif');
	const rosterEndpoint = '**/enseignant/classes?/importStudents';
	await page.route(rosterEndpoint, malformed);
	await roster.getByRole('button', { name: 'Ajouter 1 étudiant', exact: true }).click();
	await expectFailureFeedback(page, roster.getByRole('alert'));
	await expect(roster.getByLabel('Liste des étudiants', { exact: true })).toHaveValue('Étudiant feedback fictif');
	await page.unroute(rosterEndpoint);
	await roster.getByRole('button', { name: 'Ajouter 1 étudiant', exact: true }).click();
	await expect(roster).not.toBeVisible();
	await page.getByRole('button', { name: 'Modifier Étudiant feedback fictif', exact: true }).click();
	const edit = page.getByRole('dialog', { name: 'Modifier le nom', exact: true });
	await edit.getByLabel('Nom complet', { exact: true }).fill('Étudiant renommé fictif');
	const studentEndpoint = '**/enseignant/classes?/updateStudent';
	await page.route(studentEndpoint, malformed);
	await edit.getByRole('button', { name: 'Enregistrer le nom', exact: true }).click();
	await expectFailureFeedback(page, edit.getByRole('alert'));
	await page.unroute(studentEndpoint);
	await edit.getByRole('button', { name: 'Enregistrer le nom', exact: true }).click();
	await expect(edit).not.toBeVisible();
	await page.getByRole('button', { name: 'Supprimer Étudiant renommé fictif' }).click();
	const deletion = page.getByRole('alertdialog');
	await page.route('**/enseignant/classes?/removeStudent', malformed);
	await deletion.getByRole('button', { name: 'Supprimer définitivement', exact: true }).click();
	await expectFailureFeedback(page, deletion.getByRole('alert'));
	await expect(deletion).toBeVisible();
	await page.unroute('**/enseignant/classes?/removeStudent');
	await deletion.getByRole('button', { name: 'Supprimer définitivement', exact: true }).click();
	await expect(deletion).not.toBeVisible();
	await page.getByRole('button', { name: 'Rattacher un module', exact: true }).click();
	const attachment = page.getByRole('dialog', { name: 'Rattacher un module', exact: true });
	await attachment.getByLabel('Module à rattacher').selectOption(app.ids.module);
	const attachmentEndpoint = '**/enseignant/classes?/attachModule';
	await page.route(attachmentEndpoint, malformed);
	await attachment.getByRole('button', { name: 'Rattacher le module', exact: true }).click();
	await expectFailureFeedback(page, attachment.getByRole('alert'));
	await page.unroute(attachmentEndpoint);
	const attached = page.waitForResponse(
		(r) => r.url().includes('/enseignant/classes?/attachModule') && r.request().method() === 'POST'
	);
	await attachment.getByRole('button', { name: 'Rattacher le module', exact: true }).click();
	const receipt = await readFormActionReceipt(await attached);
	expect(receipt.moduleId).not.toBe(app.ids.module);
	await expect(attachment).not.toBeVisible();
	await expect(successes(page).filter({ hasText: 'Le module a été rattaché à la classe.' })).toHaveCount(1);
});

test('long roster saved mutations close before refresh feedback and keep the final focus reachable', async ({
	page,
	app
}) => {
	const file = join(app.manifest.directory, 'src/lib/components/teaching/ClassesWorkspace.svelte');
	const source = await readFile(file, 'utf8');
	const refresh = '\t\t\tawait refreshAll();';
	expect(source).toContain(refresh);
	// Only this disposable copy fails the post-save refresh; mutations use the real fictional server.
	await writeFile(
		file,
		source.replace(
			refresh,
			'\t\t\tif (Reflect.get(window, "fictionalRosterRefreshFailure")) throw new Error("Fictional refresh interruption");\n' +
				refresh
		)
	);
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/classes?classe=' + app.ids.currentClass);
	const importButton = page.getByRole('button', { name: 'Importer une liste', exact: true });
	const importDialog = page.getByRole('dialog', { name: 'Importer les étudiants', exact: true });
	await expect(async () => {
		await importButton.click();
		await expect(importDialog).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	const names = Array.from({ length: 60 }, (_, i) => `Étudiant fictif ${String(i).padStart(2, '0')}`);
	await importDialog.getByLabel('Liste des étudiants', { exact: true }).fill(names.join('\n'));
	await importDialog.getByRole('button', { name: 'Ajouter 60 étudiants', exact: true }).click();
	await expect(importDialog).not.toBeVisible();
	await expect(importButton).toBeFocused();
	await expect(page.locator('#class-roster tbody tr')).toHaveCount(72);
	await expect(successes(page).filter({ hasText: '60 étudiants ajoutés.' })).toHaveCount(1);

	for (const mode of ['add', 'import', 'edit'] as const) {
		const opener =
			mode === 'edit'
				? page.getByRole('button', { name: 'Modifier ' + names[59], exact: true })
				: mode === 'import'
					? importButton
					: page.getByRole('button', { name: 'Ajouter un étudiant', exact: true });
		if (mode === 'edit') {
			await opener.scrollIntoViewIfNeeded();
			await expect(page.getByRole('heading', { name: 'Mes classes', exact: true })).not.toBeInViewport();
		}
		await opener.click();
		const dialog = page.getByRole('dialog', {
			name: mode === 'edit' ? 'Modifier le nom' : mode === 'import' ? 'Importer les étudiants' : 'Ajouter un étudiant',
			exact: true
		});
		await expect(dialog).toBeVisible();
		const name = 'Étudiant confirmé après ' + mode;
		await dialog.getByLabel(mode === 'import' ? 'Liste des étudiants' : 'Nom complet', { exact: true }).fill(name);
		await page.evaluate(() => Reflect.set(window, 'fictionalRosterRefreshFailure', true));
		const response = page.waitForResponse(
			(r) =>
				r
					.url()
					.includes(
						'/enseignant/classes?/' +
							(mode === 'edit' ? 'updateStudent' : mode === 'import' ? 'importStudents' : 'addStudent')
					) && r.request().method() === 'POST'
		);
		await dialog
			.getByRole('button', {
				name: mode === 'edit' ? 'Enregistrer le nom' : mode === 'import' ? 'Ajouter 1 étudiant' : 'Ajouter l’étudiant',
				exact: true
			})
			.click();
		const saved = await response;
		expect(saved.ok()).toBe(true);
		const receipt = await readFormActionReceipt(saved);
		if (mode === 'edit') expect(receipt.id).toEqual(expect.any(String));
		else expect(receipt).toMatchObject({ added: 1, skipped: 0 });
		await expect(dialog).not.toBeVisible();
		const alert = page.getByRole('alert').filter({ hasText: 'Actualisation nécessaire' });
		await expectFailureFeedback(page, alert);
		await expect(alert).toContainText('La modification est enregistrée');
		await expect(alert).toBeFocused();
		await expect(alert).toBeInViewport({ ratio: 1 });
		expect(await alert.evaluate((element) => element.closest('[inert], [aria-hidden="true"]') === null)).toBe(true);
		await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
		await expect(alert).toBeFocused();
		const confirmation =
			mode === 'edit'
				? 'Le nom de l’étudiant a été enregistré.'
				: mode === 'import'
					? '1 étudiant ajouté.'
					: 'L’étudiant a été ajouté à la classe.';
		await expect(successes(page).filter({ hasText: confirmation })).toHaveCount(1);
		await page.evaluate(() => Reflect.set(window, 'fictionalRosterRefreshFailure', false));
		await alert.getByRole('button', { name: 'Actualiser la liste', exact: true }).click();
		await expect(alert).not.toBeVisible();
		await expect(page.getByRole('button', { name: 'Modifier ' + name, exact: true })).toBeVisible();
	}
});

test('a lost module creation retries the identical UUID and draft after a malformed 200', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/modules/nouveau');
	await readyModuleEditor(page);
	const title = page.getByLabel('Nom du module', { exact: true });
	await title.fill('Création feedback fictive');
	const commands: { id: string; body: unknown }[] = [];
	await page.route('**/enseignant/modules/nouveau?/createModule', async (route) => {
		const command = await readFormActionCommand<{ id: string; draft: unknown }>(route.request());
		commands.push({ id: command.id, body: command.draft });
		if (commands.length === 1) {
			await route.fetch();
			await route.abort('failed');
		} else if (commands.length === 2) await malformed(route);
		else await route.continue();
	});
	for (let attempt = 0; attempt < 2; attempt++) {
		await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
		await expectFailureFeedback(page, page.getByRole('alert'));
		await expect(title).toHaveValue('Création feedback fictive');
		await expect(successes(page).filter({ hasText: 'Brouillon créé.' })).toHaveCount(0);
	}
	await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
	await expect(page).toHaveURL(app.origin + '/enseignant/modules/' + commands[0].id);
	expect(commands).toHaveLength(3);
	expect(commands[1]).toEqual(commands[0]);
	expect(commands[2]).toEqual(commands[0]);
});

test('a real module save with failed navigation keeps its confirmed warning inline', async ({ page, app }) => {
	// Fault injection belongs only to this disposable fictional copy, never application source.
	const file = join(app.manifest.directory, 'src/lib/components/teaching/ModuleDraftEditor.svelte');
	const source = await readFile(file, 'utf8');
	const navigation = 'await goto(createdDestination, { state: { ...page.state, createdModuleId: saved.id } });';
	expect(source).toContain(navigation);
	await writeFile(file, source.replace(navigation, "throw new Error('Fictional navigation interruption');"));
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/modules/nouveau');
	await readyModuleEditor(page);
	await page.getByLabel('Nom du module', { exact: true }).fill('Navigation feedback fictive');
	await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
	const warning = page
		.getByRole('alert')
		.filter({ hasText: 'Brouillon créé. Vous pouvez continuer à le modifier ici.' });
	await expectFailureFeedback(page, warning);
	await page.waitForTimeout(8500);
	await expect(warning).toBeVisible();
	const save = page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first();
	await expect(save).toBeDisabled();
	await page.getByLabel('Nom du module', { exact: true }).fill('Navigation feedback modifiée');
	await expect(save).toBeEnabled();
});

test('rubric malformed success preserves the draft and local removal is information, not a server success', async ({
	page,
	app
}) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/modules/' + app.ids.module + '/bareme');
	const tabs = page.getByRole('tablist', { name: 'Sections du module' }).getByRole('tab');
	await expect(async () => {
		await tabs.nth(1).click();
		await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await tabs.first().click();
	const title = page.getByLabel('Nom de la section', { exact: true }).filter({ visible: true });
	await expect(title).toBeVisible();
	await title.fill('Section feedback fictive');
	const endpoint = '**/enseignant/modules/' + app.ids.module + '/bareme?/saveRubric';
	await page.route(endpoint, malformed);
	await page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).first().click();
	await expectFailureFeedback(page, page.getByRole('alert').filter({ hasText: 'Vérifiez le barème' }));
	await expect(title).toHaveValue('Section feedback fictive');
	await expect(page.getByText('Enregistrement non confirmé. Réessayez.', { exact: true })).toBeVisible();
	await page.unroute(endpoint);
	const save = page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).first();
	await save.focus();
	await save.press('Enter');
	await expect(successes(page).filter({ hasText: 'Barème enregistré.' })).toHaveCount(1);
	await page.getByRole('button', { name: 'Retirer la section', exact: true }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Retirer du brouillon', exact: true }).click();
	await expect(
		page.locator('[data-sonner-toast][data-type="info"]').filter({ hasText: 'Section retirée du brouillon.' })
	).toHaveCount(1);
	await expect(save).toBeEnabled();
	await expect(page.getByRole('tab', { name: /^Section feedback fictive/ })).toHaveCount(0);
});

test('correction and comment failures preserve independent drafts until their complete receipts', async ({
	page,
	app
}) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`);
	await expect(async () => {
		await page.getByLabel('Évaluation', { exact: true }).selectOption({ label: 'Projet' });
		await expect(page.getByRole('button', { name: 'Enregistrer Projet', exact: true })).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	const points = page.getByLabel(/^Navigation(?: \(optionnel\))?$/, { exact: true });
	await expect(points).toBeEnabled();
	await points.fill('1');
	const correctionEndpoint = '**/enseignant/notation/*/*?/saveAssessment';
	await page.route(correctionEndpoint, malformed);
	await page.getByRole('button', { name: 'Enregistrer Projet', exact: true }).click();
	await expectFailureFeedback(page, page.getByRole('alert').filter({ hasText: 'Vérifiez la correction' }));
	await expect(points).toHaveValue('1');
	await page.getByRole('button', { name: 'Commentaire privé du semestre', exact: true }).click();
	const comment = page.getByRole('textbox', {
		name: 'Commentaire privé du semestre (optionnel)',
		exact: true
	});
	await comment.fill('Commentaire feedback fictif');
	const commentEndpoint = '**/enseignant/notation/*/*?/saveComment';
	const commands: unknown[] = [];
	await page.route(commentEndpoint, async (route) => {
		commands.push(await readFormActionCommand(route.request()));
		await malformed(route);
	});
	await page.getByRole('button', { name: 'Enregistrer le commentaire', exact: true }).click();
	await expectFailureFeedback(page, page.getByRole('alert').filter({ hasText: 'Vérifiez la correction' }));
	await expect(comment).toHaveValue('Commentaire feedback fictif');
	await expect(page.getByText('Commentaire non enregistré', { exact: true })).toBeVisible();
	await expect(successes(page).filter({ hasText: 'Commentaire privé enregistré.' })).toHaveCount(0);
	await page.unroute(commentEndpoint);
	const savedComment = page.waitForRequest((r) => r.url().endsWith('?/saveComment') && r.method() === 'POST');
	await page.getByRole('button', { name: 'Enregistrer le commentaire', exact: true }).click();
	expect(await readFormActionCommand(await savedComment)).toEqual(commands[0]);
	await expect(successes(page).filter({ hasText: 'Commentaire privé enregistré.' })).toHaveCount(1);
	await expect(points).toHaveValue('1');
	await expect(page.getByRole('button', { name: 'Enregistrer Projet', exact: true })).toBeEnabled();
	await page.unroute(correctionEndpoint);
	await page.getByRole('button', { name: 'Enregistrer Projet', exact: true }).click();
	await expect(successes(page).filter({ hasText: 'Projet enregistré.' })).toHaveCount(1);
});

test('proposal with selection keeps its parent error visible and has no duplicate toast', async ({ page, app }) => {
	const file = join(app.manifest.directory, 'src/lib/components/grading/ProposalReview.svelte');
	const source = await readFile(file, 'utf8');
	const initial = "let errorMessage = $state('');";
	expect(source).toContain(initial);
	await writeFile(file, source.replace(initial, "let errorMessage = $state('Erreur parent fictive conservée.');"));
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/propositions?proposition=' + app.ids.proposals[0]);
	await expect(page.locator('#proposal-points-form')).toBeVisible();
	await expect(page.getByRole('alert').filter({ hasText: 'Erreur parent fictive conservée.' })).toBeVisible();
	await expect(errorToasts(page)).toHaveCount(0);
});

test('proposal decision malformed response retains selection, points, comment and retry UUID', async ({
	page,
	app
}) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/propositions?proposition=' + app.ids.proposals[0]);
	await expect(async () => {
		await page.getByRole('button', { name: 'Examiner le commentaire', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Refermer le commentaire', exact: true })).toHaveAttribute(
			'aria-expanded',
			'true',
			{ timeout: 1000 }
		);
	}).toPass({ timeout: 60000 });
	const comment = page.getByRole('textbox', {
		name: 'Commentaire retenu (optionnel)',
		exact: true
	});
	await comment.fill('Commentaire retenu feedback fictif');
	const endpoint = '**/enseignant/propositions?/decideProposal';
	const commands: unknown[] = [];
	await page.route(endpoint, async (route) => {
		commands.push(await readFormActionCommand(route.request()));
		if (commands.length === 1) await malformed(route);
		else await route.continue();
	});
	await page.getByRole('button', { name: 'Valider les points', exact: true }).click();
	await expectFailureFeedback(page, page.getByRole('alert').filter({ hasText: 'Décision à vérifier' }));
	await expect(comment).toHaveValue('Commentaire retenu feedback fictif');
	await expect(successes(page).filter({ hasText: 'Points retenus enregistrés.' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Valider les points', exact: true }).click();
	await expect(successes(page).filter({ hasText: 'Points retenus enregistrés.' })).toHaveCount(1);
	expect(commands[1]).toEqual(commands[0]);
	await expect(comment).toHaveValue('Commentaire retenu feedback fictif');
	await expect(page.getByRole('button', { name: 'Reprendre le commentaire', exact: true })).toBeEnabled();
});

test('publication invalid 200 and 409 keep the reviewed preview until an explicit refresh', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}/publication?contexte=${app.ids.currentContext}`);
	const endpoint = '**/enseignant/modules/' + app.ids.module + '/publication?/decidePublication';
	const publish = page.locator('.publication-scope').getByRole('button', {
		name: /Publier pour cette classe|Publier la mise à jour/
	});
	await expect(publish).toBeEnabled();
	const preview = await page.locator('.preview-content').textContent();
	await page.route(endpoint, malformed);
	await publish.click();
	await expectFailureFeedback(page, page.getByRole('alert').filter({ hasText: 'Publication interrompue' }));
	await expect(successes(page).filter({ hasText: 'La page du module est publiée.' })).toHaveCount(0);
	await page.unroute(endpoint);
	await page.route(endpoint, (route) =>
		fulfillFormAction(route, { status: 409, message: 'Conflit fictif de publication' })
	);
	await publish.click();
	await expectFailureFeedback(page, page.getByRole('alert').filter({ hasText: 'Version à vérifier de nouveau' }));
	expect(await page.locator('.preview-content').textContent()).toBe(preview);
	await expect(publish).toBeDisabled();
	await page.unroute(endpoint);
	await page.getByRole('button', { name: 'Actualiser les références', exact: true }).first().click();
	await expect(publish).toBeEnabled();
	await publish.click();
	await expect(successes(page).filter({ hasText: 'La page du module est publiée.' })).toHaveCount(1);
});

test('class and individual PDF failures remain inline and only a validated export downloads', async ({ page, app }) => {
	await app.call('complete-class');
	await activate(page, app);
	let downloads = 0;
	page.on('download', () => downloads++);
	for (const individual of [false, true]) {
		await page.goto(
			individual
				? `${app.origin}/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`
				: `${app.origin}/enseignant/notation?module=${app.ids.module}&contexte=${app.ids.currentContext}`
		);
		if (individual) {
			await expect(async () => {
				const details = page.getByRole('button', { name: 'Détails du bilan', exact: true });
				if (!(await page.getByRole('region', { name: 'Détails du bilan', exact: true }).isVisible()))
					await details.click();
				await expect(page.getByRole('region', { name: 'Détails du bilan', exact: true })).toBeVisible({
					timeout: 1000
				});
			}).toPass({ timeout: 60000 });
		}
		const button = page.getByRole('button', {
			name: individual ? 'Télécharger le PDF individuel de Aline Moreau' : 'Télécharger le PDF',
			exact: true
		});
		await expect(button).toBeEnabled();
		const endpoint = individual ? '**/api/teaching/contexts/*/students/*/export' : '**/api/teaching/contexts/*/export';
		await page.route(endpoint, malformed);
		await button.click();
		await expectFailureFeedback(
			page,
			page.getByRole('alert').filter({ hasText: individual ? 'PDF individuel indisponible' : 'PDF indisponible' })
		);
		expect(downloads).toBe(individual ? 1 : 0);
		await page.unroute(endpoint);
		const downloaded = page.waitForEvent('download');
		await button.click();
		await downloaded;
		await expect(
			successes(page).filter({
				hasText: individual ? 'PDF individuel préparé.' : 'PDF préparé pour les 12 étudiants'
			})
		).toHaveCount(1);
	}
});

test('annual PDF/history failures and lost archive response preserve the exact reviewed retry', async ({
	page,
	app
}) => {
	await app.call('complete-class');
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/classes/annees?annee=2026-2027');
	await expect(page.getByRole('button', { name: 'Archiver sans supprimer', exact: true })).toBeEnabled();
	await page.getByRole('button', { name: 'Archiver sans supprimer', exact: true }).click();
	const history = page.locator(`[aria-controls="annual-history-${app.ids.currentContext}"]`);
	await expect(history).toBeEnabled();
	await page.route('**/api/teaching/years/*/contexts/*', malformed);
	await history.click();
	await expectFailureFeedback(page, page.getByRole('alert').filter({ hasText: 'Historique indisponible' }));
	const pdf = page.locator('button[aria-label^="Télécharger le PDF"]:enabled').first();
	await expect(pdf).toBeEnabled();
	await page.route('**/api/teaching/contexts/*/export', malformed);
	await pdf.click();
	await expectFailureFeedback(page, page.getByRole('alert').filter({ hasText: 'PDF indisponible' }));
	const commands: { body: unknown; key: string }[] = [];
	await page.route('**/enseignant/classes/annees?/decideYear', async (route) => {
		const command = await readFormActionCommand<{ requestId: string }>(route.request());
		commands.push({ body: command, key: command.requestId });
		if (commands.length === 1) {
			await route.fetch();
			await route.abort('failed');
		} else await route.continue();
	});
	await page.getByRole('button', { name: 'Archiver 2026-2027', exact: true }).click();
	await expectFailureFeedback(page, page.getByRole('alert').filter({ hasText: 'Résultat de la demande à vérifier' }));
	await expect(successes(page).filter({ hasText: 'est archivée' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Réessayer la même demande', exact: true }).click();
	await expect(successes(page).filter({ hasText: 'est archivée' })).toHaveCount(1);
	expect(commands).toHaveLength(2);
	expect(commands[1]).toEqual(commands[0]);
});

test('activation and sign-in reject malformed verification responses without navigation success', async ({
	page,
	app,
	context
}) => {
	const cdp = await context.newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});
	await page.goto(app.origin + '/activation');
	await expect(page.getByText('Invitation introuvable', { exact: true })).toBeVisible();
	await page.evaluate((token) => {
		window.location.hash = 'token=' + token;
	}, app.invitation);
	const create = page.getByRole('button', { name: 'Créer ma clé d’accès', exact: true });
	await expect(create).toBeEnabled();
	await page.route('**/api/auth/passkey/verify-registration', malformed);
	await create.click();
	await expectFailureFeedback(page, page.getByRole('alert'));
	await expect(page).toHaveURL(app.origin + '/activation');
	await expect(successes(page)).toHaveCount(0);
	await page.unroute('**/api/auth/passkey/verify-registration');
	await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
	await cdp.detach();
	await activate(page, app);
	await context.request.post(app.origin + '/api/auth/sign-out', {
		headers: { Origin: app.origin },
		data: {}
	});
	await page.goto(app.origin + '/connexion');
	await page.route('**/api/auth/passkey/verify-authentication', malformed);
	await page.getByRole('button', { name: 'Me connecter', exact: true }).click();
	await expectFailureFeedback(page, page.getByRole('alert'));
	await expect(page).toHaveURL(app.origin + '/connexion');
	await expect(successes(page)).toHaveCount(0);
	await page.unroute('**/api/auth/passkey/verify-authentication');
	await page.getByRole('button', { name: 'Me connecter', exact: true }).click();
	await expect(page).toHaveURL(app.origin + '/');
});

test('consent and revocation require their real response contracts before success', async ({ page, app, request }) => {
	await activate(page, app);
	const callback = 'http://127.0.0.1:47913/callback';
	// Native client registration uses the anonymous request context, as in remote-access.spec.ts.
	const registered = await request.post(app.origin + '/api/auth/oauth2/register', {
		data: {
			client_name: 'Feedback fictif',
			redirect_uris: [callback],
			token_endpoint_auth_method: 'none',
			application_type: 'native',
			grant_types: ['authorization_code'],
			response_types: ['code']
		}
	});
	expect(registered.status()).toBe(201);
	const clientId = (await registered.json()).client_id as string;
	const query = new URLSearchParams({
		client_id: clientId,
		redirect_uri: callback,
		response_type: 'code',
		scope: 'modules:read',
		resource: app.origin + '/mcp',
		state: 'fictitious-feedback-state',
		code_challenge: createHash('sha256').update('fictitious-feedback-verifier'.repeat(4)).digest('base64url'),
		code_challenge_method: 'S256',
		prompt: 'consent'
	});
	const authorized = await page.request.get(app.origin + '/api/auth/oauth2/authorize?' + query, {
		maxRedirects: 0
	});
	expect(authorized.status()).toBe(302);
	await page.goto(new URL(authorized.headers().location, app.origin).href);
	await expect(page.locator('form[action*="/decideConsent"]')).toHaveAttribute('data-enhanced', 'true');
	await page.route('**/autoriser?**/decideConsent', (route) =>
		fulfillFormAction(route, { receipt: { url: 'javascript:alert(1)' } })
	);
	await page.getByRole('button', { name: 'Autoriser Feedback fictif', exact: true }).click();
	await expectFailureFeedback(page, page.getByRole('alert'));
	await expect(successes(page)).toHaveCount(0);
	await page.unroute('**/autoriser?**/decideConsent');
	// The callback is fulfilled locally; no client service or external request is started.
	await page.route(callback + '**', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><html lang="fr"><title>Client fictif</title><p>Décision reçue.</p></html>'
		})
	);
	await page.getByRole('button', { name: 'Autoriser Feedback fictif', exact: true }).click();
	await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:47913\/callback\?/);
	await page.goto(app.origin + '/enseignant/applications');
	await expect(page.locator('form[action="?/revokeApplication"]')).toHaveAttribute('data-enhanced', 'true');
	await page.locator('summary', { hasText: 'Révoquer l’accès' }).click();
	const revoke = page.getByRole('button', { name: 'Révoquer l’accès', exact: true });
	await page.route('**/enseignant/applications?/revokeApplication', malformed);
	await revoke.click();
	await expectFailureFeedback(page, page.getByRole('alert'));
	await expect(page.getByText('Autorisation accordée', { exact: true })).toBeVisible();
	await expect(successes(page).filter({ hasText: 'a été révoqué' })).toHaveCount(0);
	await page.unroute('**/enseignant/applications?/revokeApplication');
	await revoke.click();
	await expect(page.getByRole('heading', { name: 'Aucune application autorisée' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Applications connectées', exact: true })).toBeFocused();
	await expect(successes(page).filter({ hasText: 'a été révoqué' })).toHaveCount(1);
});

test('sign-out failure keeps one persistent dismissible toast when navigation reopens', async ({ page, app }) => {
	await activate(page, app);
	const toggle = page.locator('#sidebar-toggle');
	const menu = page.getByRole('button', {
		name: 'Menu utilisateur de Teacher Browser Demo',
		exact: true
	});
	await expect(async () => {
		if (!(await menu.isVisible())) await toggle.click();
		await expect(menu).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await expect(async () => {
		await menu.click();
		await expect(page.getByRole('menuitem', { name: 'Se déconnecter', exact: true })).toBeVisible({
			timeout: 1000
		});
	}).toPass({ timeout: 60000 });
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route('**/api/auth/sign-out', async (route) => {
		await gate;
		await malformed(route);
	});
	await page.getByRole('menuitem', { name: 'Se déconnecter', exact: true }).click();
	if (await menu.isVisible()) {
		if ((page.viewportSize()?.width ?? 1440) < 768) await page.keyboard.press('Escape');
		else await toggle.click();
	}
	release();
	const toast = page.locator('[data-sonner-toast][data-type="error"]');
	await expect(toast).toHaveCount(1);
	await page.waitForTimeout(8500);
	await expect(toast).toBeVisible();
	await expect(successes(page).filter({ hasText: 'Vous êtes déconnecté.' })).toHaveCount(0);
	await page.keyboard.press('Alt+t');
	await expect(page.locator('[data-sonner-toaster]')).toBeFocused();
	await expect(toast.getByRole('button', { name: 'Fermer la notification' })).toBeVisible();
	await toggle.click();
	await expectFailureFeedback(page, page.getByRole('alert').filter({ hasText: 'Déconnexion non aboutie' }));
	await page.unroute('**/api/auth/sign-out');
	await menu.click();
	await page.getByRole('menuitem', { name: 'Se déconnecter', exact: true }).click();
	await expect(page).toHaveURL(app.origin + '/connexion');
	await expect(successes(page).filter({ hasText: 'Vous êtes déconnecté.' })).toHaveCount(1);
});
