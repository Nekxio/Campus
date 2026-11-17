import { test as base, expect } from '@playwright/test';
import { startFixture, type BrowserFixture } from './support/process.js';
import type { Page } from '@playwright/test';

export async function readyModuleEditor(page: Page) {
	const full = page.getByRole('button', { name: 'Ouvrir l’éditeur complet', exact: true });
	if (await full.isVisible()) {
		await expect(async () => {
			if (await full.isVisible()) await full.click();
			await expect(page.getByLabel('Nom du module', { exact: true })).toBeFocused({
				timeout: 1000
			});
		}).toPass({ timeout: 60000 });
	}
	const section = page.getByLabel('Section du module', { exact: true });
	if (await section.isVisible()) {
		await expect(async () => {
			await section.selectOption('preparation');
			await expect(page.getByRole('tabpanel', { name: 'Notes privées', exact: false })).toBeVisible({
				timeout: 1000
			});
		}).toPass({ timeout: 60000 });
		await expect(async () => {
			await section.selectOption('information');
			await expect(page.getByLabel('Nom du module', { exact: true })).toBeVisible({
				timeout: 1000
			});
		}).toPass({ timeout: 60000 });
		return;
	}
	const preparation = page.getByRole('tab', { name: 'Notes privées', exact: false });
	await expect(async () => {
		await preparation.click();
		await expect(preparation).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await expect(async () => {
		await page.getByRole('tab', { name: 'Informations', exact: false }).click();
		await expect(page.getByLabel('Nom du module', { exact: true })).toBeVisible({
			timeout: 1000
		});
	}).toPass({ timeout: 60000 });
}

export const test = base.extend<{ app: BrowserFixture }>({
	app: async ({ browser, context }, use, testInfo) => {
		const runtime = {
			browser: browser.browserType().name(),
			channel: testInfo.project.use.channel ?? 'bundled',
			version: browser.version()
		};
		console.info('Browser runtime:', JSON.stringify(runtime));
		testInfo.annotations.push({ type: 'browser-runtime', description: JSON.stringify(runtime) });
		const app = await startFixture();
		console.info('Fixture setup milliseconds:', JSON.stringify(app.timings));
		testInfo.annotations.push({
			type: 'fixture-timings-ms',
			description: JSON.stringify(app.timings)
		});
		const unexpected: string[] = [];
		await context.route('**/*', async (route) => {
			if (new URL(route.request().url()).origin === app.origin) await route.continue();
			else {
				unexpected.push(new URL(route.request().url()).origin);
				await route.abort();
			}
		});
		try {
			await use(app);
		} finally {
			await app.stop();
			expect(unexpected, 'Unexpected outbound browser requests').toEqual([]);
		}
	}
});
export { expect };
