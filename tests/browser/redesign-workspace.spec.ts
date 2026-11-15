import { openModulePages } from './support/module-navigation.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { publicationSections } from '../../src/lib/domain/publication.js';

test('redesigned routes retain their content across sizes and themes', async ({ page, app }) => {
	test.setTimeout(240000);
	page.setDefaultTimeout(15000);
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto(app.origin + '/connexion');
	await expect(page.getByRole('button', { name: 'Me connecter', exact: true })).toBeEnabled();
	await page.emulateMedia({ colorScheme: 'dark' });
	await expect(page.locator('html')).toHaveClass(/dark/);
	await page.emulateMedia({ colorScheme: 'light' });
	await expect(page.locator('html')).not.toHaveClass(/dark/);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await page.goto(app.origin + '/activation');
	await expect(page.getByText('Invitation introuvable', { exact: true })).toBeVisible();
	await activate(page, app, async () => {
		await page.emulateMedia({ colorScheme: 'dark' });
		await expect(page.locator('html')).toHaveClass(/dark/);
		await page.emulateMedia({ colorScheme: 'light' });
	});
	const scope = `contexte=${app.ids.currentContext}&classe=${app.ids.currentClass}`;
	const routes = [
		['home', '/'],
		['library', '/enseignant/modules'],
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
			await page.goto(app.origin + route);
			await page.waitForLoadState('networkidle');
			await expect(page.locator('h1').first(), name).toBeVisible();
			if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
			else await expect(page.locator('html')).not.toHaveClass(/dark/);
			await expect(async () => {
				const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
				expect(overflow, `${name}: document must not scroll horizontally`).toBeLessThanOrEqual(1);
			}).toPass({ timeout: 5000 });
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
	for (const width of [320, 768, 1024, 1920]) {
		await page.setViewportSize({ width, height: 1000 });
		await page.goto(app.origin + `/enseignant/notation?module=${app.ids.module}&${scope}`);
		await page.waitForLoadState('networkidle');
		await expect(page.locator('h1').first()).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
	}
	expect(errors, 'No uncaught browser exceptions').toEqual([]);
});

test('access readiness, long titles and populated public reading remain usable', async ({ page, app }) => {
	page.setDefaultTimeout(15000);
	await page.goto(app.origin + '/connexion');
	await expect(page.getByRole('button', { name: 'Me connecter', exact: true })).toBeEnabled();
	for (const theme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: theme });
		await expect
			.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark')))
			.toBe(theme === 'dark');
	}
	await activate(page, app);
	await page.goto(app.origin + `/enseignant/modules/${app.ids.module}`);
	await page.waitForLoadState('networkidle');
	const title = page.getByRole('textbox', { name: 'Nom du module', exact: true });
	const original = await title.inputValue();
	await title.fill(
		'Architecture des applications, accessibilité et conception de services numériques — étude comparative et préparation des évaluations du semestre avec une classe au nom particulièrement long'
	);
	await expect(page.locator('h1')).toContainText('Architecture des applications');
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
	await title.fill(original);
	for (const theme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: theme });
		await page.goto(app.origin + `/modules/${app.ids.publicationContext}`);
		await expect(page.getByRole('heading', { name: 'Application web · publication démo', exact: true })).toBeVisible();
		await page.waitForLoadState('networkidle');
	}
});

test('teaching and public content sections retain usable layouts in both themes', async ({ page, app }) => {
	test.setTimeout(120000);
	await activate(page, app);
	for (const theme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: theme });
		for (const section of ['preparation', 'resources', 'planning']) {
			await page.goto(
				`${app.origin}/enseignant/modules/${app.ids.publicationModule}?contexte=${app.ids.publicationContext}&section=${section}`
			);
			await page.waitForLoadState('networkidle');
			await expect(page.locator('.module-editor')).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
		}
		await page.goto(`${app.origin}/modules/${app.ids.publicationContext}`);
		await page.waitForLoadState('networkidle');
		for (const section of publicationSections) {
			await page.getByRole('tab', { name: section.label, exact: true }).click();
			await expect(page.getByRole('tab', { name: section.label, exact: true })).toHaveAttribute(
				'aria-selected',
				'true'
			);
			expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
			await page.evaluate(() => scrollTo(0, 0));
		}
	}
});

test('preparation opened from grading retains the selected class and context', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/notation?module=${app.ids.module}&contexte=${app.ids.currentContext}`);
	const preparation = (await openModulePages(page)).getByRole('link', {
		name: 'Préparer',
		exact: true
	});
	const destination = new URL((await preparation.getAttribute('href'))!, app.origin);
	expect(destination.searchParams.get('contexte')).toBe(app.ids.currentContext);
	expect(destination.searchParams.get('classe')).toBe(app.ids.currentClass);
	await preparation.click();
	const workflow = await openModulePages(page);
	await expect(workflow.getByRole('link')).toHaveText(['Préparer', 'Quiz', 'Barème', 'Notation', 'Publication']);
	for (const link of await workflow.getByRole('link').all()) {
		const target = new URL((await link.getAttribute('href'))!, app.origin);
		expect(target.searchParams.get('contexte')).toBe(app.ids.currentContext);
	}
});
