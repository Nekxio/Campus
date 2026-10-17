import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';

test('publication snapshot stays stable while a private module draft changes', async ({
	app,
	page,
	request
}) => {
	const path = app.origin + '/modules/' + app.ids.publicationContext;
	const before = await request.get(path + '/__data.json');
	expect(before.ok()).toBe(true);
	const snapshot = await before.text();
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/modules/' + app.ids.publicationModule);
	await readyModuleEditor(page);
	await page
		.getByLabel('Nom du module (obligatoire)', { exact: true })
		.fill('PRIVATE_UNPUBLISHED_TITLE_MARKER');
	await page
		.getByLabel('Objectifs pédagogiques', { exact: true })
		.fill('Fictional changed objective');
	const saved = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/teaching/modules/' + app.ids.publicationModule) &&
			response.request().method() === 'PATCH'
	);
	await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).click();
	expect((await saved).status()).toBe(200);
	const after = await request.get(path + '/__data.json');
	expect(await after.text()).toBe(snapshot);
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`
	);
	await expect(
		page.getByText('Titre, description ou objectifs modifiés', { exact: true })
	).toBeVisible();
	await expect(page.locator('.preview-content')).toContainText('Fictional changed objective');
	await page.goto(path);
	await expect(
		page.getByRole('heading', { name: 'Application web · publication démo', exact: true })
	).toBeVisible();
	expect(await page.content()).not.toContain('PRIVATE_UNPUBLISHED_TITLE_MARKER');
});
