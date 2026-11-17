import { chmod } from 'node:fs/promises';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';
import { readPdfText } from './support/pdf.js';
import { setGradingFilters } from './support/grading.js';

test('individual PDF and public exercises use the real private and public workflows', async ({
	app,
	page,
	request
}, info) => {
	test.setTimeout(360000);
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`);
	await expect(async () => {
		const details = page.getByRole('region', { name: 'Détails du bilan', exact: true });
		if (!(await details.isVisible())) await page.getByRole('button', { name: 'Détails du bilan', exact: true }).click();
		await expect(details).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
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
	await page.goto(`${app.origin}/enseignant/notation?module=${app.ids.module}&contexte=${app.ids.currentContext}`);
	await expect(async () => {
		await setGradingFilters(page, { search: roster.names[0] });
		await expect(page.getByRole('status').filter({ hasText: /1 \/ 12 étudiants/ })).toBeVisible({
			timeout: 1000
		});
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
	expect(classText).not.toMatch(/PRIVATE_BROWSER_COMMENT_MARKER|private-submission-marker|Navigation|Authentification/);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}`);
	await readyModuleEditor(page);
	const selector = page.getByLabel('Section du module', { exact: true });
	if (await selector.isVisible()) await selector.selectOption('resources');
	else await page.getByRole('tab', { name: 'Contenu étudiant', exact: false }).click();
	await page.getByLabel('Consignes du module (optionnel)', { exact: true }).fill('Consigne publique fictive');
	await page.getByRole('button', { name: 'Ajouter un exercice non noté', exact: true }).click();
	await page.getByLabel('Titre de l’exercice', { exact: false }).fill('Exercice libre fictif');
	await page.getByLabel('Consigne (optionnel)', { exact: true }).fill('Énoncé libre');
	await page.getByLabel('Corrigé librement accessible (optionnel)', { exact: true }).fill('Corrigé sans verrou');
	const saved = page.waitForResponse(
		(response) =>
			response.url().endsWith('/enseignant/modules/' + app.ids.module + '?/saveModule') &&
			response.request().method() === 'POST',
		{ timeout: 30000 }
	);
	await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first().click();
	expect((await saved).status()).toBe(200);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}/publication?contexte=${app.ids.currentContext}`);
	const publish = page.locator('.publication-scope').getByRole('button', {
		name: /Publier pour cette classe|Publier la mise à jour/
	});
	await expect(publish).toBeEnabled();
	await publish.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByText('La page du module est publiée.', { exact: true })).toBeVisible();
	await page.goto(`${app.origin}/modules/${app.ids.currentContext}`);
	const exercise = page.getByRole('button', { name: '01 Exercice libre fictif', exact: true });
	await expect(page.getByRole('tab', { name: 'Supports du cours', exact: true })).toHaveAttribute(
		'aria-controls',
		/^\S+$/
	);
	await exercise.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'Exercice libre fictif', exact: true })).toBeFocused();
	await expect(page.getByText('Énoncé libre', { exact: true })).toBeVisible();
	await expect(page.getByText('Corrigé sans verrou', { exact: true })).toBeHidden();
	await page.getByRole('tab', { name: 'Corrigé', exact: true }).click();
	const correctionConfirmation = page.getByRole('alertdialog', { name: 'Voir le corrigé ?' });
	await expect(correctionConfirmation).toBeVisible();
	await correctionConfirmation.getByRole('button', { name: 'Voir le corrigé', exact: true }).click();
	await expect(correctionConfirmation).toBeHidden();
	await expect(page.getByText('Corrigé sans verrou', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Retour aux supports', exact: true }).click();
	await expect(exercise).toBeFocused();
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
	const publicResponse = await request.get(`${app.origin}/modules/${app.ids.currentContext}/__data.json`);
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
	page.on('response', (response) => {
		if (response.status() >= 400)
			console.info('Annual HTTP failure:', response.status(), new URL(response.url()).pathname);
	});
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/classes/annees?annee=2026-2027`);
	await page.getByRole('button', { name: 'Préparer la clôture', exact: true }).click();
	const summary = page.getByRole('region', { name: 'Bilan de l’année', exact: true });
	await expect(summary).toContainText('Suppression définitive dans Campus');
	await expect(summary).toContainText('Un PDF ne permet pas de restaurer les corrections détaillées.');
	const inter = await page.evaluate(async () => {
		const faces = await document.fonts.load('400 14px "Inter Variable"', 'Clôturer l’année 2026-2027');
		await document.fonts.ready;
		return {
			faces: faces.map((face) => ({ family: face.family, status: face.status })),
			family: getComputedStyle(document.body).fontFamily,
			url: performance
				.getEntriesByType('resource')
				.find((entry) => new URL(entry.name).pathname.endsWith('/inter-latin-wght-normal.woff2'))?.name
		};
	});
	expect(inter.faces.length).toBeGreaterThan(0);
	for (const face of inter.faces) {
		expect(face.family).toContain('Inter Variable');
		expect(face.status).toBe('loaded');
	}
	expect(inter.family).toContain('Inter Variable');
	if (!inter.url) throw new Error('The browser did not request the installed Inter font.');
	expect(new URL(inter.url).origin).toBe(app.origin);
	const font = await request.get(inter.url);
	expect(font.status()).toBe(200);
	const bytes = (await font.body()).byteLength;
	expect(bytes).toBeGreaterThan(0);
	const fontEvidence = { ...inter, httpStatus: font.status(), bytes };
	console.info('Annual Inter before captures:', JSON.stringify(fontEvidence));
	await info.attach('annual-inter-font', {
		body: JSON.stringify(fontEvidence),
		contentType: 'application/json'
	});
	await page.getByRole('button', { name: 'Vérifier et confirmer la clôture', exact: true }).click();
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toBeVisible({ timeout: 15000 });
	await expect(dialog.getByText('Réglages à vérifier : 0 à reprendre, 3 à mettre de côté.')).toBeVisible();
	await expect(dialog.locator('select')).toHaveCount(3);
	for (const choice of await dialog.locator('select').all()) await expect(choice).toHaveValue('pause');
	await expect(dialog.getByLabel('Année de reprise (optionnel)', { exact: true })).toHaveValue('');
	await dialog.getByLabel('Année de reprise (optionnel)', { exact: true }).fill('2027-2028');
	await dialog.getByLabel('Application web · publication démo', { exact: true }).selectOption('continue');
	await expect(dialog.getByText('Réglages à vérifier : 1 à reprendre, 2 à mettre de côté.')).toBeVisible();
	await expect(dialog.getByLabel('Année de reprise', { exact: true })).toHaveAttribute('required', '');
	await expect(dialog.getByLabel('Année de reprise', { exact: true })).toHaveValue('2027-2028');
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
			response.url().endsWith('/enseignant/classes/annees?/decideYear') && response.request().method() === 'POST',
		{ timeout: 30000 }
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
