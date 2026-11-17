import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

const measureWorkspace = async (page: Page) =>
	page.locator('[data-slot="sidebar-inset"]').evaluate((element) => {
		const bounds = element.getBoundingClientRect();
		return {
			left: bounds.left,
			width: bounds.width,
			expanded: document.getElementById('sidebar-toggle')?.getAttribute('aria-expanded')
		};
	});

test('collapsed desktop navigation keeps the same workspace width across home and modules', async ({
	page,
	app
}, info) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await activate(page, app);
	const toggle = page.locator('#sidebar-toggle');
	await expect(async () => {
		if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'false', { timeout: 1000 });
	}).toPass({ timeout: 15000 });
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	const documents: string[] = [];
	page.on('request', (request) => {
		if (request.isNavigationRequest() && request.resourceType() === 'document') {
			documents.push(new URL(request.url()).pathname);
		}
	});
	await page
		.getByRole('navigation', { name: 'Navigation principale', exact: true })
		.getByRole('link', { name: 'Modules', exact: true })
		.click();
	await expect(page).toHaveURL(`${app.origin}/enseignant/modules`);
	await expect(page.getByRole('heading', { level: 1, name: 'Mes modules', exact: true })).toBeVisible();
	await expect(async () => {
		if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'false', { timeout: 1000 });
	}).toPass({ timeout: 15000 });
	const initial = await measureWorkspace(page);

	await page.goBack();
	await expect(page).toHaveURL(`${app.origin}/`);
	await expect(page.getByRole('heading', { name: 'Mon atelier', exact: true })).toBeVisible();
	const home = await measureWorkspace(page);

	await page.goForward();
	await expect(page).toHaveURL(`${app.origin}/enseignant/modules`);
	await expect(page.getByRole('heading', { level: 1, name: 'Mes modules', exact: true })).toBeVisible();
	const modules = await measureWorkspace(page);
	await info.attach('workspace-geometry', {
		body: JSON.stringify({ initial, home, modules, documents }, null, 2),
		contentType: 'application/json'
	});
	console.info('Workspace geometry:', JSON.stringify({ initial, home, modules, documents }));
	expect(documents, 'Client navigation must keep the document and root layout').toEqual([]);

	for (const [destination, geometry] of Object.entries({ home, modules })) {
		expect.soft(geometry.expanded, `${destination}: sidebar remains collapsed`).toBe('false');
		expect.soft(geometry.left, `${destination}: workspace left edge`).toBe(initial.left);
		expect.soft(geometry.width, `${destination}: workspace width`).toBe(initial.width);
	}
	await page.reload();
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});
