import { expect, type Page } from '@playwright/test';

export const openModulePages = async (page: Page) => {
	const trigger = page.getByRole('button', { name: 'Changer de page du module', exact: true });
	const dialog = page.getByRole('dialog', { name: 'Pages du module', exact: true });
	if ((await trigger.isVisible()) && !(await dialog.isVisible())) {
		await expect(async () => {
			if (!(await dialog.isVisible())) await trigger.click();
			await expect(dialog).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 15000 });
	}
	return page.getByRole('navigation', { name: 'Pages du module', exact: true });
};

export const closeModulePages = async (page: Page) => {
	const dialog = page.getByRole('dialog', { name: 'Pages du module', exact: true });
	if (await dialog.isVisible()) {
		await page.keyboard.press('Escape');
		await expect(dialog).not.toBeVisible();
	}
};
