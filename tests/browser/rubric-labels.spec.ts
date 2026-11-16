import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('criterion labels remain readable with compact maxima, keyboard focus and errors', async ({ app, page }, info) => {
	await page.setViewportSize(
		info.project.name === 'desktop' ? { width: 1728, height: 851 } : { width: 375, height: 667 }
	);
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.publicationModule}/bareme`);
	const label = page.getByLabel('Libellé du critère 1', { exact: true });
	const maximum = page.getByLabel('Maximum du critère 1 (pts)', { exact: true });
	const save = page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).first();
	const original = await label.inputValue();
	await expect(async () => {
		await label.fill('Mise en forme CSS et lisibilité mobile');
		await expect(save).toBeEnabled({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	for (const text of [
		'Mise en forme CSS et lisibilité mobile',
		'Présentation et justification des choix',
		'Mise en forme CSS et lisibilité mobile : adaptation de la navigation, des contenus et des interactions aux différentes tailles d’écran'
	]) {
		await label.fill(text);
		await label.focus();
		await expect(label).toBeFocused();
		await expect(label).toHaveValue(text);
		expect(await label.evaluate((field) => field.scrollWidth - field.clientWidth)).toBeLessThanOrEqual(1);
		expect(await label.evaluate((field) => field.scrollHeight - field.clientHeight)).toBeLessThanOrEqual(1);
		await expect(maximum).toHaveValue('20');
	}
	for (const colorScheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
		await expect
			.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
			.toBe(colorScheme === 'dark');
		await page.screenshot({
			path: info.outputPath(`long-label-${colorScheme}.png`),
			fullPage: true
		});
		expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
	}
	await label.fill('');
	await label.press('Tab');
	await expect(label).toHaveAttribute('aria-invalid', 'true');
	await expect(label).toHaveAccessibleDescription(/\S/);
	await expect(save).toBeEnabled();
	let writes = 0;
	page.on('request', (request) => {
		if (request.method() === 'POST' && request.url().includes('?/saveRubric')) writes++;
	});
	await save.click();
	await expect(page.locator('[data-sonner-toast][data-type="error"]')).toContainText('Vérifiez les champs indiqués.');
	await expect(label).toHaveAttribute('aria-invalid', 'true');
	expect(writes).toBe(0);
	await label.focus();
	await expect(label).toBeFocused();
	await page.screenshot({ path: info.outputPath('label-error.png'), fullPage: true });
	await label.fill(original);
	await label.press('Tab');
	await expect(label).not.toHaveAttribute('aria-invalid', 'true');
	await expect(save).toBeDisabled();
});
