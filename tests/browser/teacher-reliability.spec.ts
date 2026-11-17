import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { createDatabase } from '../../src/lib/server/db/index.js';
import { createClass, createModule } from '../../src/lib/server/teaching/service.js';
import { emptyModule, type ModuleDetail } from '../../src/lib/teaching/types.js';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';
import { readFormActionReceipt } from './support/form-actions.js';

test('home failures keep teacher recovery after signing in', async ({ app, page }, info) => {
	const loader = join(app.manifest.directory, 'src/routes/+page.server.ts');
	await writeFile(
		loader,
		"import { error } from '@sveltejs/kit';\n" +
			(await readFile(loader, 'utf8')).replace(
				'const user = requireTeacherPage(locals);',
				`const user = requireTeacherPage(locals);
				if (url.searchParams.get('fixture-home-failure') === 'unavailable') error(503, 'PRIVATE_HOME_FAILURE_MARKER');
				if (url.searchParams.get('fixture-home-failure') === 'unexpected') throw new Error('PRIVATE_HOME_FAILURE_MARKER');`
			)
	);
	await activate(page, app);
	for (const [failure, status] of [
		['unavailable', 503],
		['unexpected', 500]
	] as const) {
		const url = `${app.origin}/?fixture-home-failure=${failure}`;
		const response = await page.goto(url);
		expect(response?.status()).toBe(status);
		expect(response?.headers()['cache-control']).toBe('private, no-store');
		await expect(
			page.getByRole('heading', { name: 'Cet espace ne répond pas pour le moment', exact: true })
		).toBeVisible();
		await expect(page.getByText('Demandez le lien du cours à votre enseignant.')).toHaveCount(0);
		await expect(page.locator('body')).not.toContainText('PRIVATE_HOME_FAILURE_MARKER');
		await expect(page.getByRole('link', { name: 'Réessayer', exact: true })).toHaveAttribute('href', url);
		await expect(page.getByRole('link', { name: 'Retour à mon accueil', exact: true })).toHaveAttribute('href', '/');
	}
	await page.screenshot({ path: info.outputPath('teacher-home-recovery.png'), fullPage: true });
	await page.getByRole('link', { name: 'Retour à mon accueil', exact: true }).click();
	await expect(page).toHaveURL(app.origin + '/');
	await expect(page.getByRole('heading', { level: 1, name: 'Mon atelier', exact: true })).toBeVisible();
});

test('a failed teacher parent load keeps teacher recovery and private responses', async ({ app, page }, info) => {
	const layout = join(app.manifest.directory, 'src/routes/enseignant/+layout.server.ts');
	await writeFile(
		layout,
		(await readFile(layout, 'utf8')).replace(
			'({ locals }) => {',
			"({ locals, url }) => { if (url.searchParams.has('fixture-parent-failure')) throw new Error('PRIVATE_PARENT_FAILURE_MARKER');"
		)
	);
	await activate(page, app);
	for (const path of [
		'/enseignant/compte',
		'/enseignant/classes',
		`/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`
	]) {
		const url = app.origin + path + '?fixture-parent-failure=1';
		const response = await page.goto(url);
		expect(response?.status()).toBe(500);
		expect(response?.headers()['cache-control']).toBe('private, no-store');
		await expect(
			page.getByRole('heading', { name: 'Cet espace ne répond pas pour le moment', exact: true })
		).toBeVisible();
		await expect(page.getByText('Demandez le lien du cours à votre enseignant.')).toHaveCount(0);
		await expect(page.locator('body')).not.toContainText('PRIVATE_PARENT_FAILURE_MARKER');
		await expect(page.getByRole('link', { name: 'Réessayer', exact: true })).toHaveAttribute('href', url);
		const home = page.getByRole('link', { name: 'Retour à mon accueil', exact: true });
		await home.focus();
		await expect(home).toBeFocused();
		expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
	}
	await page.screenshot({ path: info.outputPath('teacher-parent-recovery.png'), fullPage: true });
	await page.getByRole('link', { name: 'Retour à mon accueil', exact: true }).press('Enter');
	await expect(page).toHaveURL(app.origin + '/');
});

