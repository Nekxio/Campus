import { createClient } from '@libsql/client';
import { ne } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../../src/lib/server/db/index.js';
import * as tables from '../../src/lib/server/db/schema.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('unpublished pages lead to preparation for zero, one and several available modules', async ({
	app,
	page
}, info) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/vue-etudiante`);
	await expect(page.getByRole('list', { name: 'Classes avec des pages publiées', exact: true })).toBeVisible();
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	const db = createDatabase(client);
	try {
		await db.update(tables.modulePublications).set({ unpublishedAt: new Date() });
		await page.reload();
		await expect(page.getByRole('heading', { level: 1, name: 'Pages publiées', exact: true })).toBeVisible();
		await expect(page.getByText(/Choisissez une classe pour consulter/)).toHaveCount(0);

		const action = page.getByRole('link', { name: 'Choisir un module à publier', exact: true });
		await expect(action).toHaveAttribute('href', '/enseignant/modules');
		await expect(page.getByRole('list', { name: 'Modules à préparer', exact: true })).toHaveCount(0);
		await page.screenshot({ path: info.outputPath('pages-unpublished.png'), fullPage: true });
		await db.update(tables.modules).set({ pausedAt: new Date() }).where(ne(tables.modules.id, app.ids.module));
		await page.reload();
		await expect(action).toHaveCount(1);
		await action.click();
		await expect(page).toHaveURL(`${app.origin}/enseignant/modules`);
		await expect(page.getByRole('heading', { level: 1, name: 'Mes modules', exact: true })).toBeVisible();
		await db.update(tables.modules).set({ pausedAt: new Date() });
		await page.goto(`${app.origin}/enseignant/vue-etudiante`);
		await expect(action).toHaveAttribute('href', '/enseignant/modules');
		await expect(page.getByRole('list', { name: 'Modules à préparer', exact: true })).toHaveCount(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
	} finally {
		client.close();
	}
});
