import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('class PDF stays compact through student round trips and exposes a ready download', async ({
	page,
	app
}, info) => {
	await activate(page, app);
	const destination = `${app.origin}/enseignant/notation?module=${app.ids.module}`;
	await page.goto(destination);
	const region = page.getByRole('region', { name: 'Export PDF du module', exact: true });
	const details = region.locator('details');
	await expect(region.locator('summary')).toContainText('Indisponible');
	await expect(details).toHaveJSProperty('open', false);
	await region.locator('summary').focus();
	await page.keyboard.press('Enter');
	await expect(details).toHaveJSProperty('open', true);
	await expect(region.getByRole('button', { name: 'Télécharger le PDF', exact: true })).toBeDisabled();
	await expect(region).toContainText(/résultat|évaluation/);
	await region.locator('summary').click();
	await page.goto(`${destination}&etudiant=${app.ids.students[1]}`);
	await page.getByRole('link', { name: 'Ouvrir la correction détaillée', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(app.ids.students[1]));
	await page.getByRole('link', { name: 'Retour à la grille', exact: true }).click();
	await expect(details).toHaveJSProperty('open', false);
	if (info.project.name === 'mobile') {
		await page.getByRole('button', { name: 'Retour à la classe', exact: true }).click();
		await expect(details).toHaveJSProperty('open', false);
	}
	await app.call('complete-class');
	await page.reload();
	await expect(region.locator('summary')).toContainText('Disponible');
	await expect(details).toHaveJSProperty('open', false);
	const download = region.getByRole('button', { name: 'Télécharger le PDF', exact: true });
	await expect(download).toBeEnabled();
	for (const width of info.project.name === 'mobile' ? [375, 390] : [1280, 1728]) {
		await page.setViewportSize({ width, height: width < 1000 ? 667 : 851 });
		for (const theme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
			await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
			expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
			await page.screenshot({
				path: info.outputPath(`grid-${width}-${theme}.png`),
				fullPage: true
			});
		}
	}
	const file = page.waitForEvent('download');
	await download.click();
	await file;
});
