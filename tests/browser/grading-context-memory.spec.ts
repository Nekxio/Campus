import { createClient } from '@libsql/client';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/lib/server/db/index.js';
import * as tables from '../../src/lib/server/db/schema.js';
import type { GradingSelectionFixture } from '../../src/lib/server/db/testing/grading-selection-fixtures.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import type { Page } from '@playwright/test';

const showGradingContext = async (page: Page) => {
	// A full reload can expose SSR selectors before the router handles browser history.
	if ((page.viewportSize()?.width ?? 1440) >= 1024) {
		await expect(async () => {
			await page.getByRole('button', { name: 'Choisir le thème', exact: true }).click();
			await expect(page.getByRole('menuitemradio', { name: 'Thème système', exact: true })).toBeVisible({
				timeout: 1000
			});
		}).toPass({ timeout: 60000 });
		await page.keyboard.press('Escape');
	} else {
		await expect(async () => {
			const link = page.getByRole('link', { name: 'Notation', exact: true });
			if (!(await link.isVisible()))
				await page.getByRole('button', { name: 'Ouvrir la navigation', exact: true }).click();
			await expect(link).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 60000 });
		await page.keyboard.press('Escape');
	}
	await expect(async () => {
		const module = page.getByRole('combobox', { name: 'Module', exact: true });
		const toggle = page.getByRole('button', { name: 'Changer le contexte', exact: true });
		if (!(await module.isVisible()) && (await toggle.isVisible())) await toggle.click();
		await expect(module).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
};

const openGradingFromMenu = async (page: Page) => {
	const menu = page.getByRole('button', { name: /^(Ouvrir|Afficher) la navigation$/ });
	if ((page.viewportSize()?.width ?? 1440) < 768) {
		await expect(async () => {
			await menu.click();
			await expect(page.getByRole('link', { name: 'Notation', exact: true })).toBeVisible({
				timeout: 1000
			});
		}).toPass({ timeout: 60000 });
	}
	await page.getByRole('link', { name: 'Notation', exact: true }).click();
	await showGradingContext(page);
};

test('the grading menu starts without an explicit class in the latest year', async ({ app, page }) => {
	const ids = await app.call<GradingSelectionFixture>('grading-selection');
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/notation?contexte=' + ids.futureContext);
	await page.goto(app.origin + '/');
	await openGradingFromMenu(page);
	const schoolClass = page.getByLabel('Classe', { exact: true });
	const module = page.getByRole('combobox', { name: 'Module', exact: true });
	await expect(schoolClass.locator('option')).toHaveText(['Choisir une classe', 'B2 Demo']);
	await expect(schoolClass).toHaveValue('');
	await expect(module).toBeDisabled();
	await schoolClass.selectOption(ids.futureClass);
	await expect(page).toHaveURL(new RegExp('contexte=' + ids.futureContext));
	await expect(module).toHaveValue(ids.futureModule);
});

test('an archived remembered context falls back visibly and selection never writes grades', async ({ app, page }) => {
	const ids = await app.call<GradingSelectionFixture>('grading-selection');
	const initialClient = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		await createDatabase(initialClient)
			.insert(tables.academicYears)
			.values({ academicYear: '2027-2028', archivedAt: new Date() });
	} finally {
		initialClient.close();
	}
	await activate(page, app);
	const writes: string[] = [];
	page.on('request', (request) => {
		if (request.url().includes('/api/teaching/') && request.method() !== 'GET') writes.push(request.method());
	});
	await page.goto(app.origin + '/enseignant/notation?contexte=' + ids.b3Context);
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		await createDatabase(client)
			.update(tables.teachingContexts)
			.set({ archivedAt: new Date() })
			.where(eq(tables.teachingContexts.id, ids.b3Context));
	} finally {
		client.close();
	}
	await page.goto(app.origin + '/enseignant/notation');
	await expect(
		page.getByRole('status').filter({ hasText: 'Le dernier contexte de notation n’est plus disponible' })
	).toBeVisible();
	await expect(page.getByLabel('Classe', { exact: true })).toHaveValue(ids.b3Class);
	await expect(page.getByLabel('Module', { exact: true })).toHaveValue('');
	await expect(page.locator('#selected-student-summary')).toHaveCount(0);
	expect(writes).toEqual([]);
});
