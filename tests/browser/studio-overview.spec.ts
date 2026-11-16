import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { mkdir } from 'node:fs/promises';

test('studio routes preserve content, themes and responsive access', async ({ page, app }, testInfo) => {
	test.setTimeout(240000);
	page.setDefaultTimeout(15000);
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const directory = `.playwright-mcp/studio-review/${testInfo.project.name}`;
	await mkdir(directory, { recursive: true });
	await page.goto(app.origin + '/connexion');
	await expect(page.getByRole('button', { name: 'Me connecter', exact: true })).toBeEnabled();
	await page.emulateMedia({ colorScheme: 'dark' });
	await expect(page.locator('html')).toHaveClass(/dark/);
	await page.screenshot({ path: `${directory}/connexion-dark.png`, fullPage: true });
	await page.emulateMedia({ colorScheme: 'light' });
	await expect(page.locator('html')).not.toHaveClass(/dark/);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await page.screenshot({ path: `${directory}/connexion.png`, fullPage: true });
	await page.goto(app.origin + '/activation');
	await expect(page.getByText('Invitation introuvable', { exact: true })).toBeVisible();
	await page.screenshot({ path: `${directory}/activation.png`, fullPage: true });
	await activate(page, app, async () => {
		await page.screenshot({ path: `${directory}/activation-ready-light.png`, fullPage: true });
		await page.emulateMedia({ colorScheme: 'dark' });
		await expect(page.locator('html')).toHaveClass(/dark/);
		await page.screenshot({ path: `${directory}/activation-ready-dark.png`, fullPage: true });
		await page.emulateMedia({ colorScheme: 'light' });
	});
	const scope = `contexte=${app.ids.currentContext}&classe=${app.ids.currentClass}`;
	const routes = [
		['home', '/'],
		['modules', '/enseignant/modules'],
		['new-module', '/enseignant/modules/nouveau'],
		['module', `/enseignant/modules/${app.ids.module}?${scope}`],
		['rubric', `/enseignant/modules/${app.ids.module}/bareme?${scope}`],
		[
			'publication',
			`/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`
		],
		['classes', `/enseignant/classes?classe=${app.ids.currentClass}`],
		['annual', '/enseignant/classes/annees?annee=2026-2027'],
		['grading', `/enseignant/notation?module=${app.ids.module}&${scope}`],
		[
			'correction',
			`/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}?evaluation=${app.ids.project}`
		],
		['proposals', `/enseignant/propositions?proposition=${app.ids.proposals[0]}`],
		['published-pages', '/enseignant/vue-etudiante'],
		['account', '/enseignant/compte'],
		['applications', '/enseignant/applications'],
		['public-directory', `/classes/${app.ids.currentClass}`],
		['public-course', `/modules/${app.ids.publicationContext}`],
		['consent-invalid', '/autoriser'],
		['application-signin-invalid', '/connexion/application'],
		['public-unavailable', '/modules/00000000-0000-4000-8000-000000000099']
	] as const;
	for (const theme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: theme });
		for (const [name, route] of routes) {
			console.info('Capturing', theme, name);
			await page.goto(app.origin + route);
			await page.waitForLoadState('networkidle');
			await expect(page.locator('h1').first(), name).toBeVisible();
			if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
			else await expect(page.locator('html')).not.toHaveClass(/dark/);
			await expect(async () => {
				const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
				expect(overflow, `${name}: document must not scroll horizontally`).toBeLessThanOrEqual(1);
			}).toPass({ timeout: 5000 });
			await page.screenshot({ path: `${directory}/${name}-${theme}.png`, fullPage: true });
		}
	}
	await page.goto(app.origin + '/enseignant/modules');
	await page
		.getByRole('searchbox', { name: 'Rechercher un module', exact: true })
		.fill('no fictional module matches this');
	await expect(page.getByText('Aucun module trouvé', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Réinitialiser la recherche', exact: true }).click();
	await expect(page.getByText('Aucun module trouvé', { exact: true })).not.toBeVisible();
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { name: 'Mes modules', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Choisir le thème', exact: true }).click();
	await page.getByRole('menuitemradio', { name: 'Thème clair', exact: true }).click();
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(page.locator('html')).not.toHaveClass(/dark/);
	await page.getByRole('button', { name: 'Choisir le thème', exact: true }).click();
	await page.getByRole('menuitemradio', { name: 'Thème sombre', exact: true }).click();
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(page.locator('html')).toHaveClass(/dark/);
	for (const width of [375, 390, 1280, 1440]) {
		await page.setViewportSize({ width, height: 1000 });
		await page.goto(app.origin + `/enseignant/notation?module=${app.ids.module}&${scope}`);
		await page.waitForLoadState('networkidle');
		await expect(page.locator('h1').first()).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
		await page.screenshot({ path: `${directory}/grading-${width}.png`, fullPage: true });
	}
	expect(errors, 'No uncaught browser exceptions').toEqual([]);
});
