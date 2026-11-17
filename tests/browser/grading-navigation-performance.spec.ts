import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';
import { openModulePages, closeModulePages } from './support/module-navigation.js';

test('rubric links open grading with one data request and retain the module section through history', async ({
	page,
	app
}) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}`);
	await readyModuleEditor(page);
	await (await openModulePages(page)).getByRole('link', { name: 'Barème', exact: true }).click();
	await expect(page.getByLabel('Nom de la section', { exact: true }).first()).toBeVisible();
	const rubricUrl = page.url();
	const target = `${app.origin}/enseignant/notation?${new URLSearchParams({
		annee: '2026-2027',
		classe: app.ids.currentClass,
		module: app.ids.module,
		contexte: app.ids.currentContext,
		section: 'information'
	})}`;
	const dataRequests: string[] = [];
	const documents: string[] = [];
	page.on('request', (request) => {
		if (new URL(request.url()).pathname === '/enseignant/notation/__data.json') dataRequests.push(request.url());
		if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url());
	});
	for (let repetition = 0; repetition < 3; repetition += 1) {
		const link = (await openModulePages(page)).getByRole('link', { name: 'Notation', exact: true });
		await expect(link).toHaveAttribute('href', target.slice(app.origin.length));
		await link.focus();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(target);
		await expect(page.getByRole('region', { name: 'Export PDF du module', exact: true })).toBeVisible();
		expect(dataRequests).toHaveLength(1);
		expect(documents).toEqual([]);
		await page.goBack();
		await expect(page).toHaveURL(rubricUrl);
		await expect(page.getByLabel('Nom de la section', { exact: true }).first()).toBeVisible();
		dataRequests.length = 0;
	}
	await page.goForward();
	await expect(page).toHaveURL(target);
	await expect(page.getByRole('region', { name: 'Export PDF du module', exact: true })).toBeVisible();
	expect(dataRequests.length).toBeLessThanOrEqual(1);
	expect(documents).toEqual([]);
});

test('rubric return links keep both student and section without a canonical redirect', async ({ page, app }) => {
	await activate(page, app);
	const query = new URLSearchParams({
		annee: '2026-2027',
		classe: app.ids.currentClass,
		module: app.ids.module,
		contexte: app.ids.currentContext,
		section: 'preparation',
		etudiant: app.ids.students[1]
	});
	const target = `${app.origin}/enseignant/notation?${query}`;
	query.delete('module');
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}/bareme?${query}`);
	const theme = page.getByRole('button', { name: 'Choisir le thème', exact: true });
	await expect(async () => {
		await theme.click();
		await expect(page.getByRole('menu')).toBeVisible({ timeout: 1000 });
	}).toPass();
	await page.keyboard.press('Escape');
	const rubricUrl = page.url();
	const dataRequests: string[] = [];
	page.on('request', (request) => {
		if (new URL(request.url()).pathname === '/enseignant/notation/__data.json') dataRequests.push(request.url());
	});
	const link = (await openModulePages(page)).getByRole('link', { name: 'Notation', exact: true });
	await expect(link).toHaveAttribute('href', target.slice(app.origin.length));
	await link.focus();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(target);
	await expect(page.locator('#selected-student-summary')).toBeVisible();
	const studentSummary = await page.locator('#selected-student-summary').getAttribute('aria-label');
	expect(dataRequests).toHaveLength(1);
	await page.goBack();
	await expect(page).toHaveURL(rubricUrl);
	await closeModulePages(page);
	dataRequests.length = 0;
	await page.getByRole('button', { name: 'Retour à la grille', exact: true }).click();
	await expect(page).toHaveURL(target);
	await expect(page.locator('#selected-student-summary')).toHaveAttribute('aria-label', studentSummary!);
	expect(dataRequests).toHaveLength(1);
});
