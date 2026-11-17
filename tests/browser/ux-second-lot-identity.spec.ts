import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../../src/lib/server/db/index.js';
import * as tables from '../../src/lib/server/db/schema.js';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';

test('module identity is the main heading and wraps long names', async ({ app, page }, info) => {
	const title =
		'Test UX — Un module au nom très long pour préparer les parcours accessibles sur ordinateur et téléphone '
			.repeat(2)
			.slice(0, 200)
			.trim();
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		await createDatabase(client).update(tables.modules).set({ title }).where(eq(tables.modules.id, app.ids.module));
	} finally {
		client.close();
	}
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}`);
	await readyModuleEditor(page);
	const heading = page.getByRole('heading', { level: 1, name: title, exact: true });
	await expect(heading).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Modifier le module', exact: true })).toHaveCount(0);
	await expect(page.getByText('Modification du module', { exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { level: 2, name: 'Informations', exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
	await page.screenshot({ path: info.outputPath('module-identity.png'), fullPage: true });
});
