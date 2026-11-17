import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('module task actions and proposal detail rows keep independent controls', async ({ page, app }, info) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/modules');
	const search = page.getByRole('searchbox', { name: 'Rechercher un module' });
	await expect(async () => {
		await search.fill('aucun-module-de-test');
		await expect(page.getByText('Aucun module trouvé')).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await search.fill('');
	const desktop = info.project.name === 'desktop';
	const moduleRow = page.locator('.module-entry').first();
	const moduleLink = moduleRow.getByRole('link', { name: 'Préparer', exact: true });
	await expect(moduleRow.locator('.module-name')).not.toHaveAttribute('href');
	await expect(moduleLink).toBeVisible();
	const moduleUrl = await moduleLink.evaluate((link) => (link as HTMLAnchorElement).href);
	await moduleLink.focus();
	await expect(moduleLink).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(moduleUrl);
	await page.goto(app.origin + '/enseignant/modules');
	await page.locator('.module-entry').first().getByRole('link', { name: 'Préparer', exact: true }).click();
	await expect(page).toHaveURL(/section=preparation/);
	await expect(page.getByRole('tabpanel', { name: 'Notes privées', exact: false })).toBeVisible();

	// The normal route opens the first available proposal directly. Its queue appears
	// when that assessment is unavailable, so seed that state only in the owned fixture.
	await app.call('retire-proposal-assessment');
	await page.goto(app.origin + '/enseignant/propositions');
	const proposalRow = page
		.getByRole('table', {
			name: 'Propositions de correction par étudiant et évaluation'
		})
		.locator('tbody tr')
		.first();
	const proposalLink = proposalRow.locator('a[data-row-link]');
	await expect(proposalLink).toBeVisible();
	if (desktop) {
		const header = proposalRow.locator('xpath=ancestor::table').locator('thead tr');
		const color = await header.evaluate((row) => getComputedStyle(row).backgroundColor);
		await header.hover();
		await page.screenshot({
			path: info.outputPath('proposal-header-hover.png'),
			animations: 'disabled'
		});
		await expect(header).toHaveCSS('background-color', color);
		await proposalLink.hover();
		await expect(proposalLink).toHaveCSS('text-decoration-line', 'none');
	}
	const proposalUrl = await proposalLink.evaluate((link) => (link as HTMLAnchorElement).href);
	await expect(async () => {
		await proposalRow.locator('td').nth(1).click();
		await expect(page).toHaveURL(proposalUrl, { timeout: 1000 });
	}).toPass({ timeout: 60000 });
	if (desktop) {
		const screens = [
			['classes', '/enseignant/classes'],
			['bareme', `/enseignant/modules/${app.ids.module}/bareme`],
			['notation', `/enseignant/notation?module=${app.ids.module}`]
		] as const;
		for (const [screen, path] of screens) {
			await page.goto(app.origin + path);
			const headers = page.locator('thead tr');
			await expect(headers.first()).toBeVisible();
			for (const theme of ['light', 'dark'] as const) {
				await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
				await expect
					.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark')))
					.toBe(theme === 'dark');
				for (const header of await headers.all()) {
					if (!(await header.isVisible())) continue;
					await page.mouse.move(0, 0);
					const color = await header.evaluate((row) => getComputedStyle(row).backgroundColor);
					await header.hover();
					await page.screenshot({
						path: info.outputPath(`${screen}-${theme}-header.png`),
						animations: 'disabled'
					});
					await expect(header).toHaveCSS('background-color', color);
				}
			}
		}
	}
});

test('module task actions expose keyboard focus without making the heading interactive', async ({ app, page }) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/modules');
	const row = page.locator('.module-entry').first();
	const link = row.getByRole('link', { name: 'Préparer', exact: true });
	await expect(link).toBeVisible();
	await link.focus();
	await expect(link).toBeFocused();
	await expect(link).toHaveCSS('outline-style', 'solid');
	await expect(link).toHaveCSS('outline-width', '2px');
	await expect(row.locator('.module-name')).not.toHaveAttribute('tabindex');
});
