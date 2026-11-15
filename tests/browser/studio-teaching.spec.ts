import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';

test('class directory, roster filtering and module task rail retain the teaching context', async ({
	app,
	page
}, info) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/classes?classe=${app.ids.currentClass}`);
	await expect(page.getByRole('heading', { name: 'Mes classes', exact: true })).toBeVisible();
	const roster = page.getByRole('table', { name: /^Étudiants de/ });
	const names = await roster.locator('tbody tr').count();
	await page.getByRole('searchbox', { name: 'Rechercher un étudiant' }).fill('Nom introuvable dans cette classe');
	await expect(page.getByText('Aucun étudiant trouvé', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Effacer la recherche', exact: true }).click();
	await expect(roster.locator('tbody tr')).toHaveCount(names);
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.module}?classe=${app.ids.currentClass}&contexte=${app.ids.currentContext}`
	);
	await readyModuleEditor(page);
	const mobile = page.getByLabel('Section du module', { exact: true });
	if (await mobile.isVisible()) await mobile.selectOption('preparation');
	else {
		const rail = page.getByRole('tablist', { name: 'Sections du module' });
		await expect(rail).toHaveAttribute('aria-orientation', 'vertical');
		await page.getByRole('tab', { name: 'Informations', exact: false }).focus();
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');
	}
	await expect(page.getByRole('tabpanel', { name: 'Notes privées', exact: false })).toBeVisible();
	await page.getByLabel('Prochaines étapes', { exact: true }).fill('Préparer la prochaine séance');
	if (await mobile.isVisible()) await mobile.selectOption('planning');
	else await page.getByRole('tab', { name: 'Classe et planning', exact: false }).click();
	await page.goBack();
	await expect(page.getByLabel('Prochaines étapes', { exact: true })).toHaveValue('Préparer la prochaine séance');
	expect(new URL(page.url()).searchParams.get('classe')).toBe(app.ids.currentClass);
	expect(new URL(page.url()).searchParams.get('contexte')).toBe(app.ids.currentContext);
	await page.screenshot({ path: info.outputPath('studio-teaching.png'), fullPage: true });
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test('module library exposes module links in the server-rendered library', async ({ app, page, context }) => {
	await activate(page, app);
	const response = await context.request.get(app.origin + '/enseignant/modules');
	const html = await response.text();
	const links = [...html.matchAll(/href="([^"]*enseignant\/modules[^"]*)"/g)].map(
		(match) => new URL(match[1], app.origin).pathname
	);
	expect(response.status()).toBe(200);
	expect(links).toContain(`/enseignant/modules/${app.ids.module}`);
});
