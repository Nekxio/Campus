import { createClient } from '@libsql/client';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../../src/lib/server/db/index.js';
import * as tables from '../../src/lib/server/db/schema.js';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';

test('deadlines explain their assessment prerequisite and reuse section creation in context', async ({
	app,
	page
}, info) => {
	await activate(page, app);
	page.on('dialog', (dialog) => dialog.accept());
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	const db = createDatabase(client);
	const moduleId = crypto.randomUUID();
	const contextId = crypto.randomUUID();
	try {
		await db.insert(tables.modules).values({ id: moduleId, title: 'Module sans évaluation' });
		await db.insert(tables.teachingContexts).values({
			id: contextId,
			moduleId,
			classId: app.ids.currentClass,
			className: 'B2 Demo',
			academicYear: '2026-2027'
		});
	} finally {
		client.close();
	}
	await page.goto(
		`${app.origin}/enseignant/modules/${moduleId}?classe=${app.ids.currentClass}&contexte=${contextId}&annee=2026-2027`
	);
	await readyModuleEditor(page);
	const selector = page.getByLabel('Section du module', { exact: true });
	if (await selector.isVisible()) await selector.selectOption('planning');
	else await page.getByRole('tab', { name: 'Classe et planning', exact: false }).click();
	const deadlines = page.getByRole('link', {
		name: 'Régler les échéances des évaluations',
		exact: true
	});
	await deadlines.focus();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(
		new RegExp(`/bareme\\?.*classe=${app.ids.currentClass}.*contexte=${contextId}.*#echeances-${contextId}$`)
	);
	const scope = page.locator(`#echeances-${contextId}`);
	await expect(scope).toContainText('Une échéance est liée à une évaluation.');
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
	await page.screenshot({ path: info.outputPath('deadline-prerequisite.png'), fullPage: true });
	const create = scope.getByRole('button', {
		name: 'Créer une évaluation pour fixer une échéance',
		exact: true
	});
	await expect(async () => {
		await create.focus();
		await page.keyboard.press('Enter');
		await expect(page.getByLabel('Nom de la section', { exact: true })).toBeFocused({
			timeout: 1000
		});
	}).toPass({ timeout: 60000 });
	await page.getByLabel('Nom de la section', { exact: true }).fill('Projet fictif');
	await scope.getByRole('button', { name: 'Date · Projet fictif', exact: true }).click();
	await expect(scope.getByLabel('Date et heure de remise', { exact: true })).toBeVisible();
	await expect(scope).toContainText('B2 Demo · 2026-2027');
	await expect(scope.getByRole('button', { name: 'Créer une évaluation pour fixer une échéance' })).toHaveCount(0);
	await page.screenshot({ path: info.outputPath('deadline-created.png'), fullPage: true });
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);

	await page.goto(`${app.origin}/enseignant/modules/${app.ids.publicationModule}/bareme#echeances`);
	await expect(page.locator('#echeances').getByText('Une échéance est liée à une évaluation.')).toHaveCount(0);
	await expect(page.locator('#echeances').getByLabel('Date et heure de remise', { exact: true }).first()).toBeVisible();
});
