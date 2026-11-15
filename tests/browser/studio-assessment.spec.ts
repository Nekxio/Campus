import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('proposal filters fit narrow screens and keep selection distinct from hover', async ({ page, app }, info) => {
	test.skip(info.project.name !== 'desktop', 'The scenario exercises narrow and wide viewports.');
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/propositions');
	const filters = page.locator('[data-slot="toggle-group"][aria-label="Filtrer les propositions"]');
	const all = filters.getByRole('radio', { name: 'Toutes', exact: true });
	const points = filters.getByRole('radio', { name: 'Points à examiner', exact: true });
	await expect(filters).toBeVisible();
	await expect(filters.getByRole('radio')).toHaveCount(3);
	for (const width of [320, 390, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		await page.evaluate(() => document.fonts.ready);
		for (const item of await filters.getByRole('radio').all()) {
			const bounds = await item.boundingBox();
			expect(bounds).not.toBeNull();
			expect(bounds!.height, `${width}px: touch target`).toBeGreaterThanOrEqual(44);
			expect(bounds!.x, `${width}px: left edge`).toBeGreaterThanOrEqual(0);
			expect(bounds!.x + bounds!.width, `${width}px: right edge`).toBeLessThanOrEqual(width);
			expect(
				await item.evaluate((element) => element.scrollWidth - element.clientWidth),
				`${width}px: label overflow`
			).toBeLessThanOrEqual(1);
		}
		await expect
			.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
			.toBeLessThanOrEqual(1);
		await page.screenshot({
			path: info.outputPath(`proposal-filters-${width}.png`),
			fullPage: true,
			animations: 'disabled'
		});
	}
	await expect(async () => {
		await points.click();
		await expect(points).toHaveAttribute('aria-checked', 'true', { timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await all.hover();
	await page.screenshot({
		path: info.outputPath('proposal-filters-hover.png'),
		animations: 'disabled'
	});
	const selectedColor = await points.evaluate((element) => getComputedStyle(element).backgroundColor);
	await expect(all).not.toHaveCSS('background-color', selectedColor);
	await all.focus();
	await page.keyboard.press('Space');
	await expect(all).toHaveAttribute('aria-checked', 'true');
	await expect(points).toHaveAttribute('aria-checked', 'false');
});

test('proposal search can recover from an empty result without changing the queue', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/propositions');
	const originalQueue = await page
		.getByRole('link', { name: /Examiner la proposition pour/ })
		.evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href));
	const search = page.getByRole('searchbox', { name: 'Rechercher une proposition' });
	await expect(search).toBeVisible();
	await expect(async () => {
		await search.fill('NO_MATCH_STUDIO');
		await expect(page.getByText('Aucune proposition pour ces filtres')).toBeVisible({
			timeout: 1000
		});
	}).toPass({ timeout: 60000 });
	await page.getByRole('button', { name: 'Réinitialiser les filtres', exact: true }).click();
	await expect(search).toHaveValue('');
	await expect(page.getByRole('link', { name: /Examiner la proposition pour/ }).first()).toBeVisible();
	await search.fill('Aline');
	await expect(page.getByRole('link', { name: /Examiner la proposition pour Aline/ }).first()).toBeVisible();
	await page
		.getByRole('link', { name: /Examiner la proposition pour Aline/ })
		.first()
		.click();
	await expect(page.locator('#proposal-points-form')).toBeVisible();
	await page.getByRole('link', { name: 'Toutes les propositions', exact: true }).click();
	await expect(page).toHaveURL(app.origin + '/enseignant/propositions');
	await expect
		.poll(() =>
			page
				.getByRole('link', { name: /Examiner la proposition pour/ })
				.evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href))
		)
		.toEqual(originalQueue);
});

test('assessment workspaces retain their context and fit compact and wide screens', async ({ page, app }, info) => {
	test.skip(info.project.name !== 'desktop', 'The scenario explicitly exercises all four widths.');
	await activate(page, app);
	const screens = [
		{
			name: 'grading',
			path: `/enseignant/notation?contexte=${app.ids.currentContext}`,
			title: 'Notation'
		},
		{
			name: 'rubric',
			path: `/enseignant/modules/${app.ids.module}/bareme?contexte=${app.ids.currentContext}`,
			title: 'Barème et calculs'
		},
		{
			name: 'correction',
			path: `/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`,
			title: 'Aline Moreau'
		},
		{
			name: 'publication',
			path: `/enseignant/modules/${app.ids.module}/publication?contexte=${app.ids.currentContext}`,
			title: 'Publication du module'
		}
	];
	for (const width of [1440, 1280, 390, 375]) {
		await page.setViewportSize({ width, height: 900 });
		for (const screen of screens) {
			await page.goto(app.origin + screen.path);
			await expect(page.getByRole('heading', { name: screen.title, exact: true })).toBeVisible();
			await expect
				.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
				.toBe(true);
			if (width === 1440 || width === 390)
				await page.screenshot({
					path: `.playwright-mcp/studio-${screen.name}-${width}.png`,
					fullPage: true,
					animations: 'disabled'
				});
		}
	}
});
