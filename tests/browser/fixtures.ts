import { test as base, expect } from '@playwright/test';
import { startFixture, type BrowserFixture } from './support/process.js';
import type { Page } from '@playwright/test';

export async function readyModuleEditor(page: Page) {
	const section = page.getByLabel('Section du module', { exact: true });
	if (await section.isVisible()) {
		await expect(async () => {
			await section.selectOption('preparation');
			await expect(page.getByRole('tabpanel', { name: 'Préparation', exact: true })).toBeVisible({
				timeout: 1000
			});
		}).toPass({ timeout: 15000 });
		await section.selectOption('information');
		await expect(page.getByLabel('Nom du module (obligatoire)', { exact: true })).toBeVisible();
		return;
	}
	const preparation = page.getByRole('tab', { name: 'Préparation', exact: true });
	await expect(async () => {
		await preparation.click();
		await expect(preparation).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
	}).toPass({ timeout: 15000 });
	await page.getByRole('tab', { name: 'Informations', exact: true }).click();
	await expect(page.getByLabel('Nom du module (obligatoire)', { exact: true })).toBeVisible();
}

export const test = base.extend<{ app: BrowserFixture }>({
	app: async ({ context }, use, testInfo) => {
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
