import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { returnToGradingClass } from './support/grading.js';
import type { Locator } from '@playwright/test';

async function contrast(button: Locator) {
	return button.evaluate((element) => {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 1;
		const context = canvas.getContext('2d')!;
		function color(value: string) {
			context.clearRect(0, 0, 1, 1);
			context.fillStyle = value;
			context.fillRect(0, 0, 1, 1);
			const p = context.getImageData(0, 0, 1, 1).data;
			return [p[0], p[1], p[2], p[3] / 255];
		}
		function over(a: number[], b: number[]) {
			return [a[0] * a[3] + b[0] * (1 - a[3]), a[1] * a[3] + b[1] * (1 - a[3]), a[2] * a[3] + b[2] * (1 - a[3]), 1];
		}
		let background = [255, 255, 255, 1];
		const ancestors: Element[] = [];
		for (let p: Element | null = element; p; p = p.parentElement) ancestors.unshift(p);
		for (const p of ancestors) background = over(color(getComputedStyle(p).backgroundColor), background);
		const foreground = over(color(getComputedStyle(element).color), background);
		function luminance(rgb: number[]) {
			const c = rgb.slice(0, 3).map((value) => {
				value /= 255;
				return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
			});
			return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
		}
		const a = luminance(foreground),
			b = luminance(background);
		return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
	});
}

test('navigation remains usable after student selection and document scrolling', async ({ page, app }, info) => {
	await app.call('complete-class');
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/notation?module=' + app.ids.module);
	const mobile = info.project.name === 'mobile';
	const rows = page.locator(mobile ? '.mobile-grid .student-row' : '.desktop-grid tbody tr');
	await expect(page.getByRole('button', { name: 'Télécharger le PDF', exact: true })).toBeEnabled();
	if (mobile) await rows.first().getByRole('button').tap();
	await expect(
		page.getByRole('button', { name: 'Télécharger le PDF individuel de Aline Moreau', exact: true })
	).toBeEnabled();
	await returnToGradingClass(page);
	const student = rows.nth(1).getByRole('button');
	if (mobile) await student.tap();
	else await student.click();
	const summary = page.locator('#selected-student-summary');
	await expect(summary).toHaveAccessibleName('Bilan de Camille Demo');
	if (mobile) {
		await expect(summary).toBeFocused();
		const cdp = await page.context().newCDPSession(page);
		await cdp.send('Input.synthesizeScrollGesture', {
			x: 300,
			y: 300,
			yDistance: -1000,
			speed: 1200,
			gestureSourceType: 'touch'
		});
		await cdp.detach();
		await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(200);
		const header = page.locator('.teacher-header');
		await expect(header).toHaveCSS('position', 'sticky');
		const bounds = await header.boundingBox();
		expect(bounds!.y).toBeGreaterThanOrEqual(0);
		expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(60);
		const toggle = page.getByRole('button', { name: 'Ouvrir la navigation', exact: true });
		await toggle.tap();
		const dialog = page.getByRole('dialog', { name: 'Navigation principale', exact: true });
		await expect(dialog).toBeVisible();
		for (let i = 0; i < 12; i++) {
			await page.keyboard.press('Tab');
			expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
		}
		await page.keyboard.press('Escape');
		await expect(toggle).toBeFocused();
		await page.screenshot({
			path: info.outputPath('navigation-after-student-scroll.png'),
			animations: 'disabled'
		});
		await toggle.tap();
		await page.getByRole('dialog').getByRole('link', { name: 'Classes', exact: true }).tap();
	} else {
		await page
			.getByRole('navigation', { name: 'Navigation principale' })
			.getByRole('link', { name: 'Classes', exact: true })
			.click();
	}
	await expect(page).toHaveURL(app.origin + '/enseignant/classes');
	await expect(page.getByRole('heading', { name: 'Mes classes', exact: true })).toBeVisible();
});

test('public theme alignment and annual-action contrast hold in both themes', async ({ page, app }, info) => {
	await activate(page, app);
	const measurements: object[] = [];
	for (const theme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
		await page.goto(app.origin + '/modules/' + app.ids.publicationContext);
		const themeButton = page.getByRole('button', { name: 'Choisir le thème', exact: true });
		await expect(themeButton).toBeVisible();
		const alignment = await themeButton.evaluate((node) => ({
			button: node.getBoundingClientRect().toJSON(),
			inner: node.closest('.header-inner')!.getBoundingClientRect().toJSON()
		}));
		expect(alignment.button.right).toBeCloseTo(alignment.inner.right, 0);
		if (info.project.name === 'mobile') expect(alignment.button.height).toBeGreaterThanOrEqual(44);
		await expect(async () => {
			await themeButton.click();
			await expect(page.getByRole('menuitemradio', { name: 'Thème système', exact: true })).toBeVisible({
				timeout: 1000
			});
		}).toPass({ timeout: 15000 });
		await page.keyboard.press('Escape');
		await expect(themeButton).toBeFocused();
		await page.screenshot({
			path: info.outputPath('public-theme-' + theme + '.png'),
			animations: 'disabled'
		});
		await page.goto(app.origin + '/enseignant/classes/annees?annee=2026-2027');
		await page.waitForLoadState('networkidle');
		const close = page.getByRole('button', { name: 'Préparer la clôture', exact: true });
		await expect(close).toBeEnabled();
		await page.mouse.move(0, 0);
		const normal = await contrast(close);
		await close.hover();
		await close.evaluate(async (node) => {
			await Promise.allSettled(node.getAnimations().map((animation) => animation.finished));
		});
		const hover = await contrast(close);
		await page.mouse.move(0, 0);
		await close.focus();
		await page.keyboard.press('Shift+Tab');
		await page.keyboard.press('Tab');
		await expect(close).toBeFocused();
		const focus = await contrast(close);
		for (const value of [normal, hover, focus]) expect(value).toBeGreaterThanOrEqual(4.5);
		measurements.push({ theme, normal, hover, focus, alignment });
	}
	await info.attach('public-alignment-and-closure-contrast', {
		body: JSON.stringify(measurements),
		contentType: 'application/json'
	});
});
