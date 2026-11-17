import { createHash } from 'node:crypto';
import { createClient } from '@libsql/client';
import { pathToFileURL } from 'node:url';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

for (const hydrateConflict of [false, true]) {
	test(`native consent and revocation refresh a reviewed grant ${hydrateConflict ? 'after hydration' : 'without JavaScript'}`, async ({
		app,
		page,
		browser,
		context,
		request
	}, info) => {
		const capture = async (target: typeof page, name: string) => {
			await target.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
			await target.screenshot({ path: info.outputPath(name + '.png'), fullPage: true });
		};
		await activate(page, app);
		const callback = 'http://127.0.0.1:47913/callback';
		const registered = await request.post(app.origin + '/api/auth/oauth2/register', {
			data: {
				client_name: 'Native fixture',
				redirect_uris: [callback],
				token_endpoint_auth_method: 'none',
				application_type: 'native',
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code']
			}
		});
		expect(registered.status()).toBe(201);
		const clientId: string = (await registered.json()).client_id;
		const pending = async () => {
			const query = new URLSearchParams({
				client_id: clientId,
				redirect_uri: callback,
				response_type: 'code',
				scope: 'modules:read modules:update corrections:read corrections:propose offline_access',
				resource: app.origin + '/mcp',
				state: 'native-fixture-state',
				code_challenge: createHash('sha256').update('fictional-verifier-'.repeat(4)).digest('base64url'),
				code_challenge_method: 'S256',
				prompt: 'consent'
			});
			const response = await page.request.get(app.origin + '/api/auth/oauth2/authorize?' + query, {
				maxRedirects: 0
			});
			expect(response.status()).toBe(302);
			return new URL(response.headers().location, app.origin).href;
		};
		const native = await browser.newContext({
			storageState: await context.storageState(),
			javaScriptEnabled: false
		});
		await native.route(callback + '**', (route) =>
			route.fulfill({ contentType: 'text/html', body: '<p>Callback</p>' })
		);
		const nativePage = await native.newPage();
		try {
			await nativePage.goto(app.origin);
			await nativePage.goto(await pending());
			await expect(nativePage.getByRole('heading', { name: 'Autoriser Native fixture', exact: true })).toBeVisible();
			await expect(nativePage.getByText('Identifiant : ' + clientId, { exact: true })).toHaveCount(0);
			if (hydrateConflict) await capture(nativePage, 'consent');
			await nativePage.getByRole('button', { name: 'Refuser', exact: true }).click();
			await expect(nativePage).toHaveURL(/^http:\/\/127\.0\.0\.1:47913\/callback\?/);
			expect(new URL(nativePage.url()).searchParams.get('error')).toBe('access_denied');
			await nativePage.goto(app.origin);
			await nativePage.goto(await pending());
			await expect(nativePage.getByRole('heading', { name: 'Autoriser Native fixture', exact: true })).toBeVisible();
			for (const scope of [
				'modules:read',
				'modules:update',
				'corrections:read',
				'corrections:propose',
				'offline_access'
			])
				await expect(nativePage.locator('input[type="checkbox"][name="scopes"][value="' + scope + '"]')).toBeChecked();
			await nativePage.locator('summary', { hasText: 'Modules et barèmes' }).click();
			await nativePage.locator('summary', { hasText: 'Notes et corrections' }).click();
			await nativePage.getByRole('checkbox', { name: 'Modifier les brouillons (optionnel)', exact: true }).uncheck();
			await nativePage
				.getByRole('checkbox', { name: 'Lire les corrections sélectionnées (optionnel)', exact: true })
				.uncheck();
			const proposalScope = nativePage.getByRole('checkbox', {
				name: 'Proposer des corrections (optionnel)',
				exact: true
			});
			await proposalScope.check();
			await nativePage.getByRole('button', { name: 'Autoriser Native fixture', exact: true }).click();
			await expect(
				nativePage.getByText('La proposition nécessite la lecture des corrections.', { exact: true })
			).toBeVisible();
			await expect(proposalScope).toBeChecked();
			await expect(
				nativePage.getByRole('checkbox', { name: 'Modifier les brouillons (optionnel)', exact: true })
			).not.toBeChecked();
			await proposalScope.uncheck();
			await nativePage.getByRole('button', { name: 'Autoriser Native fixture', exact: true }).click();
			await expect(nativePage).toHaveURL(/^http:\/\/127\.0\.0\.1:47913\/callback\?/);
			expect(new URL(nativePage.url()).searchParams.get('code')).toBeTruthy();
			await nativePage.goto(app.origin);
			const grantPage = hydrateConflict ? page : nativePage;
			await grantPage.goto(app.origin + '/enseignant/applications');
			if (hydrateConflict) {
				await expect(grantPage.locator('form[action="?/revokeApplication"]')).toHaveAttribute('data-enhanced', 'true');
				await expect(grantPage.getByRole('button', { name: 'Codex', exact: true })).toBeEnabled();
			}
			await expect(grantPage.getByText('Identifiant : ' + clientId, { exact: true })).toHaveCount(0);
			await grantPage.getByText(/^Accordée le /).click();
			await expect(grantPage.locator('form[action="?/revokeApplication"]')).toBeHidden();
			if (hydrateConflict) await capture(grantPage, 'application-grant');
			await grantPage.locator('summary', { hasText: 'Révoquer l’accès' }).click();
			await expect(grantPage.locator('form[action="?/revokeApplication"]')).toBeVisible();
			if (hydrateConflict) {
				await expect(grantPage.locator('summary', { hasText: 'Révoquer l’accès' })).toBeHidden();
				await expect(grantPage.getByRole('link', { name: 'Conserver l’accès', exact: true })).toBeFocused();
				await capture(grantPage, 'revocation-confirmation');
			}
			const reviewed = await grantPage.locator('input[name="reviewedVersion"]').inputValue();
			const db = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
			try {
				await db.execute({
					sql: 'UPDATE oauth_consent SET updated_at = updated_at + 1000 WHERE client_id = ?',
					args: [clientId]
				});
			} finally {
				db.close();
			}
			if (hydrateConflict) {
				const response = grantPage.waitForResponse(
					(response) =>
						response.request().method() === 'POST' &&
						response.url().endsWith('/enseignant/applications?/revokeApplication')
				);
				await grantPage.locator('form[action="?/revokeApplication"]').evaluate((form) => {
					HTMLFormElement.prototype.submit.call(form);
				});
				expect((await response).status()).toBe(409);
			} else await grantPage.getByRole('button', { name: 'Révoquer l’accès', exact: true }).click();
			await expect(grantPage.getByRole('alert')).toContainText('Cette autorisation a changé');
			await expect(grantPage.locator('input[name="reviewedVersion"]')).toHaveValue(reviewed);
			await expect(grantPage.getByRole('button', { name: 'Révoquer l’accès', exact: true })).toHaveCount(0);
			if (hydrateConflict)
				await expect(grantPage.locator('form[action="?/revokeApplication"]')).toHaveAttribute('data-enhanced', 'true');
			await grantPage.getByRole('link', { name: 'Actualiser l’autorisation', exact: true }).click();
			await grantPage.locator('summary', { hasText: 'Révoquer l’accès' }).click();
			await expect(grantPage.locator('input[name="reviewedVersion"]')).not.toHaveValue(reviewed);
			await grantPage.getByRole('button', { name: 'Révoquer l’accès', exact: true }).click();
			await expect(grantPage.getByRole('heading', { name: 'Aucune application autorisée' })).toBeVisible();
			await expect(
				hydrateConflict ? grantPage.locator('[data-sonner-toast][data-type="success"]') : grantPage.getByRole('status')
			).toContainText('a été révoqué');
		} finally {
			await native.close();
		}
	});
}
