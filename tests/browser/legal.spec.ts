import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import type { NativeQuizFixture } from '../../src/lib/server/db/testing/quiz-fixtures.js';

test('the legal header returns to the application without JavaScript', async ({ browser, app }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	try {
		const page = await context.newPage();
		for (const path of ['mentions-legales', 'confidentialite', 'conditions-utilisation']) {
			await page.goto(`${app.origin}/${path}`);
			const logo = page.getByRole('banner').getByRole('link', { name: 'Campus', exact: true });
			await logo.click();
			await expect(page).toHaveURL(`${app.origin}/connexion`);
		}
	} finally {
		await context.close();
	}
});

test('legal information is public, readable without JavaScript and navigable', async ({ browser, page, app }) => {
	const routes = [
		['mentions-legales', 'Mentions légales'],
		['confidentialite', 'Politique de confidentialité'],
		['conditions-utilisation', 'Conditions d’utilisation']
	] as const;
	const noScript = await browser.newContext({
		javaScriptEnabled: false,
		viewport: page.viewportSize()!
	});
	try {
		const reader = await noScript.newPage();
		for (const [path, title] of routes) {
			const response = await reader.goto(`${app.origin}/${path}`);
			expect(response?.status()).toBe(200);
			expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow');
			await expect(reader.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
			await expect(reader.getByRole('navigation', { name: 'Sommaire' })).toBeVisible();
			const contents = reader.getByRole('navigation', { name: 'Sommaire' });
			const toggle = contents.locator('summary');
			await expect(contents.getByRole('list')).toBeHidden();
			await toggle.focus();
			await reader.keyboard.press('Enter');
			await expect(contents.getByRole('list')).toBeVisible();
			await reader.keyboard.press('Space');
			await expect(contents.getByRole('list')).toBeHidden();
			await toggle.click();
			await expect(contents.getByRole('list')).toBeVisible();
			await contents.getByRole('link').first().click();
			await expect(reader.locator('.legal-copy section').first()).toBeInViewport();
			await expect(reader.getByRole('contentinfo')).toHaveCount(1);
			await expect(
				reader.getByRole('contentinfo').getByRole('link', { name: 'Confidentialité', exact: true })
			).toBeVisible();
		}
	} finally {
		await noScript.close();
	}
	await page.goto(`${app.origin}/confidentialite`);
	await page.getByRole('navigation', { name: 'Sommaire' }).locator('summary').click();
	await page
		.getByRole('navigation', { name: 'Sommaire' })
		.getByRole('link', { name: 'Cookies et stockage local' })
		.click();
	await expect(page).toHaveURL(/#cookies$/);
	await expect(page.getByRole('heading', { name: 'Cookies et stockage local', exact: true })).toBeInViewport();
	await page.goto(`${app.origin}/confidentialite`);
	for (const theme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: theme });
		await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
		const contrasts = await page
			.locator(
				'main, main summary, main .updated, main .introduction, main dt, main .storage-duration, main .legal-aside, main .legal-note, main a, footer a'
			)
			.evaluateAll((elements) => {
				const canvas = document.createElement('canvas');
				const context = canvas.getContext('2d')!;
				const luminance = (value: string) => {
					context.clearRect(0, 0, 1, 1);
					context.fillStyle = value;
					context.fillRect(0, 0, 1, 1);
					return Array.from(context.getImageData(0, 0, 1, 1).data)
						.slice(0, 3)
						.map((channel) => {
							const unit = channel / 255;
							return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
						})
						.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
				};
				return elements.map((element) => {
					let surface: Element | null = element;
					let backgroundColor = getComputedStyle(document.body).backgroundColor;
					while (surface) {
						const value = getComputedStyle(surface).backgroundColor;
						context.clearRect(0, 0, 1, 1);
						context.fillStyle = value;
						context.fillRect(0, 0, 1, 1);
						if (context.getImageData(0, 0, 1, 1).data[3] === 255) {
							backgroundColor = value;
							break;
						}
						surface = surface.parentElement;
					}
					const background = luminance(backgroundColor);
					const text = luminance(getComputedStyle(element).color);
					return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
				});
			});
		for (const ratio of contrasts) expect(ratio).toBeGreaterThanOrEqual(4.5);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		const contentsToggle = page.getByRole('navigation', { name: 'Sommaire' }).locator('summary');
		await contentsToggle.click();
		await expect(page.getByRole('navigation', { name: 'Sommaire' }).getByRole('list')).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await contentsToggle.click();
		await expect(page.getByRole('navigation', { name: 'Sommaire' }).getByRole('list')).toBeHidden();
	}
	await page.setViewportSize({ width: 320, height: 844 });
	for (const [path] of routes) {
		await page.goto(`${app.origin}/${path}`);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	}
	await page.goto(`${app.origin}/conditions-utilisation`);
	await expect(page.getByRole('contentinfo')).toHaveCount(1);
	await page.getByRole('contentinfo').getByRole('link', { name: 'Mentions légales', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Mentions légales', exact: true })).toBeVisible();
});

test('legal footers remain public and are absent from teacher and access shells', async ({ page, app }) => {
	for (const path of ['/connexion', '/activation', '/connexion/application', '/autoriser']) {
		await page.goto(app.origin + path);
		await expect(page.getByRole('main')).toHaveCount(1);
		await expect(page.getByRole('contentinfo')).toHaveCount(0);
		await expect(page.getByRole('navigation', { name: 'Informations légales' })).toHaveCount(0);
	}
	await activate(page, app, async () => {
		await expect(page.getByRole('contentinfo')).toHaveCount(0);
	});
	for (const path of [
		'/',
		'/enseignant/modules',
		'/enseignant/classes',
		'/enseignant/classes/annees',
		'/enseignant/compte',
		'/enseignant/nonexistent-legal-fixture'
	]) {
		await page.goto(app.origin + path);
		await expect(page.getByRole('contentinfo')).toHaveCount(0);
		await expect(page.getByRole('main')).toHaveCount(1);
		await expect(page.getByRole('navigation', { name: 'Informations légales' })).toHaveCount(0);
	}
	await page.goto(`${app.origin}/classes/${app.ids.currentClass}`);
	await expect(page.getByRole('contentinfo')).toHaveCount(1);
	await expect(page.getByRole('heading', { level: 1, name: 'B2 Demo' })).toBeVisible();
	const link = page.getByRole('contentinfo').getByRole('link', { name: 'Confidentialité', exact: true });
	await link.focus();
	await expect(link).toBeFocused();
	await page.goto(`${app.origin}/modules/${app.ids.publicationContext}`);
	await expect(page.getByRole('contentinfo')).toHaveCount(1);
	await expect(page.getByRole('heading', { level: 1, name: 'Application web · publication démo' })).toBeVisible();
	const quiz = await app.call<NativeQuizFixture>('native-quiz-ui');
	await page.goto(`${app.origin}/modules/${quiz.contextId}/quiz/${quiz.runId}`);
	await expect(page.getByRole('contentinfo')).toHaveCount(1);
	await expect(page.getByRole('main')).toHaveCount(1);
	await page.goto(`${app.origin}/modules/nonexistent-legal-fixture`);
	await expect(page.getByRole('contentinfo')).toHaveCount(1);
	await expect(page.getByRole('navigation', { name: 'Informations légales' })).toBeVisible();
});
