import { createClient } from '@libsql/client';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../../src/lib/server/db/index.js';
import { academicYears } from '../../src/lib/server/db/schema.js';
import { openModulePages } from './support/module-navigation.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { showGradingContext } from './support/grading.js';
import type { GradingSelectionFixture } from '../../src/lib/server/db/testing/grading-selection-fixtures.js';
import type { Page, Route } from '@playwright/test';

const exportRegion = (page: Page) => page.getByRole('region', { name: 'Export PDF du module', exact: true });
const classSelect = (page: Page) => page.getByLabel('Classe', { exact: true });
const moduleSelect = (page: Page) => page.getByLabel('Module', { exact: true });

test('only the current school year is available even with a future cohort', async ({ page, app }) => {
	const ids = await app.call<GradingSelectionFixture>('grading-selection');
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/notation');
	await showGradingContext(page);
	await expect(page.getByLabel('Année de travail', { exact: true })).toHaveCount(0);
	await expect(classSelect(page).locator('option')).toHaveText([
		'Choisir une classe',
		'B2 Demo',
		'B3 Démo',
		'Classe sans module'
	]);
	await expect(classSelect(page).locator(`option[value="${ids.futureClass}"]`)).toHaveCount(0);
	await expect(async () => {
		await classSelect(page).selectOption(app.ids.currentClass);
		await expect(moduleSelect(page)).toBeEnabled({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await moduleSelect(page).selectOption(app.ids.module);
	await expect(page).toHaveURL(new RegExp(`module=${app.ids.module}`));
	await page.reload();
	await showGradingContext(page);
	await expect(classSelect(page)).toHaveValue(app.ids.currentClass);
	await expect(moduleSelect(page)).toHaveValue(app.ids.module);
	const futureLink = await page.goto(app.origin + '/enseignant/notation?classe=' + ids.futureClass);
	expect(futureLink!.status()).toBe(404);
	const oldLink = await page.goto(app.origin + '/enseignant/notation?contexte=' + app.ids.oldContext);
	expect(oldLink!.status()).toBe(404);
});

test('late selection and PDF responses cannot restore another class or an outdated export', async ({
	page,
	app
}, info) => {
	await app.call('complete-class');
	const ids = await app.call<GradingSelectionFixture>('grading-selection');
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		await createDatabase(client).insert(academicYears).values({ academicYear: '2027-2028', archivedAt: new Date() });
	} finally {
		client.close();
	}
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/notation?module=' + app.ids.module);
	await showGradingContext(page);
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
		if (url.searchParams.get('classe') !== ids.b3Class || url.searchParams.has('module')) return route.continue();
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
	await expect(page.getByRole('status').filter({ hasText: 'Choisissez un module.' })).toBeVisible();
	await expect(page.getByText('Chargement de la grille…')).toHaveCount(0);
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
	if (info.project.name === 'mobile')
		await page.locator('.mobile-grid .student-row').first().getByRole('button').click();
	await page.getByRole('button', { name: 'Télécharger le PDF individuel de Aline Moreau', exact: true }).click();
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
	await expect(exportRegion(page).getByRole('button', { name: 'Télécharger le PDF', exact: true })).toBeEnabled();
	await expect(page.getByText('OLD_SELECTION_EXPORT_RESPONSE', { exact: true })).toHaveCount(0);
	await expect(page.getByText('Résultats à actualiser', { exact: true })).toHaveCount(0);
	if (info.project.name === 'mobile')
		await page.locator('.mobile-grid .student-row').first().getByRole('button').click();
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
	await page.goto(app.origin + '/enseignant/notation/' + app.ids.currentContext + '/' + app.ids.students[0]);
	await expect(async () => {
		await page.getByLabel('Évaluation', { exact: true }).selectOption({ label: 'Projet' });
		await expect(page.getByRole('button', { name: 'Enregistrer Projet', exact: true })).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	const writes: string[] = [];
	page.on('request', (request) => {
		if (['PATCH', 'PUT', 'DELETE'].includes(request.method())) writes.push(request.url());
	});
	const points = page.getByLabel(/^Navigation(?: \(optionnel\))?$/);
	await points.fill('3');
	await page.getByRole('link', { name: 'Retour à la grille', exact: true }).click();
	let dialog = page.getByRole('alertdialog');
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(points).toHaveValue('3');
	await page.getByRole('link', { name: 'Retour à la grille', exact: true }).click();
	await dialog.getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click();
	await showGradingContext(page);
	await expect(classSelect(page)).toHaveValue(app.ids.currentClass);
	await expect(moduleSelect(page)).toHaveValue(app.ids.module);
	await expect(page.locator('#selected-student-summary')).toHaveAccessibleName('Bilan de Aline Moreau');
	await (await openModulePages(page)).getByRole('link', { name: 'Barème', exact: true }).click();
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
	await showGradingContext(page);
	await expect(classSelect(page)).toHaveValue(app.ids.currentClass);
	await expect(moduleSelect(page)).toHaveValue(app.ids.module);
	await expect(page.getByText('PRIVATE_UNSAVED_RUBRIC', { exact: true })).toHaveCount(0);
	expect(writes).toEqual([]);
});
