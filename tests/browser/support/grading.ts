import { expect, type Page } from '@playwright/test';

export const gradingRows = (page: Page) =>
	page.locator('.mobile-grid .student-row:visible, .desktop-grid tbody tr:visible');

export async function showGradingContext(page: Page) {
	const module = page.getByRole('combobox', { name: 'Module', exact: true });
	const toggle = page.getByRole('button', { name: 'Changer le contexte', exact: true });
	await expect(async () => {
		if (!(await module.isVisible()) && (await toggle.isVisible())) await toggle.click();
		await expect(module).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
}

export async function returnToGradingClass(page: Page) {
	const back = page.getByRole('button', { name: 'Retour à la classe', exact: true });
	if (!(await back.isVisible())) return;
	await back.click();
	await expect(page.locator('#selected-student-summary')).not.toBeVisible();
	await expect(page.getByRole('heading', { name: 'Étudiants', exact: true })).toBeVisible();
}

export async function openGradingFilters(page: Page) {
	const dialog = page.getByRole('dialog', { name: 'Filtrer les étudiants', exact: true });
	if (!(await dialog.isVisible())) {
		await expect(async () => {
			await page.getByRole('button', { name: 'Filtrer les étudiants', exact: true }).click();
			await expect(dialog).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 60000 });
	}
	return dialog;
}

export async function setGradingFilters(
	page: Page,
	values: { search?: string; filter?: 'all' | 'pending' | 'complete' | 'absence' }
) {
	const mobile = (page.viewportSize()?.width ?? 1440) < 1024;
	const panel = mobile ? await openGradingFilters(page) : null;
	const controls = panel ?? page;
	if (values.search !== undefined)
		await controls.getByRole('searchbox', { name: 'Rechercher un étudiant', exact: true }).fill(values.search);
	if (values.filter !== undefined)
		await controls.getByRole('combobox', { name: 'Afficher', exact: true }).selectOption(values.filter);
	if (panel) {
		await panel.getByRole('button', { name: 'Voir les résultats', exact: true }).click();
		await expect(panel).not.toBeVisible();
	}
}
