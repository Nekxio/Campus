import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { currentAcademicYear } from '../../src/lib/domain/academic-year.js';
import { createDatabase } from '../../src/lib/server/db/index.js';
import { createClass, getClassesData } from '../../src/lib/server/teaching/service.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { fulfillFormAction, readFormActionCommand, readFormActionReceipt } from './support/form-actions.js';

test.use({ timezoneId: 'Pacific/Honolulu' });

test('daily class choices omit other years and creation uses the server year while retaining failed drafts', async ({
	page,
	app
}, info) => {
	const serverYear = currentAcademicYear();
	const clientStartYear = Number(serverYear.slice(0, 4)) + 5;
	const clientYear = `${clientStartYear}-${clientStartYear + 1}`;
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		const db = createDatabase(client);
		const futureClass = await createClass(db, { name: 'Classe future fictive', academicYear: clientYear });
		await activate(page, app);
		await page.clock.setFixedTime(new Date(`${clientStartYear}-11-12T12:00:00Z`));
		await page.goto(`${app.origin}/enseignant/classes?classe=${app.ids.currentClass}`);
		const selector = page.getByLabel('Classe', { exact: true });
		await expect(selector).toHaveValue(app.ids.currentClass);
		await expect(selector.locator(`option[value="${app.ids.oldClass}"]`)).toHaveCount(0);
		await expect(selector.locator(`option[value="${futureClass.id}"]`)).toHaveCount(0);
		await expect(selector.locator('option')).toHaveText(['B2 Demo']);
		await expect(page.getByRole('navigation', { name: 'Classes par année' })).toHaveCount(0);

		const dialog = page.getByRole('dialog', { name: 'Nouvelle classe', exact: true });
		await expect(async () => {
			await page.getByRole('button', { name: 'Nouvelle classe', exact: true }).click();
			await expect(dialog).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 60000 });
		await expect(dialog.getByRole('textbox')).toHaveCount(1);
		await expect(dialog.getByRole('textbox', { name: 'Année scolaire' })).toHaveCount(0);
		const name = dialog.getByRole('textbox', { name: 'Nom de la classe', exact: true });
		await name.fill('Classe fictive année automatique');
		const endpoint = '**/enseignant/classes?/createClass';
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		await page.route(endpoint, async (route) => {
			await held;
			await fulfillFormAction(route, { status: 503, message: 'Enregistrement fictif indisponible.' });
		});
		const failed = page.waitForRequest((request) => request.url().endsWith('/enseignant/classes?/createClass'));
		await dialog.getByRole('button', { name: 'Créer la classe', exact: true }).click();
		try {
			expect((await readFormActionCommand<{ academicYear: string }>(await failed)).academicYear).toBe(clientYear);
			await expect(name).toBeDisabled();
			await expect(dialog.getByRole('button', { name: 'Annuler', exact: true })).toBeDisabled();
		} finally {
			release();
		}
		await expect(dialog.getByRole('alert')).toContainText('Enregistrement fictif indisponible.');
		await expect(name).toHaveValue('Classe fictive année automatique');
		await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
		await expect(name).toHaveValue('Classe fictive année automatique');
		await page.unroute(endpoint);

		const saved = page.waitForResponse((response) => response.url().endsWith('/enseignant/classes?/createClass'));
		await dialog.getByRole('button', { name: 'Créer la classe', exact: true }).click();
		const response = await saved;
		expect(response.status()).toBe(200);
		const created = await readFormActionReceipt<{ id: string }>(response);
		await expect(dialog).not.toBeVisible();
		await expect(page.getByRole('heading', { name: 'Classe fictive année automatique', exact: true })).toBeVisible();
		const record = (await getClassesData(db, created.id)).selected!;
		expect(record.academicYear).toBe(serverYear);
		expect(record.name).toBe('Classe fictive année automatique');
		await expect(selector.locator(`option[value="${created.id}"]`)).toHaveText('Classe fictive année automatique');
		await page.screenshot({ path: info.outputPath('current-year-class.png'), fullPage: true });
	} finally {
		client.close();
	}
});

test('editing only the class name preserves its year and protects a conflicting draft', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/classes?classe=${app.ids.currentClass}`);
	const dialog = page.getByRole('dialog', { name: 'Modifier la classe', exact: true });
	await expect(async () => {
		await page.getByRole('button', { name: 'Modifier la classe', exact: true }).click();
		await expect(dialog).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await expect(dialog.getByRole('textbox')).toHaveCount(1);
	await expect(dialog.getByRole('textbox', { name: 'Année scolaire' })).toHaveCount(0);
	const name = dialog.getByRole('textbox', { name: 'Nom de la classe', exact: true });
	await name.fill('Classe fictive renommée');
	const endpoint = '**/enseignant/classes?/updateClass';
	await page.route(endpoint, (route) =>
		fulfillFormAction(route, { status: 409, message: 'Classe fictive modifiée ailleurs.' })
	);
	await dialog.getByRole('button', { name: 'Enregistrer le nom', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText('Rechargez la version actuelle');
	await expect(name).toHaveValue('Classe fictive renommée');
	await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(name).toHaveValue('Classe fictive renommée');
	await page.unroute(endpoint);
	await dialog.getByRole('button', { name: 'Enregistrer le nom', exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await expect(page.getByRole('heading', { name: 'Classe fictive renommée', exact: true })).toBeVisible();
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		const record = (await getClassesData(createDatabase(client), app.ids.currentClass)).selected!;
		expect(record.name).toBe('Classe fictive renommée');
		expect(record.academicYear).toBe('2026-2027');
	} finally {
		client.close();
	}
});
