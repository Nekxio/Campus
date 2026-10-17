import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { randomBytes, createHash } from 'node:crypto';
import { createAuth, type Auth } from '../auth.js';
import { createDatabase } from '../db/index.js';
import { issueInvitation, invitationCookieName } from '../auth/invitations.js';
import { virtualPasskey } from '../auth/testing/webauthn.js';
import {
	readOAuthRequest,
	browserOAuth,
	decideOAuth,
	listApplications,
	revokeApplication
} from './consent.js';
import { handleRemoteMcp } from './http.js';
import { authenticateMcp } from './principal.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import { newFolderBinding, resolveLocalModule } from '../../domain/local-module.js';
import { createModuleImportSchema } from '../../domain/module-import.js';
import { sampleLocalModule } from '../agent/testing/fixtures.js';
import { unusedClientLimit, unusedClientRetentionMs } from './registration.js';

const origin = 'https://coursely.example.test';
const callback = 'http://127.0.0.1:47913/callback';
const verifier = 'a'.repeat(64);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const cookieOf = (response: Response) =>
	response.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join(';');
let client: Client;
let auth: Auth;
let cookie: string;
let teacherId: string;
async function call(path: string, body?: unknown, session = '', native = false) {
	return auth.handler(
		new Request(origin + '/api/auth' + path, {
			method: body === undefined ? 'GET' : 'POST',
			headers: {
				...(native ? {} : { origin }),
				cookie: session,
				'content-type':
					body instanceof URLSearchParams
						? 'application/x-www-form-urlencoded'
						: 'application/json',
				'cf-connecting-ip': '192.0.2.17'
			},
			...(body === undefined
				? {}
				: { body: body instanceof URLSearchParams ? body : JSON.stringify(body) })
		})
	);
}
async function registerClient(redirect = callback) {
	const response = await call(
		'/oauth2/register',
		{
			client_name: 'Codex fictif',
			redirect_uris: [redirect],
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			application_type: 'native'
		},
		'',
		true
	);
	expect(response.status, await response.clone().text()).toBe(201);
	return ((await response.json()) as { client_id: string }).client_id as string;
}
async function requestConsent(
	clientId: string,
	scope = 'modules:read modules:create modules:update offline_access',
	session = cookie
) {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: callback,
		response_type: 'code',
		state: 'state-fictif',
		scope,
		resource: origin + '/mcp',
		code_challenge: challenge,
		code_challenge_method: 'S256',
		prompt: 'consent'
	});
	const response = await call('/oauth2/authorize?' + params, undefined, session);
	expect(response.status, await response.clone().text()).toBe(302);
	return new URL(response.headers.get('location')!, origin);
}
async function grant(scope?: string) {
	const clientId = await registerClient();
	const location = await requestConsent(clientId, scope);
	const query = location.search.slice(1);
	const reviewed = await readOAuthRequest(auth, client, query, origin);
	const decision = await decideOAuth(auth, client, origin, new Headers({ cookie, origin }), {
		oauthQuery: query,
		accept: true,
		scopes: reviewed.scopes
	});
	const code = new URL(decision.url).searchParams.get('code')!;
	const response = await call(
		'/oauth2/token',
		new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			client_id: clientId,
			redirect_uri: callback,
			code_verifier: verifier,
			resource: origin + '/mcp'
		}),
		'',
		true
	);
	expect(response.status, await response.clone().text()).toBe(200);
	return {
		clientId,
		token: (await response.json()) as {
			access_token: string;
			refresh_token: string;
			expires_in: number;
			scope: string;
		},
		code,
		query
	};
}
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	await migrate(createDatabase(client), { migrationsFolder: './drizzle' });
	auth = await createAuth(
		{ ORIGIN: origin, BETTER_AUTH_SECRET: randomBytes(32).toString('hex') },
		client
	);
	const invite = await issueInvitation(client, {
		email: 'teacher-fictif@example.test',
		name: 'Camille Martin',
		role: 'teacher'
	});
	teacherId = invite.id;
	const device = virtualPasskey(origin);
	const options = await call(
		'/passkey/generate-register-options',
		undefined,
		invitationCookieName + '=' + invite.token
	);
	const registered = await call(
		'/passkey/verify-registration',
		{ response: device.register(await options.json()), createSession: true },
		invitationCookieName + '=' + invite.token + ';' + cookieOf(options)
	);
	expect(registered.status, await registered.clone().text()).toBe(200);
	cookie = cookieOf(registered);
});
afterEach(() => {
	client.close();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('MCP distant et OAuth réels sur base fictive', () => {
	it('borne le DCR global, répond 429 et conserve le client actif puis sa révocation', async () => {
		const granted = await grant();
		for (let i = 0; i < unusedClientLimit; i++) {
			await client.execute({
				sql: `INSERT INTO oauth_client (id, client_id, redirect_uris, token_endpoint_auth_method, created_at)
				VALUES (?, ?, '[]', 'none', ?)`,
				args: ['pending-' + i, 'pending-' + i, Date.now()]
			});
		}
		const saturated = await call(
			'/oauth2/register',
			{
				redirect_uris: [callback],
				token_endpoint_auth_method: 'none',
				application_type: 'native'
			},
			'',
			true
		);
		expect(saturated.status, await saturated.clone().text()).toBe(429);
		expect(await saturated.json()).toMatchObject({ error: 'temporarily_unavailable' });
		await client.execute({
			sql: 'UPDATE oauth_client SET created_at = ?',
			args: [Date.now() - unusedClientRetentionMs - 1000]
		});
		await registerClient();
		expect(Number((await client.execute('SELECT COUNT(*) AS n FROM oauth_client')).rows[0].n)).toBe(
			2
		);
		const principal = await authenticateMcp(
			auth,
			client,
			origin,
			new Request(origin + '/mcp', {
				headers: { authorization: 'Bearer ' + granted.token.access_token }
			})
		);
		expect(principal.teacherId).toBe(teacherId);
		const [application] = await listApplications(client, teacherId);
		await revokeApplication(client, teacherId, {
			id: application.id,
			reviewedVersion: application.reviewedVersion
		});
		await registerClient();
		expect(
			(
				await client.execute({
					sql: 'SELECT id FROM oauth_client WHERE client_id = ?',
					args: [granted.clientId]
				})
			).rows
		).toHaveLength(1);
		await expect(
			authenticateMcp(
				auth,
				client,
				origin,
				new Request(origin + '/mcp', {
					headers: { authorization: 'Bearer ' + granted.token.access_token }
				})
			)
		).rejects.toMatchObject({ status: 401 });
	});

	it('conserve la limite effective DCR de cinq requêtes par minute et par IP/chemin', async () => {
		for (let i = 0; i < 5; i++) await registerClient();
		const response = await call(
			'/oauth2/register',
			{
				redirect_uris: [callback],
				token_endpoint_auth_method: 'none',
				application_type: 'native'
			},
			'',
			true
		);
		expect(response.status).toBe(429);
		expect(Number((await client.execute('SELECT COUNT(*) AS n FROM oauth_client')).rows[0].n)).toBe(
			5
		);
	});

	it('crée un brouillon privé par MCP, rejoue le reçu et garde les étudiants hors du contexte d’import', async () => {
		const ids = await seedFoundationFixtures(createDatabase(client));
		const binding = newFolderBinding(origin);
		const command = createModuleImportSchema.parse({
			version: 1,
			requestId: crypto.randomUUID(),
			moduleId: binding.moduleId,
			...resolveLocalModule(sampleLocalModule(ids.currentClass), binding, '/fictional/module')
		});
		const { token } = await grant('modules:read modules:create modules:rubric');
		const send = async (name: string, args: unknown) => {
			const response = await handleRemoteMcp(
				new Request(origin + '/mcp', {
					method: 'POST',
					headers: {
						authorization: 'Bearer ' + token.access_token,
						'content-type': 'application/json',
						accept: 'application/json',
						'mcp-protocol-version': '2026-07-28',
						'mcp-method': 'tools/call',
						'mcp-name': name
					},
					body: JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						method: 'tools/call',
						params: {
							name,
							arguments: args,
							_meta: {
								'io.modelcontextprotocol/protocolVersion': '2026-07-28',
								'io.modelcontextprotocol/clientInfo': { name: 'fictional-test', version: '1' },
								'io.modelcontextprotocol/clientCapabilities': {}
							}
						}
					})
				}),
				auth,
				client,
				origin
			);
			expect(response.status, await response.clone().text()).toBe(200);
			return (await response.json()) as {
				result: { isError?: boolean; structuredContent: Record<string, unknown> };
			};
		};
		const first = await send('create_module_draft', command);
		expect(first.result.isError).not.toBe(true);
		expect(first.result.structuredContent.moduleId).toBe(binding.moduleId);
		expect((await send('create_module_draft', command)).result.structuredContent).toEqual(
			first.result.structuredContent
		);
		expect((await client.execute('SELECT count(*) AS n FROM agent_import')).rows[0].n).toBe(1);
		expect((await client.execute('SELECT count(*) AS n FROM module_publication')).rows[0].n).toBe(
			1
		);
		const context = await send('get_import_context', { moduleId: binding.moduleId });
		expect(context.result.isError).not.toBe(true);
		expect(JSON.stringify(context)).not.toContain('Student Demo');
		expect(JSON.stringify(context)).not.toContain('"students"');
	});
	it('conserve le droit précédent lorsqu’une demande plus large est refusée', async () => {
		const { clientId, token } = await grant('modules:read');
		const location = await requestConsent(clientId);
		const reviewed = await readOAuthRequest(auth, client, location.search.slice(1), origin);
		await decideOAuth(auth, client, origin, new Headers({ cookie, origin }), {
			oauthQuery: reviewed.oauthQuery,
			accept: false,
			scopes: reviewed.scopes
		});
		expect(await listApplications(client, teacherId)).toHaveLength(1);
		expect(
			(
				await authenticateMcp(
					auth,
					client,
					origin,
					new Request(origin + '/mcp', {
						headers: { authorization: 'Bearer ' + token.access_token }
					})
				)
			).scopes
		).toEqual(['modules:read']);
	});
	it('invalide l’accès après suppression de la session et refuse son renouvellement', async () => {
		const { token, clientId } = await grant();
		await client.execute('DELETE FROM session');
		await expect(
			authenticateMcp(
				auth,
				client,
				origin,
				new Request(origin + '/mcp', { headers: { authorization: 'Bearer ' + token.access_token } })
			)
		).rejects.toMatchObject({ status: 401 });
		const refresh = await call(
			'/oauth2/token',
			new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: token.refresh_token,
				client_id: clientId,
				resource: origin + '/mcp'
			}),
			'',
			true
		);
		expect(refresh.status).not.toBe(200);
	});
	it('fait tourner les refresh et refuse la réutilisation du jeton précédent', async () => {
		const { token, clientId } = await grant();
		const form = new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: token.refresh_token,
			client_id: clientId,
			resource: origin + '/mcp'
		});
		const first = await call('/oauth2/token', form, '', true);
		expect(first.status, await first.clone().text()).toBe(200);
		const rotated = (await first.json()) as { refresh_token: string };
		expect(rotated.refresh_token).not.toBe(token.refresh_token);
		expect((await call('/oauth2/token', form, '', true)).status).not.toBe(200);
		form.set('refresh_token', rotated.refresh_token);
		expect((await call('/oauth2/token', form, '', true)).status).not.toBe(200);
	});
	it('ne confond pas un JWT signé pour une autre audience ou un autre émetteur', async () => {
		const { token } = await grant();
		const payload = JSON.parse(
			Buffer.from(token.access_token.split('.')[1], 'base64url').toString()
		) as Record<string, unknown>;
		for (const options of [
			{ audience: 'https://other.example.test/mcp' },
			{ issuer: 'https://other.example.test/auth' }
		]) {
			const signed = await auth.api.signJWT({
				body: {
					payload: {
						...payload,
						...('audience' in options ? { aud: options.audience } : { iss: options.issuer })
					},
					overrideOptions: { jwt: options }
				}
			});
			await expect(
				authenticateMcp(
					auth,
					client,
					origin,
					new Request(origin + '/mcp', { headers: { authorization: 'Bearer ' + signed.token } })
				)
			).rejects.toMatchObject({ status: 401 });
		}
	});
	it('reprend la demande signée après la connexion depuis une navigation GET', async () => {
		const id = await registerClient();
		const location = await requestConsent(id, undefined, '');
		expect(location.pathname).toBe('/connexion/application');
		const continued = await browserOAuth(
			auth,
			origin,
			new Headers({ cookie }),
			'/oauth2/continue',
			{ oauth_query: location.search.slice(1) }
		);
		expect(new URL(continued.url, origin).pathname).toBe('/autoriser');
	});
	it('sert le protocole 2026-07-28 et vérifie les en-têtes miroir avec le SDK', async () => {
		const { token } = await grant('modules:read');
		const headers = {
			authorization: 'Bearer ' + token.access_token,
			'content-type': 'application/json',
			'mcp-protocol-version': '2026-07-28',
			'mcp-method': 'tools/list',
			accept: 'application/json, text/event-stream'
		};
		const body = {
			jsonrpc: '2.0',
			id: 7,
			method: 'tools/list',
			params: {
				_meta: {
					'io.modelcontextprotocol/protocolVersion': '2026-07-28',
					'io.modelcontextprotocol/clientInfo': { name: 'fictional-test-client', version: '1.0.0' },
					'io.modelcontextprotocol/clientCapabilities': {}
				}
			}
		};
		const response = await handleRemoteMcp(
			new Request(origin + '/mcp', { method: 'POST', headers, body: JSON.stringify(body) }),
			auth,
			client,
			origin
		);
		expect(response.status, await response.clone().text()).toBe(200);
		expect(await response.json()).toMatchObject({
			result: { tools: [{ name: 'get_import_context' }] }
		});
		const mismatch = await handleRemoteMcp(
			new Request(origin + '/mcp', {
				method: 'POST',
				headers: { ...headers, 'mcp-method': 'tools/call' },
				body: JSON.stringify(body)
			}),
			auth,
			client,
			origin
		);
		expect(mismatch.status, await mismatch.clone().text()).toBe(400);
	});
	it.each([
		'https://other.example.test/callback',
		'http://127.0.0.1:47913/other',
		'http://127.0.0.1:47913/callback?next=evil',
		'http://127.0.0.1.evil.test/callback',
		'http://user@127.0.0.1/callback',
		'http://127.0.0.1/callback#fragment'
	])('refuse la redirection non autorisée %s', async (redirect) => {
		const response = await call(
			'/oauth2/register',
			{
				client_name: 'Fictif',
				redirect_uris: [redirect],
				token_endpoint_auth_method: 'none',
				application_type: 'native'
			},
			'',
			true
		);
		expect(response.status).toBe(400);
	});
	it.each(['resource', 'code_challenge', 'code_challenge_method'])(
		'exige %s et ne délivre pas de code en son absence',
		async (field) => {
			const id = await registerClient();
			const params = new URLSearchParams({
				client_id: id,
				redirect_uri: callback,
				response_type: 'code',
				scope: 'modules:read',
				resource: origin + '/mcp',
				code_challenge: challenge,
				code_challenge_method: 'S256'
			});
			params.delete(field);
			const response = await call('/oauth2/authorize?' + params, undefined, cookie);
			expect(response.status).toBe(400);
			expect(response.headers.get('location')).toBeNull();
		}
	);
	it('refuse PKCE plain et un grant machine', async () => {
		const id = await registerClient();
		const params = new URLSearchParams({
			client_id: id,
			redirect_uri: callback,
			response_type: 'code',
			scope: 'modules:read',
			resource: origin + '/mcp',
			code_challenge: verifier,
			code_challenge_method: 'plain'
		});
		expect((await call('/oauth2/authorize?' + params, undefined, cookie)).status).toBe(400);
		expect(
			(
				await call(
					'/oauth2/token',
					new URLSearchParams({
						client_id: id,
						grant_type: 'client_credentials',
						resource: origin + '/mcp'
					}),
					'',
					true
				)
			).status
		).not.toBe(200);
	});
	it('refuse les requêtes natives provenant d’un site tiers', async () => {
		const response = await auth.handler(
			new Request(origin + '/api/auth/oauth2/register', {
				method: 'POST',
				headers: { origin: 'https://evil.example.test', 'content-type': 'application/json' },
				body: JSON.stringify({ redirect_uris: [callback], token_endpoint_auth_method: 'none' })
			})
		);
		expect(response.status).toBe(403);
	});
	it('accepte la navigation OAuth intersites et refuse le fetch intersites', async () => {
		const id = await registerClient();
		const query = new URLSearchParams({
			client_id: id,
			redirect_uri: callback,
			response_type: 'code',
			scope: 'modules:read',
			resource: origin + '/mcp',
			state: 'native-navigation-state',
			code_challenge: challenge,
			code_challenge_method: 'S256'
		});
		for (const mode of ['navigate', 'cors']) {
			const response = await auth.handler(
				new Request(origin + '/api/auth/oauth2/authorize?' + query, {
					headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': mode, accept: 'text/html' }
				})
			);
			expect(response.status).toBe(mode === 'navigate' ? 302 : 403);
			if (mode === 'navigate')
				expect(new URL(response.headers.get('location')!, origin).pathname).toBe(
					'/connexion/application'
				);
		}
	});
	it('annonce le minimum et le point de découverte dans le challenge anonyme', async () => {
		const response = await handleRemoteMcp(
			new Request(origin + '/mcp', { method: 'POST', body: '{bad' }),
			auth,
			client,
			origin
		);
		expect(response.status).toBe(401);
		expect(response.headers.get('WWW-Authenticate')).toContain(
			'/.well-known/oauth-protected-resource/mcp'
		);
		expect(response.headers.get('WWW-Authenticate')).toContain('scope="modules:read"');
		const metadata = await auth.handler(
			new Request(origin + '/.well-known/oauth-protected-resource/mcp')
		);
		expect(metadata.status).toBe(200);
		expect(await metadata.json()).toMatchObject({
			resource: origin + '/mcp',
			authorization_servers: [origin + '/api/auth']
		});
	});
	it('refuse cookie seul, clé stdio, query token, mauvaise origine et signature altérée', async () => {
		const { token } = await grant();
		for (const headers of [
			{ cookie } as Record<string, string>,
			{ authorization: 'Bearer coursely_' + 'a'.repeat(64) },
			{ authorization: 'Bearer ' + token.access_token.slice(0, -8) + 'aaaaaaaa' }
		]) {
			expect(
				(await handleRemoteMcp(new Request(origin + '/mcp', { headers }), auth, client, origin))
					.status
			).toBe(401);
		}
		expect(
			(
				await handleRemoteMcp(
					new Request(origin + '/mcp?%61ccess_token=hidden', {
						headers: { authorization: 'Bearer ' + token.access_token }
					}),
					auth,
					client,
					origin
				)
			).status
		).toBe(401);
		expect(
			(
				await handleRemoteMcp(
					new Request(origin + '/mcp', {
						headers: {
							authorization: 'Bearer ' + token.access_token,
							origin: 'https://evil.example.test'
						}
					}),
					auth,
					client,
					origin
				)
			).status
		).toBe(403);
	});
	it('bloque un outil ou un barème non consenti avec un challenge de scope', async () => {
		const { token } = await grant('modules:read modules:update');
		for (const [name, input, missing] of [
			['create_module_draft', {}, 'modules:create'],
			['patch_module_draft', { rubric: {} }, 'modules:rubric'],
			['get_correction_context', {}, 'corrections:read']
		] as const) {
			const response = await handleRemoteMcp(
				new Request(origin + '/mcp', {
					method: 'POST',
					headers: {
						authorization: 'Bearer ' + token.access_token,
						'content-type': 'application/json'
					},
					body: JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						method: 'tools/call',
						params: { name, arguments: input }
					})
				}),
				auth,
				client,
				origin
			);
			expect(response.status).toBe(403);
			expect(response.headers.get('www-authenticate')).toContain(missing);
		}
	});
	it('borne le corps authentifié et refuse les batches et méthodes non disponibles', async () => {
		const { token } = await grant('modules:read');
		const headers = {
			authorization: 'Bearer ' + token.access_token,
			'content-type': 'application/json'
		};
		const tooBig = await handleRemoteMcp(
			new Request(origin + '/mcp', {
				method: 'POST',
				headers,
				body: JSON.stringify({ padding: 'x'.repeat(256000) })
			}),
			auth,
			client,
			origin
		);
		expect(tooBig.status).toBe(413);
		expect(
			(
				await handleRemoteMcp(
					new Request(origin + '/mcp', { method: 'POST', headers, body: '[]' }),
					auth,
					client,
					origin
				)
			).status
		).toBe(400);
		const method = await handleRemoteMcp(
			new Request(origin + '/mcp', {
				method: 'POST',
				headers,
				body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'subscriptions/listen' })
			}),
			auth,
			client,
			origin
		);
		expect(await method.json()).toMatchObject({ error: { code: -32601 } });
		expect(
			(await handleRemoteMcp(new Request(origin + '/mcp', { headers }), auth, client, origin))
				.status
		).toBe(405);
	});
	it('ne délivre pas de refresh sans le scope offline_access', async () => {
		const { token } = await grant('modules:read');
		expect(token.refresh_token).toBeUndefined();
	});
	it('refuse un code déjà échangé, une mauvaise ressource et un mauvais vérificateur', async () => {
		const { clientId, code } = await grant();
		const replay = await call(
			'/oauth2/token',
			new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				client_id: clientId,
				redirect_uri: callback,
				code_verifier: verifier,
				resource: origin + '/mcp'
			}),
			'',
			true
		);
		expect(replay.status).toBe(400);
		for (const resource of ['', 'https://other.example.test/mcp']) {
			expect(
				(
					await call(
						'/oauth2/token',
						new URLSearchParams({
							grant_type: 'authorization_code',
							code,
							client_id: clientId,
							redirect_uri: callback,
							code_verifier: verifier,
							...(resource ? { resource } : {})
						}),
						'',
						true
					)
				).status
			).toBe(400);
		}
		const url = await requestConsent(clientId);
		const reviewed = await readOAuthRequest(auth, client, url.search.slice(1), origin);
		const decision = await decideOAuth(auth, client, origin, new Headers({ cookie, origin }), {
			...reviewed,
			accept: true,
			scopes: reviewed.scopes
		});
		const freshCode = new URL(decision.url).searchParams.get('code')!;
		expect(
			(
				await call(
					'/oauth2/token',
					new URLSearchParams({
						grant_type: 'authorization_code',
						code: freshCode,
						client_id: clientId,
						redirect_uri: callback,
						code_verifier: 'b'.repeat(64),
						resource: origin + '/mcp'
					}),
					'',
					true
				)
			).status
		).toBe(401);
	});
	it('fait expirer la demande signée et le code non utilisé', async () => {
		const id = await registerClient();
		const url = await requestConsent(id);
		const reviewed = await readOAuthRequest(auth, client, url.search.slice(1), origin);
		const decision = await decideOAuth(auth, client, origin, new Headers({ cookie, origin }), {
			oauthQuery: reviewed.oauthQuery,
			accept: true,
			scopes: reviewed.scopes
		});
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.now() + 180000);
		await expect(readOAuthRequest(auth, client, reviewed.oauthQuery, origin)).rejects.toMatchObject(
			{ status: 400 }
		);
		const response = await call(
			'/oauth2/token',
			new URLSearchParams({
				grant_type: 'authorization_code',
				code: new URL(decision.url).searchParams.get('code')!,
				client_id: id,
				redirect_uri: callback,
				code_verifier: verifier,
				resource: origin + '/mcp'
			}),
			'',
			true
		);
		expect(response.status).toBe(400);
	});
	it('fait expirer JWT et session, et stocke les refresh et codes sans leur valeur brute', async () => {
		const { token } = await grant();
		const rows = await client.execute('SELECT token FROM oauth_refresh_token');
		expect(rows.rows).toHaveLength(1);
		expect(String(rows.rows[0].token)).not.toContain(token.refresh_token);
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.now() + 601000);
		await expect(
			authenticateMcp(
				auth,
				client,
				origin,
				new Request(origin + '/mcp', { headers: { authorization: 'Bearer ' + token.access_token } })
			)
		).rejects.toMatchObject({ status: 401 });
	});
	it('refuse un instantané périmé ou la révocation par un autre enseignant', async () => {
		await grant();
		const [application] = await listApplications(client, teacherId);
		await expect(revokeApplication(client, crypto.randomUUID(), application)).rejects.toMatchObject(
			{ status: 409 }
		);
		await expect(
			revokeApplication(client, teacherId, { ...application, reviewedVersion: 'old' })
		).rejects.toMatchObject({ status: 409 });
		expect(await listApplications(client, teacherId)).toHaveLength(1);
	});
	it('ne réactive pas un ancien JWT après révocation puis nouvel accord', async () => {
		const { clientId, token } = await grant();
		const [application] = await listApplications(client, teacherId);
		await revokeApplication(client, teacherId, application);
		const url = await requestConsent(clientId);
		const reviewed = await readOAuthRequest(auth, client, url.search.slice(1), origin);
		await decideOAuth(auth, client, origin, new Headers({ cookie, origin }), {
			oauthQuery: reviewed.oauthQuery,
			accept: true,
			scopes: reviewed.scopes
		});
		expect(await listApplications(client, teacherId)).toHaveLength(1);
		await expect(
			authenticateMcp(
				auth,
				client,
				origin,
				new Request(origin + '/mcp', { headers: { authorization: 'Bearer ' + token.access_token } })
			)
		).rejects.toMatchObject({ status: 401 });
	});
	it('découvre le serveur et termine PKCE avec passkey, consentement explicite et JWT lié à la ressource', async () => {
		const metadata = await auth.api.getOAuthServerConfig();
		expect(metadata.issuer).toBe(origin + '/api/auth');
		expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
		expect(metadata.scopes_supported).toEqual(['modules:read']);
		const { token } = await grant();
		expect(token.expires_in).toBe(600);
		expect(token.refresh_token).toBeTruthy();
		const principal = await authenticateMcp(
			auth,
			client,
			origin,
			new Request(origin + '/mcp', { headers: { authorization: 'Bearer ' + token.access_token } })
		);
		expect(principal.teacherId).toBe(teacherId);
		expect(principal.scopes).toContain('modules:update');
	});
	it('refuse la demande sans créer de consentement et conserve state et issuer', async () => {
		const id = await registerClient();
		const url = await requestConsent(id);
		const result = await decideOAuth(auth, client, origin, new Headers({ cookie, origin }), {
			oauthQuery: url.search.slice(1),
			accept: false,
			scopes: ['modules:read']
		});
		expect(new URL(result.url).searchParams.get('error')).toBe('access_denied');
		expect(new URL(result.url).searchParams.get('state')).toBe('state-fictif');
		expect(new URL(result.url).searchParams.get('iss')).toBe(origin + '/api/auth');
		expect(await listApplications(client, teacherId)).toEqual([]);
	});
	it('exige une session et une signature valide pour consulter la demande', async () => {
		const id = await registerClient();
		const location = await requestConsent(id, undefined, '');
		expect(location.pathname).toBe('/connexion/application');
		await expect(
			readOAuthRequest(
				auth,
				client,
				location.search.slice(1).replace('modules%3Aread', 'modules%3Arubric'),
				origin
			)
		).rejects.toMatchObject({ status: 400 });
	});
	it('ne révèle que les outils permis et conserve les deux outils de dossiers en stdio uniquement', async () => {
		const { token } = await grant('modules:read');
		const response = await handleRemoteMcp(
			new Request(origin + '/mcp', {
				method: 'POST',
				headers: {
					authorization: 'Bearer ' + token.access_token,
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
					'mcp-protocol-version': '2025-11-25'
				},
				body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
			}),
			auth,
			client,
			origin
		);
		expect(response.status, await response.clone().text()).toBe(200);
		const text = await response.text();
		expect(text).toContain('get_import_context');
		expect(text).not.toContain('inspect_module_folder');
		expect(text).not.toContain('bind_module_folder');
		expect(text).not.toContain('create_module_draft');
	});
	it('révoque immédiatement JWT et refresh sans détruire la session enseignant', async () => {
		const { token, clientId } = await grant();
		const [application] = await listApplications(client, teacherId);
		await revokeApplication(client, teacherId, application);
		await expect(
			authenticateMcp(
				auth,
				client,
				origin,
				new Request(origin + '/mcp', { headers: { authorization: 'Bearer ' + token.access_token } })
			)
		).rejects.toMatchObject({ status: 401 });
		const refresh = await call(
			'/oauth2/token',
			new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: token.refresh_token,
				client_id: clientId,
				resource: origin + '/mcp'
			}),
			'',
			true
		);
		expect(refresh.status).not.toBe(200);
		expect((await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user.id).toBe(
			teacherId
		);
	});
});
