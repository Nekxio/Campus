import { createHash } from 'node:crypto';
import { mcpScopes } from '../../src/lib/domain/remote-mcp.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('requested permissions are preselected in compact, adjustable groups', async ({
	app,
	page,
	context,
	request
}, info) => {
	page.setDefaultTimeout(15000);
	await activate(page, app);
	const callback = 'http://127.0.0.1:47913/callback';
	const verifier = 'fictional-grouped-consent-verifier-'.repeat(3);
	const registration = await request.post(app.origin + '/api/auth/oauth2/register', {
		data: {
			client_name: 'Grouped fixture',
			redirect_uris: [callback],
			token_endpoint_auth_method: 'none',
			application_type: 'native',
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code']
		}
	});
	expect(registration.status()).toBe(201);
	const clientId: string = (await registration.json()).client_id;
	const openConsent = async (scopes: readonly string[]) => {
		const query = new URLSearchParams({
			client_id: clientId,
			redirect_uri: callback,
			response_type: 'code',
			scope: scopes.join(' '),
			resource: app.origin + '/mcp',
			state: 'grouped-fixture-state',
			code_challenge: createHash('sha256').update(verifier).digest('base64url'),
			code_challenge_method: 'S256',
			prompt: 'consent'
		});
		await page.goto(app.origin + '/api/auth/oauth2/authorize?' + query);
		await expect(page.locator('form[action*="/decideConsent"]')).toHaveAttribute('data-enhanced', 'true');
	};
	await context.route(callback + '**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Callback</p>' }));
	const discovery = await request.get(app.origin + '/mcp');
	expect(discovery.status()).toBe(401);
	const discoveredScopes =
		discovery
			.headers()
			['www-authenticate'].match(/\bscope="([^"]+)"/)?.[1]
			.split(' ') ?? [];
	expect(discoveredScopes).toEqual([...mcpScopes]);
	await openConsent(discoveredScopes);
	await expect(page.locator('.permission-group')).toHaveCount(8);
	await expect(page.locator('.permission-group details[open]')).toHaveCount(0);
	for (const scope of mcpScopes)
		await expect(page.locator('input[type="checkbox"][name="scopes"][value="' + scope + '"]')).toBeChecked();
	await expect(page.getByText('Suppression d’étudiants', { exact: true })).toBeVisible();
	await expect(page.getByText('Purge des données annuelles', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Autoriser Grouped fixture', exact: true })).toBeEnabled();
	await page.screenshot({ path: info.outputPath('consent-groups.png'), fullPage: true });
	await page.emulateMedia({ colorScheme: 'dark' });
	await expect(page.locator('html')).toHaveClass(/dark/);
	await page.screenshot({ path: info.outputPath('consent-groups-dark.png'), fullPage: true });
	await page.emulateMedia({ colorScheme: 'light' });
	const viewport = page.viewportSize()!;
	await page.setViewportSize({ width: 320, height: 844 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.setViewportSize(viewport);
	const modules = page.getByRole('checkbox', { name: 'Modules et barèmes', exact: true });
	await modules.focus();
	await page.keyboard.press('Space');
	await expect(modules).toBeChecked({ indeterminate: true });
	await expect(page.getByText('1 / 4 sélectionnés', { exact: true })).toBeVisible();
	const moduleDetails = page.locator('summary', { hasText: 'Modules et barèmes' });
	await moduleDetails.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('checkbox', { name: 'Lire mes modules et barèmes', exact: true })).toBeDisabled();
	await expect(
		page.getByRole('checkbox', { name: 'Modifier les brouillons (optionnel)', exact: true })
	).not.toBeChecked();
	await modules.check();
	await page.getByRole('checkbox', { name: 'Modifier les brouillons (optionnel)', exact: true }).uncheck();
	await expect(page.getByRole('checkbox', { name: 'Modifier les brouillons (optionnel)', exact: true })).toBeVisible();
	await expect(modules).toBeChecked({ indeterminate: true });
	await modules.check();
	await moduleDetails.click();
	await page.getByRole('checkbox', { name: 'Quiz', exact: true }).uncheck();
	await expect(page.getByText('0 / 3 sélectionnés', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Autoriser Grouped fixture', exact: true }).click();
	await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:47913\/callback\?/);
	const exchange = await request.post(app.origin + '/api/auth/oauth2/token', {
		form: {
			grant_type: 'authorization_code',
			code: new URL(page.url()).searchParams.get('code')!,
			code_verifier: verifier,
			client_id: clientId,
			redirect_uri: callback,
			resource: app.origin + '/mcp'
		}
	});
	expect(exchange.status()).toBe(200);
	const granted: string = (await exchange.json()).scope;
	expect(granted.split(' ').sort()).toEqual(mcpScopes.filter((scope) => !scope.startsWith('quizzes:')).sort());

	const restricted = ['modules:read', 'modules:update', 'roster:manage'];
	await openConsent(restricted);
	await expect(page.locator('.permission-group')).toHaveCount(2);
	await expect(page.locator('input[type="checkbox"][name="scopes"]')).toHaveCount(3);
	await expect(page.getByText('Suppression d’étudiants', { exact: true })).toHaveCount(0);
	await expect(page.getByText('Purge des données annuelles', { exact: true })).toHaveCount(0);
	await expect(page.getByRole('checkbox', { name: 'Classes et étudiants', exact: true })).toBeChecked();
	await page.getByRole('button', { name: 'Refuser', exact: true }).click();
	await expect(page).toHaveURL(/error=access_denied/);
});