test('the empty class module dialog preserves its class and year through draft creation', async ({
	app,
	page
}, info) => {
	// The owned fixture represents a class with no available module; production loaders stay intact.
	const loader = join(app.manifest.directory, 'src/routes/enseignant/classes/+page.server.ts');
	await writeFile(
		loader,
		(await readFile(loader, 'utf8')).replace(
			'getClassesData(db, selected ? teachingId(selected) : undefined, currentAcademicYear())',
			'getClassesData(db, selected ? teachingId(selected) : undefined, currentAcademicYear()).then((data) => ({ ...data, modules: [] }))'
		)
	);
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/classes?classe=${app.ids.currentClass}`);
	await expect(async () => {
		await page.getByRole('button', { name: 'Rattacher un module', exact: true }).click();
		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	const create = page.getByRole('dialog').getByRole('link', { name: 'Créer un module', exact: true });
	await expect(create).toHaveAttribute(
		'href',
		`/enseignant/modules/nouveau?classe=${app.ids.currentClass}&annee=2026-2027`
	);
	await create.press('Enter');
	await page.getByLabel('Nom du module', { exact: true }).fill('Origine classe fictive');
	await readyModuleEditor(page);
	const saved = page.waitForResponse(
		(response) =>
			response.url().endsWith('/enseignant/modules/nouveau?/createModule') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
	const response = await saved;
	expect(response.status()).toBe(200);
	const module = await readFormActionReceipt<ModuleDetail>(response);
	expect(module.contexts).toHaveLength(1);
	expect(module.contexts[0].classId).toBe(app.ids.currentClass);
	await expect(page).toHaveURL(new RegExp(`/enseignant/modules/${module.id}(?:\\?|$)`));
	await page.reload();
	await expect(page.getByRole('heading', { level: 1, name: module.title, exact: true })).toBeVisible();
	await page.screenshot({ path: info.outputPath('class-origin-saved.png'), fullPage: true });
});

for (const count of [0, 1, 2]) {
	test(`annual confirmation describes ${count} modules without changing data`, async ({ app, page }) => {
		const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
		const year = '2030-2031';
		try {
			const db = createDatabase(client);
			const record = await createClass(db, { name: 'Classe annuelle fictive', academicYear: year });
			for (let index = 0; index < count; index++) {
				await createModule(db, {
					...emptyModule(),
					title: `Module annuel fictif ${index + 1}`,
					contexts: [{ id: crypto.randomUUID(), classId: record.id, lessons: [] }]
				});
			}
		} finally {
			client.close();
		}
		await activate(page, app);
		await page.goto(`${app.origin}/enseignant/classes/annees?annee=${year}`);
		await expect(async () => {
			await page.getByRole('button', { name: 'Préparer la clôture', exact: true }).press('Enter');
			await expect(page.getByRole('region', { name: 'Bilan de l’année', exact: true })).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 60000 });
		await page.getByRole('button', { name: 'Vérifier et confirmer la clôture', exact: true }).press('Enter');
		const dialog = page.getByRole('alertdialog');
		await expect(dialog).toBeVisible();
		await expect(dialog.locator('select[id^="annual-module-"]')).toHaveCount(count);
		await expect(
			dialog.getByRole('heading', {
				name:
					count === 0
						? 'Aucun module à reprendre'
						: count === 1
							? 'Choisir le devenir du module'
							: 'Choisir le devenir de chacun des 2 modules',
				exact: true
			})
		).toBeVisible();
		await expect(dialog.getByLabel(`Recopiez l’année ${year}`, { exact: true })).toBeVisible();
		await expect(dialog.getByRole('checkbox')).not.toBeChecked();
	});
}
