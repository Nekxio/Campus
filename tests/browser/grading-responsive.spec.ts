import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { gradingRows, openGradingFilters, returnToGradingClass, setGradingFilters } from './support/grading.js';

const exportRegion = (page: Page) => page.getByRole('region', { name: 'Export PDF du module', exact: true });
const filterTrigger = (page: Page) => page.getByRole('button', { name: 'Filtrer les étudiants', exact: true });
const summary = (page: Page) => page.locator('#selected-student-summary');

async function capture(page: Page, info: TestInfo, name: string, fullPage = false) {
	await page.evaluate(() => document.fonts.ready);
	const path = info.outputPath(name + '.png');
	await page.screenshot({ path, fullPage, animations: 'disabled' });
	await info.attach(name, { path, contentType: 'image/png' });
}

async function dismissActivationNotification(page: Page) {
	const close = page.getByRole('button', { name: 'Fermer la notification', exact: true });
	if (await close.isVisible()) {
		await close.click();
		await expect(close).not.toBeVisible();
	}
}

async function expectNoOverflow(page: Page) {
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
		.toBeLessThanOrEqual(1);
}

test('class overview and live filters keep shared state across responsive widths and themes', async ({
	page,
	app
}, info) => {
	const roster = await app.call<{ names: string[]; results: string[] }>('complete-class');
	await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
	await activate(page, app);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(app.origin + '/enseignant/notation?module=' + app.ids.module);
	await expect(exportRegion(page).getByRole('button', { name: 'Télécharger le PDF', exact: true })).toBeEnabled();
	await dismissActivationNotification(page);
	const writes: string[] = [];
	page.on('request', (request) => {
		if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url());
	});
	await expect(page.getByRole('heading', { name: 'Notation', level: 1, exact: true })).toBeVisible();
	await expect(gradingRows(page)).toHaveCount(12);
	await expect(summary(page)).not.toBeVisible();
	await expect(page.getByRole('complementary', { name: /^Bilan de / })).toHaveCount(0);
	expect(new URL(page.url()).searchParams.has('etudiant')).toBe(false);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.locator('.grade-export')).toHaveAttribute('data-compact', 'true');
	await expect(exportRegion(page)).toContainText('12/12 étudiants');
	await expect(exportRegion(page)).toBeInViewport();
	await expect(gradingRows(page).first().getByRole('button', { name: roster.names[0], exact: true })).toBeInViewport();
	for (const id of ['grading-context', 'grading-module']) {
		await expect(page.locator('#' + id)).toHaveCount(1);
		await expect(page.locator('#' + id)).not.toBeVisible();
	}
	await expectNoOverflow(page);
	await capture(page, info, 'grading-initial-mobile');

	const contextToggle = page.getByRole('button', { name: 'Changer le contexte', exact: true });
	await contextToggle.focus();
	await page.keyboard.press('Enter');
	await expect(contextToggle).toHaveAttribute('aria-expanded', 'true');
	for (const label of ['Classe', 'Module'])
		await expect(page.getByRole('combobox', { name: label, exact: true })).toBeVisible();
	await page.getByRole('combobox', { name: 'Classe', exact: true }).focus();
	await page.keyboard.press('Tab');
	await expect(page.getByRole('combobox', { name: 'Module', exact: true })).toBeFocused();
	await contextToggle.focus();
	await page.keyboard.press('Enter');
	await expect(contextToggle).toHaveAttribute('aria-expanded', 'false');
	await expect(page.locator('#grading-module')).not.toBeVisible();

	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(page.getByRole('table', { name: /^Résultats du module/ })).toBeVisible();
	await expect(summary(page)).toHaveAccessibleName('Bilan de ' + roster.names[0]);
	await expect(summary(page)).toBeVisible();
	// Responsive focus recovery can move the layout between separate browser protocol calls.
	await expect(async () => {
		const bounds = await page.evaluate(() => {
			const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
			const roster = rect('.grade-grid .roster-pane');
			const summary = rect('#selected-student-summary');
			const context = rect('#grading-context-controls');
			const pdf = rect('.grade-grid [aria-label="Export PDF du module"]');
			const search = rect('#grading-search');
			return {
				rosterRight: roster.right,
				summaryLeft: summary.left,
				contextBottom: context.bottom,
				pdfTop: pdf.top,
				pdfBottom: pdf.bottom,
				searchTop: search.top
			};
		});
		expect(bounds.summaryLeft).toBeGreaterThanOrEqual(bounds.rosterRight);
		expect(bounds.contextBottom).toBeLessThanOrEqual(bounds.pdfTop);
		expect(bounds.pdfBottom).toBeLessThanOrEqual(bounds.searchTop);
	}).toPass({ timeout: 15000 });
	await expectNoOverflow(page);
	await capture(page, info, 'grading-initial-desktop');

	await page.setViewportSize({ width: 390, height: 844 });
	await filterTrigger(page).focus();
	await page.keyboard.press('Enter');
	const panel = page.getByRole('dialog', { name: 'Filtrer les étudiants', exact: true });
	await expect(panel).toBeVisible();
	await expect(panel.getByRole('heading', { name: 'Filtrer les étudiants', exact: true })).toBeVisible();
	const search = panel.getByRole('searchbox', { name: 'Rechercher un étudiant', exact: true });
	const filter = panel.getByRole('combobox', { name: 'Afficher', exact: true });
	await expect(search).toHaveAttribute('id', 'grading-search-mobile');
	await expect(filter).toHaveAttribute('id', 'grading-filter-mobile');
	await expect(search).toHaveCSS('font-size', '16px');
	await search.fill('Noe');
	await filter.selectOption('complete');
	await expect(panel.getByRole('status')).toHaveText('1 / 12 étudiants');
	for (let index = 0; index < 6; index++) {
		await page.keyboard.press(index === 0 ? 'Shift+Tab' : 'Tab');
		expect(await panel.evaluate((node) => node.contains(document.activeElement))).toBe(true);
	}
	await expect(panel.getByRole('button', { name: 'Voir les résultats', exact: true })).toBeInViewport();
	await expectNoOverflow(page);
	await capture(page, info, 'grading-mobile-filter-panel');
	await page.keyboard.press('Escape');
	await expect(panel).not.toBeVisible();
	await expect(filterTrigger(page)).toBeFocused();
	await expect(filterTrigger(page)).toHaveText('Filtrer (2)');

	const states: { theme: string; width: number; count: number }[] = [];
	for (const theme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: theme });
		await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
		for (const width of [1440, 1024, 390, 320]) {
			await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
			await expect(gradingRows(page)).toHaveCount(1);
			await expect(gradingRows(page).getByRole('button', { name: 'Noé Petit', exact: true })).toBeVisible();
			await expect(gradingRows(page).getByText('20,0 /20', { exact: true })).toBeVisible();
			await expect(page.getByText('Recherche : « Noe » · Résultats complets', { exact: true })).toBeVisible();
			await expect(page.getByRole('button', { name: 'Réinitialiser les filtres', exact: true })).toBeVisible();
			await expect(exportRegion(page)).toContainText('12/12 étudiants');
			if (width < 1024) {
				await expect(summary(page)).not.toBeVisible();
				await expect(filterTrigger(page)).toHaveText('Filtrer (2)');
				await openGradingFilters(page);
				await expect(search).toHaveValue('Noe');
				await expect(filter).toHaveValue('complete');
				await expect(panel.getByRole('button', { name: 'Voir les résultats', exact: true })).toBeInViewport();
				await panel.getByRole('button', { name: 'Voir les résultats', exact: true }).focus();
				await page.keyboard.press('Enter');
				await expect(panel).not.toBeVisible();
				await expect(filterTrigger(page)).toBeFocused();
			} else {
				await expect(page.getByRole('searchbox', { name: 'Rechercher un étudiant', exact: true })).toHaveValue('Noe');
				await expect(page.getByRole('combobox', { name: 'Afficher', exact: true })).toHaveValue('complete');
				await expect(summary(page)).toHaveAccessibleName('Bilan de Noé Petit');
				await expect(summary(page)).toBeVisible();
				await expect(page.getByRole('table')).toHaveCount(width >= 1280 ? 1 : 0);
			}
			await expectNoOverflow(page);
			states.push({ theme, width, count: await gradingRows(page).count() });
		}
	}

	await openGradingFilters(page);
	await search.focus();
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(panel).not.toBeVisible();
	await expect(page.getByRole('searchbox', { name: 'Rechercher un étudiant', exact: true })).toBeFocused();
	await expect(page.getByRole('searchbox', { name: 'Rechercher un étudiant', exact: true })).toHaveValue('Noe');
	await gradingRows(page).getByRole('button', { name: 'Noé Petit', exact: true }).focus();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(new RegExp('etudiant=' + app.ids.students[2]));
	await setGradingFilters(page, { search: 'Camille' });
	await expect(summary(page)).toHaveAccessibleName('Bilan de Camille Demo');
	await expect(gradingRows(page)).toHaveAttribute('data-selected', 'true');
	await expect(gradingRows(page).getByRole('button')).toHaveAttribute('aria-pressed', 'true');
	// Filtering falls back to the visible student without rewriting the explicit URL selection.
	await expect(page).toHaveURL(new RegExp('etudiant=' + app.ids.students[2]));
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(summary(page)).toBeVisible();
	await returnToGradingClass(page);
	await expect(gradingRows(page).getByRole('button', { name: 'Camille Demo', exact: true })).toBeFocused();
	expect(new URL(page.url()).searchParams.has('etudiant')).toBe(false);

	await setGradingFilters(page, { search: 'Aucun résultat 0123456789' });
	await expect(page.getByText('Aucun étudiant trouvé', { exact: true })).toBeVisible();
	await expect(page.getByRole('status').filter({ hasText: /0 \/ 12 étudiants/ })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Réinitialiser les filtres', exact: true })).toHaveCount(1);
	await page.getByRole('button', { name: 'Réinitialiser les filtres', exact: true }).click();
	await expect(gradingRows(page)).toHaveCount(12);
	for (const value of ['pending', 'absence'] as const) {
		await setGradingFilters(page, { filter: value });
		await expect(page.getByText('Aucun étudiant trouvé', { exact: true })).toBeVisible();
		await expect(filterTrigger(page)).toHaveText('Filtrer (1)');
		await page.getByRole('button', { name: 'Réinitialiser les filtres', exact: true }).click();
		await expect(gradingRows(page)).toHaveCount(12);
	}
	await openGradingFilters(page);
	await expect(search).toHaveValue('');
	await expect(filter).toHaveValue('all');
	await page.keyboard.press('Escape');
	await expect(filterTrigger(page)).toBeFocused();
	await expect(filterTrigger(page)).toHaveText('Filtrer');
	await expect(page.getByRole('button', { name: 'Réinitialiser les filtres', exact: true })).toHaveCount(0);
	await expect(summary(page)).not.toBeVisible();
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.setViewportSize({ width: 320, height: 844 });
	await expect(page.locator('html')).toHaveClass(/dark/);
	await expect(gradingRows(page)).toHaveCount(12);
	await expect(
		page
			.locator('.class-tools')
			.getByRole('status')
			.filter({ hasText: /12 \/ 12 étudiants/ })
	).toBeVisible();
	await expectNoOverflow(page);
	await capture(page, info, 'grading-overview-dark-320-reset', true);
	expect(writes).toEqual([]);
	await info.attach('grading-responsive-filter-states', {
		body: JSON.stringify({ states, writes }),
		contentType: 'application/json'
	});
});

