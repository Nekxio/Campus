import { chmod } from 'node:fs/promises';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';
import { readPdfText } from './support/pdf.js';

test('individual PDF and public exercises use the real private and public workflows', async ({
	app,
	page,
	request
}, info) => {
	test.setTimeout(360000);
	await activate(page, app);
	await page.goto(
		`${app.origin}/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`
	);
	const individual = page.getByRole('button', {
		name: 'Télécharger le PDF individuel de Aline Moreau',
		exact: true
	});
	await expect(individual).toBeEnabled({ timeout: 60000 });
	await page.screenshot({ path: info.outputPath('individual-correction.png'), fullPage: true });
	const downloaded = page.waitForEvent('download', { timeout: 30000 });
	await individual.focus();
	await page.keyboard.press('Enter');
	const path = info.outputPath('individual.pdf');
	await (await downloaded).saveAs(path);
	await chmod(path, 0o600);
	const text = await readPdfText(path);
	expect(text).toContain('Aline Moreau');
	expect(text).toContain('Navigation');
	expect(text).toContain('Maximum');
	expect(text).not.toMatch(/Camille Demo|PRIVATE_BROWSER_COMMENT_MARKER|private-submission-marker/);
	const roster = await app.call<{ names: string[]; results: string[] }>('complete-class');
	await page.goto(
		`${app.origin}/enseignant/notation?module=${app.ids.module}&contexte=${app.ids.currentContext}`
	);
	await expect(async () => {
		await page.getByLabel('Rechercher un étudiant', { exact: true }).fill(roster.names[0]);
		await expect(page.getByText(/1 \/ 12 étudiants/)).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	const classDownload = page.waitForEvent('download', { timeout: 30000 });
	await page.getByRole('button', { name: 'Télécharger le PDF', exact: true }).click();
	const classPath = info.outputPath('class.pdf');
	await (await classDownload).saveAs(classPath);
	await chmod(classPath, 0o600);
	const classText = await readPdfText(classPath);
	for (const name of roster.names) expect(classText).toContain(name);
	for (const result of roster.results) expect(classText).toContain(result);
	expect(classText).toContain('Projet /20');
	expect(classText).not.toMatch(
		/PRIVATE_BROWSER_COMMENT_MARKER|private-submission-marker|Navigation|Authentification/
	);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}`);
	await readyModuleEditor(page);
	const selector = page.getByLabel('Section du module', { exact: true });
	if (await selector.isVisible()) await selector.selectOption('resources');
	else await page.getByRole('tab', { name: 'Liens étudiants', exact: true }).click();
	await page.getByLabel('Consignes du module', { exact: true }).fill('Consigne publique fictive');
	await page.getByRole('button', { name: 'Ajouter un exercice non noté', exact: true }).click();
	await page.getByLabel('Titre de l’exercice', { exact: false }).fill('Exercice libre fictif');
	await page.getByLabel('Consigne', { exact: true }).fill('Énoncé libre');
	await page
		.getByLabel('Corrigé librement accessible', { exact: true })
		.fill('Corrigé sans verrou');
	const saved = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/teaching/modules/' + app.ids.module) &&
			response.request().method() === 'PATCH'
	);
	await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).click();
	expect((await saved).status()).toBe(200);
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.module}/publication?contexte=${app.ids.currentContext}`
	);
	const publish = page.getByRole('button', {
		name: /Publier pour cette classe|Publier la mise à jour/
	});
	await expect(publish).toBeEnabled();
	await publish.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByText('La page du module est publiée.', { exact: true })).toBeVisible();
	await page.goto(`${app.origin}/modules/${app.ids.currentContext}`);
	await expect(page.getByText('Corrigé sans verrou', { exact: true })).toBeVisible();
	const publicTab = page.getByRole('tab', { name: 'Consignes et barèmes', exact: true });
	await expect(async () => {
		await publicTab.focus();
		await page.keyboard.press('Enter');
		await expect(publicTab).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await expect(page.getByText('Consigne publique fictive', { exact: true })).toBeVisible();
	await expect(page.getByText('Projet · grille vierge', { exact: true })).toBeVisible();
	await expect(
		page.getByText('Aucune consigne ni aucun barème n’est indiqué pour le moment.', { exact: true })
	).toHaveCount(0);
	await page.screenshot({
		path: info.outputPath('public-instructions-rubric.png'),
		fullPage: true
	});
	const publicResponse = await request.get(
		`${app.origin}/modules/${app.ids.currentContext}/__data.json`
	);
	expect(publicResponse.ok()).toBe(true);
	expect(await publicResponse.text()).not.toMatch(
		/Aline Moreau|PRIVATE_BROWSER_COMMENT_MARKER|private-submission-marker/
	);
	await expect(page.locator('body')).toHaveJSProperty(
		'scrollWidth',
		await page.locator('body').evaluate((element) => element.clientWidth)
	);
});

test('annual close requires explicit module choices and retains the continued public URL', async ({
	app,
	page,
	request
}, info) => {
	test.setTimeout(360000);
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/classes/annees?annee=2026-2027`);
	await page.getByRole('button', { name: 'Préparer la clôture', exact: true }).click();
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toBeVisible({ timeout: 15000 });
	await dialog
		.getByLabel('Année de reprise (si vous reprenez des modules)', { exact: true })
		.fill('2027-2028');
	await dialog
		.getByLabel('Application web · publication démo', { exact: true })
		.selectOption('continue');
	await dialog.getByLabel('Recopiez l’année 2026-2027', { exact: true }).fill('2026-2027');
	await dialog.getByRole('checkbox').check();
	await dialog.evaluate((element) => {
		element.scrollTop = 0;
	});
	await page.screenshot({ path: info.outputPath('annual-close-top.png') });
	await dialog.getByLabel('Recopiez l’année 2026-2027', { exact: true }).focus();
	await page.screenshot({ path: info.outputPath('annual-close-bottom.png') });
	const closed = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/teaching/years/2026-2027') &&
			response.request().method() === 'POST'
	);
	await dialog.getByRole('button', { name: 'Clôturer 2026-2027', exact: true }).click();
	expect((await closed).status()).toBe(200);
	await expect(dialog).not.toBeVisible();
	const retained = await request.get(`${app.origin}/modules/${app.ids.publicationContext}`);
	expect(retained.ok()).toBe(true);
	await page.goto(`${app.origin}/enseignant/classes/annees?annee=2027-2028`);
	await expect(page.getByText(/0 étudiant/).first()).toBeVisible();
	await page.goto(`${app.origin}/`);
	await expect(page.getByRole('region', { name: 'Brouillons à relire' })).toBeVisible();
	expect(errors).toEqual([]);
});
