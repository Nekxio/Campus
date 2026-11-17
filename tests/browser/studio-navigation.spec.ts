import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('library filters recover and browser history restores the chosen work', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules`);
	await page.waitForLoadState('networkidle');
	const search = page.getByRole('searchbox', { name: 'Rechercher un module', exact: true });
	await search.fill('publication');
	await expect(page.getByText('1 module affiché', { exact: true })).toBeVisible();
	await page.getByRole('combobox', { name: 'Afficher', exact: true }).selectOption('unassigned');
	await expect(page.getByText('Aucun module trouvé', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Réinitialiser la recherche', exact: true }).click();
	await search.fill('publication');
	await page
		.getByRole('navigation', { name: 'Travailler sur Application web · publication démo', exact: true })
		.getByRole('link', { name: 'Préparer', exact: true })
		.click();
	await expect(page.locator('h1')).toContainText('Application web · publication démo');
	await page.goBack();
	await expect(search).toHaveValue('publication');
	await expect(page.getByText('1 module affiché', { exact: true })).toBeVisible();
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page
		.getByRole('navigation', { name: 'Travailler sur Application web · publication démo', exact: true })
		.getByRole('link', { name: 'Préparer', exact: true })
		.click();
	await expect(page.getByRole('tabpanel', { name: 'Notes privées', exact: false })).toBeVisible();
	expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
	await page.keyboard.press('Tab');
	expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
});
