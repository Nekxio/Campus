import { fulfillFormAction } from './support/form-actions.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('publication section links preserve the reviewed context through history and reload', async ({
	app,
	page
}, info) => {
	page.setDefaultTimeout(15000);
	await activate(page, app);
	const contextId = app.ids.publicationContext;
	const path = `/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${contextId}&classe=${app.ids.currentClass}&annee=2026-2027&section=preparation`;
	await page.goto(app.origin + path);
	await page.waitForLoadState('networkidle');
	const mobileSections = page.locator('#publication-sections-trigger');
	if (await mobileSections.isVisible()) await mobileSections.click();
	const link = page.getByRole('link', { name: 'Consignes et barèmes', exact: true });
	await expect(link).toBeVisible();
	await link.click();
	await page.screenshot({
		path: info.outputPath('publication-section-before-url-check.png'),
		fullPage: true
	});
	await expect(page).toHaveURL(app.origin + path + `#review-${contextId}-consignes`);
	await expect(page.locator(`#review-${contextId}-consignes`)).toBeFocused();
	const historyLength = await page.evaluate(() => history.length);
	if (await mobileSections.isVisible()) await mobileSections.click();
	await link.click();
	await expect(page.locator(`#review-${contextId}-consignes`)).toBeFocused();
	expect(await page.evaluate(() => history.length)).toBe(historyLength);
	await page.reload();
	await expect(page.locator(`#review-${contextId}-consignes`)).toBeVisible();
	if (await mobileSections.isVisible()) await mobileSections.click();
	await expect(link).toHaveAttribute('aria-current', 'location');
	await page.getByRole('link', { name: 'Échéances et remise', exact: true }).click();
	await expect(page.locator(`#review-${contextId}-remise`)).toBeFocused();
	await page.goBack();
	await expect(page.locator(`#review-${contextId}-consignes`)).toBeVisible();
	await page.goForward();
	await expect(page.locator(`#review-${contextId}-remise`)).toBeVisible();
	expect(new URL(page.url()).searchParams.get('section')).toBe('preparation');
	expect(new URL(page.url()).searchParams.get('contexte')).toBe(contextId);
	for (const width of info.project.name === 'mobile' ? [375, 390] : [1280, 1728]) {
		await page.setViewportSize({ width, height: width === 375 ? 667 : 900 });
		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
			await page.goto(app.origin + path + `#review-${contextId}-ressources`);
			await page.waitForLoadState('networkidle');
			await expect(page.locator(`#review-${contextId}-ressources`)).toBeFocused();
			if (width < 768) {
				const heading = page.getByRole('heading', { name: 'Ressources utiles', exact: true });
				const headerBottom = await page
					.locator('.teacher-header')
					.evaluate((header) => header.getBoundingClientRect().bottom);
				await expect.poll(async () => (await heading.boundingBox())?.y ?? 0).toBeGreaterThanOrEqual(headerBottom);
			}
			expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
			await page.screenshot({
				path: info.outputPath(`publication-${width}-${colorScheme}-viewport.png`)
			});
			await page.screenshot({
				path: info.outputPath(`publication-${width}-${colorScheme}.png`),
				fullPage: true
			});
		}
	}
});

test('unknown sections fall back safely and unavailable archived previews remain unavailable', async ({
	app,
	page
}) => {
	page.setDefaultTimeout(15000);
	await activate(page, app);
	const base = `${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`;
	await page.goto(base + '#unknown-section');
	await expect(page).toHaveURL(base + `#review-${app.ids.publicationContext}-supports`);
	await expect(page.locator(`#review-${app.ids.publicationContext}-supports`)).toBeVisible();
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.module}/publication?contexte=${app.ids.oldContext}#review-${app.ids.oldContext}-consignes`
	);
	await expect(page.getByText('Aucun contenu à prévisualiser', { exact: true })).toBeVisible();
	await expect(page.locator(`#review-${app.ids.oldContext}-consignes`)).toHaveCount(0);
	await expect(page.getByRole('navigation', { name: 'Sections de l’aperçu' })).toHaveCount(0);
});

test('section navigation retains a rejected publication review until an explicit refresh', async ({ app, page }) => {
	page.setDefaultTimeout(15000);
	await activate(page, app);
	const contextId = app.ids.publicationContext;
	const path = `${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${contextId}&classe=${app.ids.currentClass}&annee=2026-2027&section=resources`;
	await page.goto(path);
	await page.waitForLoadState('networkidle');
	const endpoint = `${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?/decidePublication`;
	await page.route(endpoint, async (route) => {
		if (route.request().method() === 'POST') {
			await fulfillFormAction(route, { status: 409, message: 'La version a changé dans une autre fenêtre.' });
		} else await route.continue();
	});
	const publish = page.getByRole('button', {
		name: /^Publier (pour cette classe|la mise à jour)$/
	});
	await publish.click();
	const feedback = page.getByRole('alert').filter({ hasText: 'Version à vérifier de nouveau' });
	await expect(feedback).toBeVisible();
	await expect(publish).toBeDisabled();
	const mobileSections = page.locator('#publication-sections-trigger');
	if (await mobileSections.isVisible()) await mobileSections.click();
	await page.getByRole('link', { name: 'Consignes et barèmes', exact: true }).click();
	await expect(page).toHaveURL(path + `#review-${contextId}-consignes`);
	await expect(feedback).toBeVisible();
	await expect(publish).toBeDisabled();
	await page.goBack();
	await expect(feedback).toBeVisible();
	await expect(publish).toBeDisabled();
	if (await mobileSections.isVisible()) await mobileSections.click();
	await page.getByRole('link', { name: 'Consignes et barèmes', exact: true }).click();
	await page.getByRole('button', { name: 'Actualiser les références', exact: true }).first().click();
	await expect(feedback).toHaveCount(0);
	await expect(page.locator(`#review-${contextId}-consignes`)).toBeVisible();
	await expect(publish).toBeEnabled();
});

test('desktop review section changes keep the page position for short and long previews', async ({
	app,
	page
}, info) => {
	page.setDefaultTimeout(15000);
	test.skip(info.project.name !== 'desktop', 'The desktop preview scrolls independently.');
	await activate(page, app);
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`
	);
	await page.waitForLoadState('networkidle');
	for (const [id, label] of [
		['consignes', 'Consignes et barèmes'],
		['ressources', 'Ressources utiles'],
		['remise', 'Échéances et remise'],
		['supports', 'Supports du cours']
	]) {
		const link = page.locator(`.desktop-sections a[href="#review-${app.ids.publicationContext}-${id}"]`);
		await expect(link).toContainText(label);
		await link.scrollIntoViewIfNeeded();
		const before = await page.evaluate(() => window.scrollY);
		expect(before).toBeGreaterThan(0);
		await link.click();
		await expect(link).toHaveAttribute('aria-current', 'location');
		const target = page.locator(`#review-${app.ids.publicationContext}-${id}`);
		await expect(target).toBeFocused();
		const settledPosition = await page.evaluate(
			() => new Promise<number>((resolve) => window.setTimeout(() => resolve(window.scrollY), 500))
		);
		await expect(target).toBeFocused();
		expect(settledPosition).toBe(before);
	}
});
