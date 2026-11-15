import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('sharing describes published courses and never carries private workspace context', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(`${app.origin}/modules/${app.ids.publicationContext}`);
	const title = page.locator('meta[property="og:title"]');
	const description = page.locator('meta[property="og:description"]');
	await expect(title).toHaveCount(1);
	await expect(title).toHaveAttribute('content', await page.title());
	const pageDescription = await page.locator('meta[name="description"]').getAttribute('content');
	expect(pageDescription).toBeTruthy();
	await expect(description).toHaveAttribute('content', pageDescription!);

	await page.goto(`${app.origin}/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`);
	await expect(title).toHaveCount(1);
	await expect(title).toHaveAttribute('content', 'Campus');
	await expect(description).toHaveAttribute('content', 'Préparer, évaluer et partager les cours avec Campus.');
	await expect(page.locator('meta[name="description"]')).toHaveCount(1);
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

	const image = page.locator('meta[property="og:image"]');
	const imageUrl = await image.getAttribute('content');
	expect(new URL(imageUrl!).origin).toBe(app.origin);
	const response = await page.request.get(imageUrl!);
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toContain('image/png');
	const png = await response.body();
	expect(png.readUInt32BE(16)).toBe(1200);
	expect(png.readUInt32BE(20)).toBe(630);
	for (const selector of ['link[rel="icon"][type="image/svg+xml"]', 'link[rel="apple-touch-icon"]']) {
		const icon = await page.locator(selector).getAttribute('href');
		const asset = await page.evaluate(async (href) => {
			const response = await fetch(href);
			return { ok: response.ok, type: response.headers.get('content-type') };
		}, icon!);
		expect(asset.ok).toBe(true);
		expect(asset.type).toMatch(/^image\/(svg\+xml|png)/);
	}
});
