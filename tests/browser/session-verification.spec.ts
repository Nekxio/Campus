import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('private direct access, reloads and navigation do not require external JWT signing', async ({
	app,
	page,
	context
}) => {
	await activate(page, app);
	await app.call('unavailable-jwt-signing');
	await app.call('age-session');
	for (const [path, title] of [
		['/enseignant/notation', 'Notation'],
		['/enseignant/compte', 'Compte'],
		['/', 'Mon atelier']
	]) {
		const response = await page.goto(app.origin + path);
		expect(response?.status()).toBe(200);
		await expect(page).toHaveURL(app.origin + path);
		await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
		expect(response?.headers()['cache-control']).toBe('private, no-store');
		await page.reload();
		await expect(page).toHaveURL(app.origin + path);
		await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
		await expect(page.getByText('La vérification de votre session a échoué.', { exact: false })).toHaveCount(0);
	}
	const link = page.getByRole('link', { name: 'Notation', exact: true });
	if (!(await link.isVisible())) {
		await page.getByRole('button', { name: 'Ouvrir la navigation', exact: true }).click();
	}
	await link.click();
	await expect(page).toHaveURL(app.origin + '/enseignant/notation');
	await expect(page.getByRole('heading', { name: 'Notation', exact: true })).toBeVisible();
	const data = await context.request.get(app.origin + '/enseignant/compte/__data.json');
	expect(data.status()).toBe(200);
	expect(data.headers()['cache-control']).toBe('private, no-store');
	await app.call('revoke-session');
	await page.goto(app.origin + '/enseignant/compte');
	await expect(page).toHaveURL(app.origin + '/connexion');
});

test('cross-site direct navigation preserves session checks, reloads and internal navigation', async ({
	app,
	page
}) => {
	await activate(page, app);
	await app.call('age-session');
	const navigationStatuses: number[] = [];
	await page.route(app.origin + '/**', async (route) => {
		if (!route.request().isNavigationRequest()) return route.fallback();
		// Chrome overwrites Fetch Metadata on continued requests; fetch the real server
		// response with the incident metadata, then let the browser render it unchanged.
		const response = await route.fetch({
			headers: {
				...route.request().headers(),
				'sec-fetch-site': 'cross-site',
				'sec-fetch-mode': 'navigate'
			},
			maxRedirects: 0
		});
		navigationStatuses.push(response.status());
		await route.fulfill({ response });
	});
	for (const [path, title] of [
		['/enseignant/notation', 'Notation'],
		['/enseignant/compte', 'Compte'],
		['/', 'Mon atelier']
	]) {
		const response = await page.goto(app.origin + path);
		expect(response?.status()).toBe(200);
		await expect(page).toHaveURL(app.origin + path);
		await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
		expect(response?.headers()['cache-control']).toBe('private, no-store');
		await page.reload();
		await expect(page).toHaveURL(app.origin + path);
		await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
		await expect(page.getByText('La vérification de votre session a échoué.', { exact: false })).toHaveCount(0);
	}
	expect(navigationStatuses).toEqual([200, 200, 200, 200, 200, 200]);
	const link = page.getByRole('link', { name: 'Notation', exact: true });
	if (!(await link.isVisible())) {
		await page.getByRole('button', { name: 'Ouvrir la navigation', exact: true }).click();
	}
	await link.click();
	await expect(page).toHaveURL(app.origin + '/enseignant/notation');
	await expect(page.getByRole('heading', { name: 'Notation', exact: true })).toBeVisible();
	await app.call('revoke-session');
	await page.goto(app.origin + '/enseignant/compte');
	await expect(page).toHaveURL(app.origin + '/connexion');
});
