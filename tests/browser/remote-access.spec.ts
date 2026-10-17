import { request as createRequest, type APIRequestContext, type Page } from '@playwright/test';
import { createClient } from '@libsql/client';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

const callback = 'http://127.0.0.1:47913/callback';
const verifier = 'fictitious-verifier-'.repeat(4);
const challenge = createHash('sha256').update(verifier).digest('base64url');
async function pending(
	api: APIRequestContext,
	origin: string,
	clientId: string,
	scope = 'modules:read modules:create modules:update offline_access',
	navigate = false
) {
	const query = new URLSearchParams({
		client_id: clientId,
		redirect_uri: callback,
		response_type: 'code',
		scope,
		resource: origin + '/mcp',
		state: 'fictitious-browser-state',
		code_challenge: challenge,
		code_challenge_method: 'S256',
		prompt: 'consent'
	});
	const authorizeUrl = origin + '/api/auth/oauth2/authorize?' + query;
	if (navigate) return authorizeUrl;
	const response = await api.get(authorizeUrl, {
		maxRedirects: 0
	});
	expect(response.status()).toBe(302);
	return new URL(response.headers().location, origin).href;
}

async function responsiveLayout(page: Page) {
	const initial = page.viewportSize()!;
	for (const width of [320, 390, 768, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		for (const button of await page.getByRole('main').getByRole('button').all()) {
			if (!(await button.isVisible())) continue;
			const bounds = await button.boundingBox();
			expect(bounds?.height).toBeGreaterThanOrEqual(44);
		}
	}
	await page.setViewportSize(initial);
}

test('connexion passkey, consentement, MCP et révocation dans les écrans approuvés', async ({
	page,
	context,
	app
}, testInfo) => {
	test.setTimeout(120000);
	page.setDefaultTimeout(15000);
	const captures = testInfo.outputPath('captures');
	await mkdir(captures, { recursive: true });
	const suffix = testInfo.project.name;
	const errors: string[] = [];
	page.on('pageerror', (error) => {
		errors.push(error.message);
		console.info('Remote access runtime error:', error.message);
	});
	page.on('console', (message) => {
		if (message.type() === 'error')
			console.info('Remote browser console:', message.text().slice(0, 300));
	});
	const api = await createRequest.newContext({ timeout: 15000 });
	let authorizeLink = '';
	await context.route(callback + '**', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body:
				'<!doctype html><html lang="fr"><title>Client fictif</title><p>Client fictif.</p><a href="' +
				authorizeLink.replaceAll('&', '&amp;') +
				'">Connecter Coursely</a></html>'
		})
	);
	try {
		await activate(page, app);
		await context.clearCookies();
		const registered = await api.post(app.origin + '/api/auth/oauth2/register', {
			data: {
				client_name: 'Codex',
				redirect_uris: [callback],
				token_endpoint_auth_method: 'none',
				application_type: 'native',
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code']
			}
		});
		expect(registered.status()).toBe(201);
		const clientId: string = (await registered.json()).client_id;
		authorizeLink = await pending(api, app.origin, clientId, undefined, true);
		await page.goto(callback);
		await page.getByRole('link', { name: 'Connecter Coursely', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Connecter Codex à Coursely' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Continuer avec ma clé d’accès' })).toBeEnabled();
		await responsiveLayout(page);
		await page.screenshot({ path: resolve(captures, `connexion-${suffix}.png`), fullPage: true });
		await page.route('**/api/auth/passkey/generate-authenticate-options', (route) =>
			route.fulfill({
				status: 503,
				contentType: 'application/json',
				body: '{"message":"Fictional temporary error"}'
			})
		);
		await page.getByRole('button', { name: 'Continuer avec ma clé d’accès' }).click();
		await expect(page.locator('p[role="status"]')).toContainText('La connexion n’a pas abouti');
		await page.unroute('**/api/auth/passkey/generate-authenticate-options');
		await page.getByRole('button', { name: 'Continuer avec ma clé d’accès' }).focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('heading', { name: 'Autoriser Codex', exact: true })).toBeVisible();
		await expect(
			page.getByRole('checkbox', { name: 'Lire mes modules et barèmes · requis', exact: true })
		).toBeDisabled();
		expect(
			(await api.post(app.origin + '/api/mcp/consent', { data: 'invalid-json' })).status()
		).toBe(401);
		expect([401, 403]).toContain(
			(
				await page.request.post(app.origin + '/api/mcp/consent', {
					headers: { origin: 'https://evil.example.test' },
					data: {}
				})
			).status()
		);
		expect(
			(
				await page.request.post(app.origin + '/api/mcp/consent', {
					headers: { origin: app.origin, 'content-type': 'text/plain' },
					data: 'not-json'
				})
			).status()
		).toBe(415);
		await page.getByRole('checkbox', { name: 'Modifier les brouillons', exact: true }).uncheck();
		await page.getByRole('checkbox', { name: 'Renouveler la connexion', exact: true }).check();
		await responsiveLayout(page);
		await page.screenshot({
			path: resolve(captures, `consentement-${suffix}.png`),
			fullPage: true
		});
		await page.route('**/api/mcp/consent', (route) =>
			route.fulfill({
				status: 503,
				contentType: 'application/json',
				body: '{"message":"La décision n’a pas pu être confirmée. Réessayez."}'
			})
		);
		console.info('Remote access phase: consent action');
		await page.getByRole('button', { name: 'Autoriser Codex', exact: true }).click();
		await expect(page.getByRole('alert')).toContainText('Réessayez');
		await expect(
			page.getByRole('checkbox', { name: 'Modifier les brouillons', exact: true })
		).not.toBeChecked();
		await page.unroute('**/api/mcp/consent');
		await page.getByRole('button', { name: 'Autoriser Codex', exact: true }).click();
		await expect(page).toHaveURL(new RegExp('^http://127\\.0\\.0\\.1:47913/callback\\?'));
		const returned = new URL(page.url());
		expect(returned.searchParams.get('state')).toBe('fictitious-browser-state');
		expect(returned.searchParams.get('iss')).toBe(app.origin + '/api/auth');
		const exchange = await api.post(app.origin + '/api/auth/oauth2/token', {
			form: {
				grant_type: 'authorization_code',
				code: returned.searchParams.get('code')!,
				code_verifier: verifier,
				client_id: clientId,
				redirect_uri: callback,
				resource: app.origin + '/mcp'
			}
		});
		expect(exchange.status()).toBe(200);
		const tokens = await exchange.json();
		const tools = await api.post(app.origin + '/mcp', {
			headers: {
				authorization: 'Bearer ' + tokens.access_token,
				accept: 'application/json, text/event-stream',
				'mcp-protocol-version': '2025-11-25'
			},
			data: { jsonrpc: '2.0', id: 1, method: 'tools/list' }
		});
		expect(tools.status()).toBe(200);
		const listed = await tools.text();
		expect(listed).toContain('get_import_context');
		expect(listed).toContain('create_module_draft');
		expect(listed).not.toContain('patch_module_draft');
		expect(listed).not.toContain('inspect_module_folder');
		await page.goto(app.origin + '/enseignant/applications');
		await expect(
			page.getByRole('heading', { name: 'Applications connectées', exact: true })
		).toBeVisible();
		await expect(page.getByText('Autorisation accordée', { exact: true })).toBeVisible();
		await expect(page.getByText('Modifier les brouillons', { exact: true })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Révoquer l’accès', exact: true })).toBeEnabled();
		await responsiveLayout(page);
		await page.screenshot({
			path: resolve(captures, `applications-${suffix}.png`),
			fullPage: true
		});
		console.info('Remote access phase: revoke action');
		await page.getByRole('button', { name: 'Révoquer l’accès', exact: true }).click();
		await expect(
			page.getByRole('button', { name: 'Conserver l’accès', exact: true })
		).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('button', { name: 'Révoquer l’accès', exact: true })).toBeFocused();
		await page.getByRole('button', { name: 'Révoquer l’accès', exact: true }).click();
		await page.screenshot({ path: resolve(captures, `revocation-${suffix}.png`), fullPage: true });
		const db = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
		try {
			await db.execute({
				sql: 'UPDATE oauth_consent SET updated_at = updated_at + 1000 WHERE client_id = ?',
				args: [clientId]
			});
		} finally {
			db.close();
		}
		await page.getByRole('button', { name: 'Révoquer l’accès', exact: true }).click();
		await expect(page.getByRole('alert')).toContainText('Cette autorisation a changé');
		await page.getByRole('button', { name: 'Actualiser l’autorisation' }).click();
		await expect(page.getByRole('heading', { name: 'Révoquer l’accès de Codex ?' })).toHaveCount(0);
		await page.getByRole('button', { name: 'Révoquer l’accès', exact: true }).click();
		await page.route('**/api/mcp/applications/revoke', (route) =>
			route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
		);
		await page.getByRole('button', { name: 'Révoquer l’accès', exact: true }).click();
		await expect(page.getByRole('alert')).toContainText('La révocation n’a pas pu être confirmée');
		await page.unroute('**/api/mcp/applications/revoke');
		await page.getByRole('button', { name: 'Révoquer l’accès', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Aucune application autorisée' })).toBeVisible();
		await expect(
			page.getByRole('heading', { name: 'Applications connectées', exact: true })
		).toBeFocused();
		await page.screenshot({ path: resolve(captures, `revoque-${suffix}.png`), fullPage: true });
		expect(
			(
				await api.post(app.origin + '/mcp', {
					headers: { authorization: 'Bearer ' + tokens.access_token },
					data: { jsonrpc: '2.0', id: 2, method: 'tools/list' }
				})
			).status()
		).toBe(401);
		expect(
			(
				await api.post(app.origin + '/api/auth/oauth2/token', {
					form: {
						grant_type: 'refresh_token',
						refresh_token: tokens.refresh_token,
						client_id: clientId,
						resource: app.origin + '/mcp'
					}
				})
			).status()
		).not.toBe(200);
		const next = await pending(
			api,
			app.origin,
			clientId,
			'modules:read corrections:read corrections:propose'
		);
		await page.goto(next);
		await expect(page.getByRole('heading', { name: 'Autoriser Codex', exact: true })).toBeVisible();
		await expect(
			page.getByText('Des données d’étudiants sont concernées', { exact: true })
		).toBeVisible();
		await page.screenshot({ path: resolve(captures, `corrections-${suffix}.png`), fullPage: true });
		await page
			.getByRole('checkbox', { name: 'Lire les corrections sélectionnées', exact: true })
			.uncheck();
		await page.getByRole('button', { name: 'Refuser', exact: true }).click();
		await expect(page).toHaveURL(/error=access_denied/);
		const expired = new URL(await pending(api, app.origin, clientId));
		expired.searchParams.set('exp', '0');
		await page.goto(expired.href);
		await expect(page.getByRole('heading', { name: 'La demande est indisponible' })).toBeVisible();
		await expect(
			page.getByText('Relancez la connexion depuis Codex.', { exact: false })
		).toBeVisible();
		await page.goto(app.origin + '/');
		await expect(page.getByRole('heading', { name: 'Mon accueil', exact: true })).toBeVisible();
		if (suffix === 'mobile') {
			await expect(async () => {
				const toggle = page.getByRole('button', { name: 'Ouvrir la navigation', exact: true });
				if (await toggle.isVisible()) await toggle.click();
				await expect(
					page.getByRole('button', { name: 'Menu utilisateur de Teacher Browser Demo' })
				).toBeVisible({ timeout: 1000 });
			}).toPass({ timeout: 15000 });
		}
		await expect(async () => {
			await page.getByRole('button', { name: 'Menu utilisateur de Teacher Browser Demo' }).click();
			await expect(page.getByRole('menuitem', { name: 'Se déconnecter' })).toBeVisible({
				timeout: 1000
			});
		}).toPass({ timeout: 15000 });
		await page.keyboard.press('Escape');
		expect(errors).toEqual([]);
		await page.close();
	} finally {
		await api.dispose();
	}
});
