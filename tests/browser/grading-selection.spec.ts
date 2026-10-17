import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import type { GradingSelectionFixture } from '../../src/lib/server/db/testing/grading-selection-fixtures.js';
import type { Page, Route } from '@playwright/test';

const exportRegion = (page: Page) =>
	page.getByRole('region', { name: 'Export PDF du module', exact: true });
const yearSelect = (page: Page) => page.getByLabel('Année de travail', { exact: true });
const classSelect = (page: Page) => page.getByLabel('Classe et année', { exact: true });
const moduleSelect = (page: Page) => page.getByLabel('Module', { exact: true });

test('class-first selection scopes modules, clears stale data and persists an explicitly chosen year', async ({
	page,
	app
}, info) => {
	await app.call('complete-class');
	const ids = await app.call<GradingSelectionFixture>('grading-selection');
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/notation');
	await expect(yearSelect(page)).toHaveValue('');
	await expect(classSelect(page)).toBeDisabled();
	await expect(moduleSelect(page)).toBeDisabled();
	await expect(moduleSelect(page).locator('option')).toHaveCount(1);
	await expect(page.getByText('Choisissez l’année de travail', { exact: true })).toBeVisible();
	await expect(async () => {
		await yearSelect(page).selectOption('2026-2027');
		await expect(classSelect(page)).toBeEnabled({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await expect(yearSelect(page).locator('option')).toHaveText([
		'Choisir une année',
		'2026-2027',
		'2027-2028'
	]);
	await classSelect(page).selectOption(app.ids.currentClass);
	await expect(moduleSelect(page)).toBeEnabled();
	await expect(moduleSelect(page)).toHaveValue('');
	await expect(moduleSelect(page).locator(`option[value="${ids.b3Module}"]`)).toHaveCount(0);
	await moduleSelect(page).selectOption(app.ids.module);
	await expect(exportRegion(page)).toContainText('12/12 étudiants');
	const selectedStudent = app.ids.students[1];
	const rows = page.locator(
		info.project.name === 'mobile' ? '.mobile-grid .student-row' : '.desktop-grid tbody tr'
	);
	await rows.nth(1).getByRole('button').click();
	await expect(page).toHaveURL(new RegExp('etudiant=' + selectedStudent));
	await page.getByLabel('Rechercher un étudiant', { exact: true }).fill('Aline');
	await classSelect(page).selectOption(ids.b3Class);
	await expect(moduleSelect(page)).toHaveValue('');
	await expect(moduleSelect(page).locator('option')).toHaveText([
		'Choisir un module',
		'B3 · Atelier web'
	]);
	await expect(page.locator('#selected-student-summary')).toHaveCount(0);
	await expect(exportRegion(page)).toHaveCount(0);
	await moduleSelect(page).selectOption(ids.b3Module);
	await expect(exportRegion(page)).toContainText('1/2 étudiants');
	await expect(
		exportRegion(page).getByRole('button', { name: 'Télécharger le PDF', exact: true })
	).toBeDisabled();
	await expect(page.getByLabel('Rechercher un étudiant', { exact: true })).toHaveValue('');
	await expect(page.locator('#selected-student-summary')).toHaveAccessibleName(
		'Bilan de B3 Alice Démo'
	);
	await expect(
		page
			.locator('#selected-student-summary')
			.getByRole('link', { name: 'Ouvrir la correction détaillée' })
	).toHaveAttribute('href', new RegExp(ids.b3Context));
	await expect(
		page.getByRole('button', {
			name: 'Télécharger le PDF individuel de B3 Alice Démo',
			exact: true
		})
	).toBeEnabled();
	await expect(page).toHaveURL(
		new RegExp('classe=' + ids.b3Class + '&module=' + ids.b3Module + '&contexte=' + ids.b3Context)
	);
	const classBounds = await classSelect(page).boundingBox();
	const moduleBounds = await moduleSelect(page).boundingBox();
	if (info.project.name === 'desktop') expect(classBounds!.x).toBeLessThan(moduleBounds!.x);
	else expect(classBounds!.y).toBeLessThan(moduleBounds!.y);
	await classSelect(page).focus();
	await page.keyboard.press('Tab');
	await expect(moduleSelect(page)).toBeFocused();
	await page.screenshot({
		path: info.outputPath('class-first-b3-incomplete.png'),
		fullPage: true,
		animations: 'disabled'
	});
	await classSelect(page).selectOption('');
	await expect(moduleSelect(page)).toBeDisabled();
	await expect(moduleSelect(page).locator('option')).toHaveCount(1);
	await expect(page.locator('#selected-student-summary')).toHaveCount(0);
	await expect(exportRegion(page)).toHaveCount(0);
	await expect(page.getByText('Aucune classe sélectionnée', { exact: true })).toBeVisible();
	await classSelect(page).selectOption(ids.emptyClass);
	await expect(page.getByText('Aucun module pour cette classe', { exact: true })).toBeVisible();
	await expect(moduleSelect(page)).toBeDisabled();
	await yearSelect(page).selectOption('2027-2028');
	await expect(classSelect(page).locator('option')).toHaveCount(2);
	await expect(classSelect(page).locator(`option[value="${app.ids.currentClass}"]`)).toHaveCount(0);
	await classSelect(page).selectOption(ids.futureClass);
	await expect(moduleSelect(page)).toBeEnabled();
	await moduleSelect(page).selectOption(ids.futureModule);
	await expect(exportRegion(page)).toContainText('0/1 étudiants');
	await page.reload();
	await expect(yearSelect(page)).toHaveValue('2027-2028');
	await page.goto(app.origin + '/enseignant/notation');
	await expect(yearSelect(page)).toHaveValue('2027-2028');
	await expect(classSelect(page)).toHaveValue('');
	await expect(moduleSelect(page)).toBeDisabled();
	await page.goto(
		app.origin + '/enseignant/notation?module=' + app.ids.module + '&etudiant=' + selectedStudent
	);
	await expect(yearSelect(page)).toHaveValue('2026-2027');
	await expect(classSelect(page)).toHaveValue(app.ids.currentClass);
	await expect(moduleSelect(page)).toHaveValue(app.ids.module);
	await expect(page.locator('#selected-student-summary')).toHaveAccessibleName(
		'Bilan de Camille Demo'
	);
	await expect(exportRegion(page)).toContainText('12/12 étudiants');
	await page.screenshot({
		path: info.outputPath('class-first-deep-link-b2.png'),
		fullPage: true,
		animations: 'disabled'
	});
	const invalid = await page.goto(
		app.origin + '/enseignant/notation?classe=' + ids.b3Class + '&module=' + app.ids.module
	);
	expect(invalid!.status()).toBe(404);
});

test('late selection and PDF responses cannot restore another class or an outdated export', async ({
	page,
	app
}, info) => {
	await app.call('complete-class');
	const ids = await app.call<GradingSelectionFixture>('grading-selection');
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/notation?module=' + app.ids.module);
	await expect(exportRegion(page)).toContainText('12/12 étudiants');
	let release!: () => void;
	const held = new Promise<void>((done) => {
		release = done;
	});
	let intercepted = false,
		delivered = false;
	const matcher = (url: URL) => url.pathname.endsWith('/enseignant/notation/__data.json');
	const handler = async (route: Route) => {
		const url = new URL(route.request().url());
		if (url.searchParams.get('classe') !== ids.b3Class || url.searchParams.has('module'))
			return route.continue();
		const response = await route.fetch();
		intercepted = true;
		await held;
		await route.fulfill({ response });
		delivered = true;
	};
	await page.route(matcher, handler);
	await expect(async () => {
		await classSelect(page).selectOption(ids.b3Class);
		await expect.poll(() => intercepted, { timeout: 1000 }).toBe(true);
	}).toPass({ timeout: 60000 });
	await expect(exportRegion(page)).toHaveCount(0);
	await expect(page.locator('#selected-student-summary')).toHaveCount(0);
	await expect(moduleSelect(page)).toBeDisabled();
	await expect(moduleSelect(page).locator('option')).toHaveCount(1);
	await classSelect(page).selectOption(app.ids.currentClass);
	await expect(moduleSelect(page)).toBeEnabled();
	await moduleSelect(page).selectOption(app.ids.module);
	await expect(exportRegion(page)).toContainText('12/12 étudiants');
	release();
	await expect.poll(() => delivered).toBe(true);
	await page.unroute(matcher, handler);
	await expect(classSelect(page)).toHaveValue(app.ids.currentClass);
	await expect(exportRegion(page)).toContainText('12/12 étudiants');
	let releaseExports!: () => void;
	const exportsHeld = new Promise<void>((done) => {
		releaseExports = done;
	});
	const requested: string[] = [];
	let exportsDelivered = 0;
	await page.route('**/api/teaching/contexts/**/export', async (route) => {
		requested.push(new URL(route.request().url()).pathname);
		await exportsHeld;
		await route.fulfill({ status: 409, json: { message: 'OLD_SELECTION_EXPORT_RESPONSE' } });
		exportsDelivered++;
	});
	await exportRegion(page).getByRole('button', { name: 'Télécharger le PDF', exact: true }).click();
	await page
		.getByRole('button', { name: 'Télécharger le PDF individuel de Aline Moreau', exact: true })
		.click();
	await expect.poll(() => requested.length).toBe(2);
	await classSelect(page).selectOption(ids.b3Class);
	await expect(moduleSelect(page)).toBeEnabled();
	await moduleSelect(page).selectOption(ids.b3Module);
	await expect(exportRegion(page)).toContainText('1/2 étudiants');
	await classSelect(page).selectOption(app.ids.currentClass);
	await expect(moduleSelect(page)).toBeEnabled();
	await moduleSelect(page).selectOption(app.ids.module);
	await expect(exportRegion(page)).toContainText('12/12 étudiants');
	releaseExports();
	await expect.poll(() => exportsDelivered).toBe(2);
	await expect(
		exportRegion(page).getByRole('button', { name: 'Télécharger le PDF', exact: true })
	).toBeEnabled();
	await expect(page.getByText('OLD_SELECTION_EXPORT_RESPONSE', { exact: true })).toHaveCount(0);
	await expect(page.getByText('Résultats à actualiser', { exact: true })).toHaveCount(0);
	await expect(
		page.getByRole('button', { name: 'Télécharger le PDF individuel de Aline Moreau', exact: true })
	).toBeEnabled();
	await info.attach('late-responses', {
		body: JSON.stringify({ ignoredLateNavigation: delivered, ignoredLateExportPaths: requested }),
		contentType: 'application/json'
	});
});

test('returning to class filters retains unsaved correction and rubric drafts until explicit departure', async ({
	page,
	app
}, info) => {
	await activate(page, app);
	await page.goto(
		app.origin + '/enseignant/notation/' + app.ids.currentContext + '/' + app.ids.students[0]
	);
	await expect(async () => {
		await page.getByLabel('Évaluation', { exact: true }).selectOption({ label: 'Projet' });
		await expect(page.getByRole('button', { name: 'Enregistrer Projet', exact: true })).toBeVisible(
			{ timeout: 1000 }
		);
	}).toPass({ timeout: 60000 });
	const writes: string[] = [];
	page.on('request', (request) => {
		if (['PATCH', 'PUT', 'DELETE'].includes(request.method())) writes.push(request.url());
	});
	const points = page.getByLabel('Navigation', { exact: true });
	await points.fill('3');
	await page.getByRole('link', { name: 'Retour à la grille', exact: true }).click();
	let dialog = page.getByRole('alertdialog');
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(points).toHaveValue('3');
	await page.getByRole('link', { name: 'Retour à la grille', exact: true }).click();
	await dialog.getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click();
	await expect(classSelect(page)).toHaveValue(app.ids.currentClass);
	await expect(moduleSelect(page)).toHaveValue(app.ids.module);
	await expect(page.locator('#selected-student-summary')).toHaveAccessibleName(
		'Bilan de Aline Moreau'
	);
	await page.getByRole('link', { name: 'Modifier le barème', exact: true }).click();
	const title = page.locator('input[name="assessments[0].title"]');
	await expect(title).toHaveValue('Quiz');
	await expect(async () => {
		await title.fill('PRIVATE_UNSAVED_RUBRIC');
		await page.getByRole('button', { name: 'Retour à la grille', exact: true }).click();
		await expect(page.getByRole('alertdialog')).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	dialog = page.getByRole('alertdialog');
	await dialog.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(title).toHaveValue('PRIVATE_UNSAVED_RUBRIC');
	await page.getByRole('button', { name: 'Retour à la grille', exact: true }).click();
	await page.screenshot({
		path: info.outputPath('draft-navigation-protected.png'),
		animations: 'disabled'
	});
	await dialog.getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click();
	await expect(classSelect(page)).toHaveValue(app.ids.currentClass);
	await expect(moduleSelect(page)).toHaveValue(app.ids.module);
	await expect(page.getByText('PRIVATE_UNSAVED_RUBRIC', { exact: true })).toHaveCount(0);
	expect(writes).toEqual([]);
});
