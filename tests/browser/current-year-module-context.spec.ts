import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { publicationReviewDataSchema } from '../../src/lib/domain/publication.js';
import { createDatabase } from '../../src/lib/server/db/index.js';
import { teachingContexts } from '../../src/lib/server/db/schema.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { readFormActionCommand } from './support/form-actions.js';

test('daily publication and quiz context omit year choices and a redundant single-class selector', async ({
	app,
	page
}, info) => {
	if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 844 });
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}/publication`);
	const scope = page.locator('.publication-scope');
	await expect(scope.getByRole('combobox')).toHaveCount(0);
	await expect(scope.getByLabel('Classe sélectionnée', { exact: true })).toHaveText('B2 Demo');
	const response = await page.request.get(`${app.origin}/api/teaching/modules/${app.ids.module}/publication`);
	expect(response.status()).toBe(200);
	const review = publicationReviewDataSchema.parse(await response.json());
	expect(review.contexts.map((context) => context.id)).toEqual([app.ids.currentContext]);
	expect(review.selected?.context.id).toBe(app.ids.currentContext);
	await expect(scope).not.toContainText('2025-2026');
	await expect(scope).not.toContainText('2026-2027');
	await expect(scope.getByRole('button', { name: 'Publier pour cette classe', exact: true })).toBeEnabled();
	await page.screenshot({ path: info.outputPath('current-publication-context.png'), fullPage: true });
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}/quiz`);
	await expect(page.getByRole('combobox', { name: /^Classe/ })).toHaveCount(0);
	await expect(page.getByLabel('Classe associée', { exact: true })).toHaveText('B2 Demo');
	await expect(page.locator('main')).not.toContainText('2025-2026');
	await expect(page.locator('main')).not.toContainText('2026-2027');
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
	await page.screenshot({ path: info.outputPath('current-quiz-context.png'), fullPage: true });
});

test('an explicitly opened historical publication keeps its year and can still be unpublished', async ({
	app,
	page
}, info) => {
	if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 844 });
	await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		await createDatabase(client)
			.update(teachingContexts)
			.set({ archivedAt: new Date() })
			.where(eq(teachingContexts.id, app.ids.publicationContext));
	} finally {
		client.close();
	}
	await activate(page, app);
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`
	);
	const scope = page.locator('.publication-scope');
	await expect(scope.getByRole('combobox')).toHaveCount(0);
	await expect(scope.getByLabel('Classe sélectionnée', { exact: true })).toContainText('2026-2027');
	await expect(scope.getByRole('link', { name: 'Fin d’année', exact: true })).toHaveAttribute(
		'href',
		'/enseignant/classes/annees?annee=2026-2027'
	);
	await expect(page.getByRole('button', { name: /^Publier / })).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
	await page.screenshot({ path: info.outputPath('historical-publication-context.png'), fullPage: true });
	await page.getByRole('button', { name: 'Dépublier', exact: true }).click();
	const confirmation = page.getByRole('alertdialog', { name: 'Dépublier ce module ?', exact: true });
	await expect(confirmation).toContainText('2026-2027');
	const decided = page.waitForResponse(
		(response) =>
			response.url().endsWith(`/enseignant/modules/${app.ids.publicationModule}/publication?/decidePublication`) &&
			response.request().method() === 'POST',
		{ timeout: 30000 }
	);
	await confirmation.getByRole('button', { name: 'Dépublier ce module', exact: true }).click();
	const saved = await decided;
	expect(saved.status()).toBe(200);
	expect(await readFormActionCommand(saved.request())).toMatchObject({
		contextId: app.ids.publicationContext,
		action: 'unpublish',
		confirm: true
	});
	await expect(page.getByText('La page du module est dépubliée.', { exact: true })).toBeVisible();
});