test('student deep links use a main-content detail and restore the class focus, scroll and all results', async ({
	page,
	app
}, info) => {
	const roster = await app.call<{ names: string[]; results: string[] }>('complete-class');
	await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
	await activate(page, app);
	const studentId = app.ids.students[11];
	const studentName = roster.names[11];
	await page.goto(app.origin + '/enseignant/notation?module=' + app.ids.module + '&etudiant=' + studentId);
	await expect(exportRegion(page).getByRole('button', { name: 'Télécharger le PDF', exact: true })).toBeEnabled();
	await dismissActivationNotification(page);
	await expect(summary(page)).toHaveAccessibleName('Bilan de ' + studentName);
	await expect(summary(page)).toBeVisible();
	const correction = summary(page).getByRole('link', {
		name: 'Ouvrir la correction détaillée',
		exact: true
	});
	await expect(correction).toHaveAttribute('href', '/enseignant/notation/' + app.ids.currentContext + '/' + studentId);
	await expect(
		summary(page).getByRole('button', {
			name: 'Télécharger le PDF individuel de ' + studentName,
			exact: true
		})
	).toBeEnabled();
	const results = summary(page).getByRole('region', { name: 'Résultats du module', exact: true });
	const assessments = summary(page).getByRole('region', { name: 'Évaluations', exact: true });
	await expect(results.getByRole('heading')).toHaveText(roster.results);
	await expect(results.getByText('20,0 /20', { exact: true })).toHaveCount(roster.results.length);
	for (const title of ['Quiz', 'Projet', 'Soutenance'])
		await expect(assessments.getByRole('heading', { name: title, exact: true })).toBeVisible();

	const actions = page.getByRole('button', { name: 'Actions du module', exact: true });
	await actions.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('menuitem', { name: 'Propositions', exact: true })).toHaveAttribute(
		'href',
		'/enseignant/propositions?contexte=' + app.ids.currentContext
	);
	await expect(page.getByRole('menuitem', { name: 'Modifier le barème', exact: true })).toHaveAttribute(
		'href',
		new RegExp('/enseignant/modules/' + app.ids.module + '/bareme\\?retour=notation&contexte=' + app.ids.currentContext)
	);
	await page.keyboard.press('Escape');
	await expect(actions).toBeFocused();

	await page.setViewportSize({ width: 390, height: 844 });
	await expect(
		page.getByRole('main').getByRole('complementary', { name: 'Bilan de ' + studentName, exact: true })
	).toBeVisible();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Étudiants', exact: true })).toHaveCount(0);
	await expect(page.locator('.roster-pane')).not.toBeVisible();
	const canonical = new URL(page.url());
	await returnToGradingClass(page);
	const student = gradingRows(page).getByRole('button', { name: studentName, exact: true });
	await expect(student).toBeFocused();
	await expect(student).toBeInViewport();
	for (const key of ['annee', 'classe', 'module', 'contexte'])
		expect(new URL(page.url()).searchParams.get(key)).toBe(canonical.searchParams.get(key));
	expect(new URL(page.url()).searchParams.has('etudiant')).toBe(false);
	await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
	const classScroll = await page.evaluate(() => scrollY);
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(new RegExp('etudiant=' + studentId));
	await expect(summary(page)).toBeFocused();
	await expect(summary(page)).toHaveAccessibleName('Bilan de ' + studentName);
	await capture(page, info, 'grading-mobile-individual');
	await summary(page).getByRole('button', { name: 'Retour à la classe', exact: true }).focus();
	await page.keyboard.press('Enter');
	await expect(student).toBeFocused();
	await expect.poll(async () => Math.abs((await page.evaluate(() => scrollY)) - classScroll)).toBeLessThanOrEqual(2);
	await expect(student).toHaveAttribute('aria-pressed', 'true');
	await page.keyboard.press('Enter');
	await expect(summary(page)).toBeFocused();

	for (const theme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: theme });
		await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
		for (const width of [1440, 1024, 390, 320]) {
			await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
			await expect(summary(page)).toHaveAccessibleName('Bilan de ' + studentName);
			await expect(results.getByRole('heading')).toHaveText(roster.results);
			await expect(assessments.getByRole('heading')).toHaveText(['Évaluations', 'Quiz', 'Projet', 'Soutenance']);
			await expect(async () => {
				const bounds = await page.evaluate(() => {
					const summary = document.getElementById('selected-student-summary')!;
					const results = summary.querySelector('[aria-label="Résultats du module"]')!.getBoundingClientRect();
					const correction = summary.querySelector('a[href^="/enseignant/notation/"]')!.getBoundingClientRect();
					const assessments = summary.querySelector('[aria-label="Évaluations"]')!.getBoundingClientRect();
					return {
						resultsBottom: results.bottom,
						correctionTop: correction.top,
						correctionBottom: correction.bottom,
						assessmentsTop: assessments.top
					};
				});
				expect(bounds.resultsBottom).toBeLessThanOrEqual(bounds.correctionTop);
				expect(bounds.correctionBottom).toBeLessThanOrEqual(bounds.assessmentsTop);
			}).toPass({ timeout: 15000 });
			await expect(page.locator('.roster-pane')).toBeVisible({ visible: width >= 1024 });
			await expectNoOverflow(page);
		}
	}
	await capture(page, info, 'grading-small-dark-individual');

	await page.goto(
		app.origin + '/enseignant/notation?module=' + app.ids.secondModule + '&etudiant=' + app.ids.students[0]
	);
	await expect(summary(page)).toHaveAccessibleName('Bilan de Aline Moreau');
	await expect(summary(page)).toBeVisible();
	const independentResults = summary(page).getByRole('region', {
		name: 'Résultats du module',
		exact: true
	});
	await expect(independentResults.getByRole('heading')).toHaveText(['Dossier 1', 'Dossier 2']);
	await expect(independentResults.getByText('En attente', { exact: true })).toHaveCount(2);
	const independentAssessments = summary(page).getByRole('region', {
		name: 'Évaluations',
		exact: true
	});
	await expect(independentAssessments.getByRole('heading')).toHaveText(['Évaluations', 'Dossier 1', 'Dossier 2']);
	await expect(independentAssessments.getByText('Évaluation à compléter.', { exact: true })).toHaveCount(2);
	await expect(
		summary(page).getByRole('link', { name: 'Ouvrir la correction détaillée', exact: true })
	).toHaveAttribute('href', '/enseignant/notation/' + app.ids.secondContext + '/' + app.ids.students[0]);
	await expect(exportRegion(page).getByRole('button', { name: 'Télécharger le PDF', exact: true })).toBeDisabled();
	await expect(
		summary(page).getByRole('button', {
			name: 'Télécharger le PDF individuel de Aline Moreau',
			exact: true
		})
	).toBeDisabled();
	await expectNoOverflow(page);
	await capture(page, info, 'grading-small-pending-individual');
	await returnToGradingClass(page);
	await expect(gradingRows(page)).toHaveCount(12);
	for (const row of await gradingRows(page).all()) {
		await expect(row.locator('dt')).toHaveText(['Dossier 1', 'Dossier 2']);
		await expect(row.locator('dd')).toHaveText(['En attente', 'En attente']);
	}
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(page.getByRole('table').getByRole('columnheader')).toHaveText([
		'Étudiant',
		'Dossier 1',
		'Dossier 2',
		'État'
	]);
	await expect(gradingRows(page)).toHaveCount(12);
	await expectNoOverflow(page);
});
