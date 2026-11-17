import { readFormActionCommand, fulfillFormAction } from './support/form-actions.js';
import { createClient } from '@libsql/client';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../../src/lib/server/db/index.js';
import { getAnnualData } from '../../src/lib/server/teaching/annual.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

const year = '2026-2027';

test('annual choices appear first and reveal their own consequences without bypassing confirmation', async ({
	app,
	page
}, info) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/classes/annees?annee=${year}`);
	const choices = page.getByRole('region', { name: 'Choisir la suite de l’année', exact: true });
	const archive = choices.getByRole('button', { name: 'Archiver sans supprimer', exact: true });
	const close = choices.getByRole('button', { name: 'Préparer la clôture', exact: true });
	await expect(archive).toBeEnabled();
	await expect(close).toBeEnabled();
	await expect(choices).toContainText('lecture seule');
	await expect(choices).toContainText('supprime définitivement');
	await expect(page.getByRole('alertdialog')).toHaveCount(0);
	await expect(page.locator('#annual-pdf-title')).toHaveCount(0);
	await page.screenshot({ path: info.outputPath('annual-choices.png'), fullPage: true });
	await archive.focus();
	await page.keyboard.press('Enter');
	const summary = page.getByRole('region', { name: 'Bilan de l’année', exact: true });
	await expect(summary).toContainText('Aucune donnée supprimée');
	await expect(summary).toContainText('Rouvrir l’année');
	await expect(page.getByLabel(`Recopiez l’année ${year}`, { exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: `Archiver ${year}`, exact: true })).toBeEnabled();
	await page.screenshot({ path: info.outputPath('annual-archive-review.png'), fullPage: true });
	await close.focus();
	await page.keyboard.press('Enter');
	await expect(summary).toContainText('Suppression définitive');
	await expect(summary).toContainText('PDF nécessaires');
	await expect(page.locator('#annual-pdf-title')).toBeVisible();
	await expect(page.getByRole('button', { name: `Archiver ${year}`, exact: true })).toHaveCount(0);
	await page.screenshot({ path: info.outputPath('annual-close-review.png'), fullPage: true });
	const confirm = page.getByRole('button', {
		name: 'Vérifier et confirmer la clôture',
		exact: true
	});
	await confirm.focus();
	await page.keyboard.press('Enter');
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toBeVisible();
	const submitted: unknown[] = [];
	await page.route('**/enseignant/classes/annees?/decideYear', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		submitted.push(await readFormActionCommand(route.request()));
		await fulfillFormAction(route, { status: 409, message: 'Le dossier a changé. Actualisez les références.' });
	});
	const submit = dialog.getByRole('button', { name: `Clôturer ${year}`, exact: true });
	await submit.click();
	await expect(dialog.getByText('Confirmez la conservation des PDF nécessaires.', { exact: true })).toBeVisible();
	expect(submitted).toHaveLength(0);
	await dialog.getByRole('checkbox').check();
	await dialog.getByLabel(`Recopiez l’année ${year}`, { exact: true }).fill('2025-2026');
	await submit.click();
	expect(submitted).toHaveLength(0);
	await dialog.getByLabel(`Recopiez l’année ${year}`, { exact: true }).fill(year);
	await submit.click();
	await expect.poll(() => submitted.length).toBe(1);
	await expect(dialog.getByLabel(`Recopiez l’année ${year}`, { exact: true })).toHaveValue(year);
	await expect(submit).toBeDisabled();
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		const preview = (await getAnnualData(createDatabase(client), app.ids.teacher, year)).selected!;
		expect(preview.status).toBe('active');
		expect(preview.removed.students).toBe(12);
	} finally {
		client.close();
	}
	await page.screenshot({
		path: info.outputPath('annual-protected-confirmation.png'),
		fullPage: true
	});
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
