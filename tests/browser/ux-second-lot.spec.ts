import { createClient } from '@libsql/client';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../../src/lib/server/db/index.js';
import * as tables from '../../src/lib/server/db/schema.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('invalid rubric input hides misleading totals and first save has a simple confirmation', async ({
	app,
	page
}, info) => {
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	const moduleId = crypto.randomUUID();
	try {
		await createDatabase(client).insert(tables.modules).values({ id: moduleId, title: 'Test UX — Nouveau barème' });
	} finally {
		client.close();
	}
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${moduleId}/bareme`);
	await expect(async () => {
		await page.getByRole('button', { name: 'Ajouter une section', exact: true }).first().click();
		await expect(page.getByLabel('Nom de la section', { exact: true })).toBeFocused({
			timeout: 1000
		});
	}).toPass({ timeout: 60000 });
	await page.getByLabel('Nom de la section', { exact: true }).fill('Dossier');
	await page.getByLabel('Libellé du critère 1', { exact: true }).fill('Livrable');
	const input = page.getByLabel('Maximum du critère 1 (pts)', { exact: true });
	const total = page.getByRole('status', { name: 'Total des maxima', exact: true });
	for (const invalid of ['-1', '0', '2.5', '1000001', '']) {
		await input.fill(invalid);
		await expect(total).toHaveText('Maximum à corriger');
		await expect(page.getByText(/^Note du module =/)).toHaveCount(0);
		await expect(
			page
				.getByRole('tabpanel')
				.getByRole('status')
				.filter({ hasText: /-1 pts|NaN|Infinity/ })
		).toHaveCount(0);
		await page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).first().click();
		await expect(input).toHaveValue(invalid);
		await expect(input).toHaveAttribute('aria-invalid', 'true');
	}
	await page.screenshot({ path: info.outputPath('rubric-invalid.png'), fullPage: true });
	await input.fill('35');
	await expect(total).toHaveText('35 pts');
	await expect(page.getByText(/^Note du module =/)).toContainText('÷ 35 × 20');
	await page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).first().click();
	await expect(page.getByText('Barème enregistré.', { exact: true }).first()).toBeVisible();
	await expect(page.getByText(/Barème enregistré\. Les points sont conservés/)).toHaveCount(0);
	await input.focus();
	await expect(input).toBeFocused();
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test('rubric save warns only when existing corrections are affected', async ({ app, page }) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}/bareme`);
	const tab = page.getByRole('tab', { name: /^Projet/ });
	await expect(async () => {
		await tab.click();
		await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
	}).toPass({ timeout: 60000 });
	const panel = page.getByRole('tabpanel');
	const title = panel.getByLabel('Nom de la section', { exact: true });
	await title.fill('Test UX — Intitulé corrigé');
	await page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).first().click();
	await expect(page.getByText('Barème enregistré.', { exact: true }).first()).toBeVisible();
	const maximum = panel.getByLabel('Maximum du critère 1 (pts)', { exact: true });
	await maximum.fill('21');
	const submit = page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).first();
	await submit.focus();
	await expect(submit).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.getByText(/Barème enregistré\. Les points sont conservés/).first()).toBeVisible();
});
