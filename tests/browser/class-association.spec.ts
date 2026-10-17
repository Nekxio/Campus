import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';
import type { ModuleDetail } from '../../src/lib/teaching/types.js';

test('saving the selected class persists its association without the intermediate add action', async ({
	page,
	app
}, info) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/modules/nouveau');
	await readyModuleEditor(page);
	await page.getByLabel('Nom du module (obligatoire)', { exact: true }).fill('Association fictive');
	const createdResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/teaching/modules') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
	const created = (await (await createdResponse).json()) as ModuleDetail;
	await expect(page).toHaveURL(app.origin + '/enseignant/modules/' + created.id);
	await readyModuleEditor(page);
	const section = page.getByLabel('Section du module', { exact: true });
	if (await section.isVisible()) await section.selectOption('planning');
	else await page.getByRole('tab', { name: 'Classes et planning', exact: true }).click();
	await page.getByLabel('Classe à associer', { exact: true }).selectOption(app.ids.currentClass);
	const savedResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/teaching/modules/' + created.id) &&
			response.request().method() === 'PATCH'
	);
	await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).click();
	const response = await savedResponse;
	expect(response.status()).toBe(200);
	const saved = (await response.json()) as ModuleDetail;
	await expect(page.getByText('Module enregistré.', { exact: true })).toBeVisible();
	await page.screenshot({
		path: info.outputPath('class-association-after-save.png'),
		fullPage: true
	});
	await info.attach('association-result', {
		body: JSON.stringify({
			sentContexts: response.request().postDataJSON().contexts.length,
			savedContexts: saved.contexts.length
		}),
		contentType: 'application/json'
	});
	expect(saved.contexts).toHaveLength(1);
	expect(saved.contexts[0].classId).toBe(app.ids.currentClass);
	await expect(page.getByText('Classe associée', { exact: true })).toBeVisible();
	const associatedClass = page.getByRole('group', { name: 'Classe associée', exact: true });
	await expect(associatedClass).toHaveAccessibleDescription('B2 Demo · 2026-2027');
	const classLabel = await associatedClass.locator('legend').first().boundingBox();
	const classValue = await associatedClass
		.getByText('B2 Demo · 2026-2027', { exact: true })
		.boundingBox();
	expect(classValue!.y).toBeGreaterThanOrEqual(classLabel!.y + classLabel!.height);
	await expect(associatedClass.locator('[data-slot="badge"]')).toHaveCount(0);
	await expect(page.getByLabel('Classe à associer', { exact: true })).toHaveCount(0);
	await page.reload();
	await readyModuleEditor(page);
	if (await section.isVisible()) await section.selectOption('planning');
	else await page.getByRole('tab', { name: 'Classes et planning', exact: true }).click();
	await expect(page.getByText('Classe associée', { exact: true })).toBeVisible();
	const stored = (await (
		await page.context().request.get(app.origin + '/api/teaching/modules/' + created.id)
	).json()) as ModuleDetail;
	expect(stored.contexts).toHaveLength(1);
	expect(stored.contexts[0].id).toBe(saved.contexts[0].id);
	await page.getByRole('button', { name: 'Ajouter une séance', exact: true }).click();
	await page
		.getByLabel('Intitulé de la séance (obligatoire)', { exact: true })
		.fill('Séance conservée');
	await page.getByLabel('Début (obligatoire)', { exact: true }).fill('2026-10-21T09:00');
	await page.getByLabel('Fin (obligatoire)', { exact: true }).fill('2026-10-21T11:00');
	await expect(
		page.getByRole('button', { name: 'Annuler Séance conservée', exact: true })
	).toBeVisible();
	const lessonResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/teaching/modules/' + created.id) &&
			response.request().method() === 'PATCH'
	);
	await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).click();
	expect((await lessonResponse).status()).toBe(200);
	await expect(
		page.getByRole('button', { name: 'Retirer Séance conservée', exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Ajouter une séance', exact: true }).click();
	await page
		.getByLabel('Intitulé de la séance (obligatoire)', { exact: true })
		.last()
		.fill('Brouillon à annuler');
	const cancel = page.getByRole('button', { name: 'Annuler Brouillon à annuler', exact: true });
	await cancel.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByLabel('Intitulé de la séance (obligatoire)', { exact: true })).toHaveCount(
		1
	);
	await expect(page.getByLabel('Intitulé de la séance (obligatoire)', { exact: true })).toHaveValue(
		'Séance conservée'
	);
	const retained = (await (
		await page.context().request.get(app.origin + '/api/teaching/modules/' + created.id)
	).json()) as ModuleDetail;
	expect(retained.contexts[0].lessons).toHaveLength(1);
	expect(retained.contexts[0].lessons[0].title).toBe('Séance conservée');
	await page.screenshot({
		path: info.outputPath('saved-lesson-and-cancelled-draft.png'),
		fullPage: true
	});
});
