import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('selected student prioritizes correction while class export remains explained and contextual', async ({
	page,
	app
}, info) => {
	await activate(page, app);
	const destination = `${app.origin}/enseignant/notation?module=${app.ids.module}&etudiant=${app.ids.students[0]}`;
	await page.setViewportSize({ width: 375, height: 667 });
	await page.goto(destination);
	const summary = page.locator('#selected-student-summary');
	const correction = summary.getByRole('link', { name: 'Ouvrir la correction détaillée' });
	await expect(correction).toBeVisible();
	await expect(
		summary.getByRole('button', {
			name: 'Télécharger le PDF individuel de Aline Moreau',
			exact: true
		})
	).toBeEnabled();
	await page.screenshot({
		path: info.outputPath('student-mobile.png'),
		fullPage: true,
		animations: 'disabled'
	});
	await expect(correction).toBeInViewport();
	const exportRegion = page.getByRole('region', { name: 'Export PDF du module', exact: true });
	const disclosure = exportRegion.locator('summary');
	await expect(disclosure).toContainText('Indisponible');
	await disclosure.focus();
	await page.keyboard.press('Enter');
	await expect(exportRegion.getByRole('button', { name: 'Télécharger le PDF', exact: true })).toBeDisabled();
	await expect(exportRegion.locator('details')).toHaveJSProperty('open', true);
	await expect(exportRegion).toContainText('résultats');
	await disclosure.click();
	await expect(exportRegion.locator('details')).not.toHaveAttribute('open');
	await expect(exportRegion.locator('button')).toBeHidden();
	await expect(correction).toHaveAttribute('href', new RegExp(app.ids.currentContext + '/' + app.ids.students[0]));
	for (const width of [375, 390, 1280, 1728]) {
		await page.setViewportSize({ width, height: width < 1000 ? 667 : 1000 });
		for (const theme of ['light', 'dark']) {
			await page.evaluate((value) => {
				document.documentElement.classList.toggle('dark', value === 'dark');
			}, theme);
			await expect
				.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
				.toBe(true);
			await expect(exportRegion.locator('details')).toHaveJSProperty('open', false);
			await page.screenshot({
				path: info.outputPath(`student-${width}-${theme}.png`),
				fullPage: true,
				animations: 'disabled'
			});
		}
		if (width >= 1280) {
			const module = await page.getByLabel('Module', { exact: true }).boundingBox();
			expect(module!.width).toBeGreaterThan(300);
		}
	}
	await page.setViewportSize({ width: 375, height: 667 });
	await correction.click();
	await expect(page).toHaveURL(new RegExp(app.ids.currentContext + '/' + app.ids.students[0]));
});
