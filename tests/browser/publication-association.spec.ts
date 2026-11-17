import { openModulePages } from './support/module-navigation.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { emptyModule, type ModuleDetail } from '../../src/lib/teaching/types.js';

test('publication without a class opens association directly and offers a return after saving', async ({
	app,
	page
}, info) => {
	await activate(page, app);
	const response = await page.request.post(app.origin + '/api/teaching/modules', {
		headers: { 'Idempotency-Key': crypto.randomUUID(), Origin: app.origin },
		data: { ...emptyModule(), title: 'Association fictive depuis la publication' }
	});
	expect(response.ok()).toBe(true);
	const module: ModuleDetail = await response.json();
	const publication = `${app.origin}/enseignant/modules/${module.id}/publication`;
	await page.goto(publication);
	await expect(page.getByRole('link', { name: 'Associer une classe', exact: true })).toBeVisible();
	await page.getByRole('link', { name: 'Associer une classe', exact: true }).click();
	await expect(page.getByRole('tabpanel', { name: 'Classe et planning', exact: false })).toBeVisible();
	const schoolClass = page.getByRole('combobox', { name: /^Classe à associer(?: \(optionnel\))?$/, exact: true });
	await expect(schoolClass).toBeFocused();
	await page.reload();
	await expect(schoolClass).toBeFocused();
	await page.goBack();
	await expect(page.getByRole('link', { name: 'Associer une classe', exact: true })).toBeVisible();
	await page.goForward();
	await expect(schoolClass).toBeFocused();
	for (const width of info.project.name === 'mobile' ? [375, 390] : [1280, 1728]) {
		await page.setViewportSize({ width, height: width === 375 ? 667 : 851 });
		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
			await expect
				.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
				.toBe(colorScheme === 'dark');
			await schoolClass.focus();
			await expect(schoolClass).toBeInViewport();
			expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
			await page.screenshot({ path: info.outputPath(`association-${width}-${colorScheme}.png`) });
		}
	}
	await schoolClass.selectOption(app.ids.currentClass);
	await (await openModulePages(page)).getByRole('link', { name: 'Publication', exact: true }).click();
	await expect(page.getByRole('alertdialog', { name: 'Quitter le module ?', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(schoolClass).toHaveValue(app.ids.currentClass);
	const saved = page.waitForResponse(
		(result) =>
			result.url().endsWith(`/enseignant/modules/${module.id}?/saveModule`) && result.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first().click();
	expect((await saved).status()).toBe(200);
	await expect(page.getByText('Module enregistré.', { exact: true })).toBeVisible();
	await (await openModulePages(page)).getByRole('link', { name: 'Publication', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Première publication', exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Associer une classe', exact: true })).toHaveCount(0);
	await page.screenshot({
		path: info.outputPath('publication-class-associated.png'),
		fullPage: true
	});
});
