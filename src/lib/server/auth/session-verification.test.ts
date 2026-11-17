import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client, type InStatement } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { makeSignature } from 'better-auth/crypto';
import { createAuth, type Auth, type AuthSession } from '../auth.js';
import { createDatabase } from '../db/index.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';

const origin = 'https://campus.example.test';
const settings = {
	ORIGIN: origin,
	BETTER_AUTH_SECRET: 'fictional-session-verification-only-123456'
};
let client: Client;
let auth: Auth;
let cookie: string;

beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	await migrate(createDatabase(client), { migrationsFolder: './drizzle' });
	const ids = await seedFoundationFixtures(createDatabase(client));
	auth = await createAuth(settings, client);
	const session = await (await auth.$context).internalAdapter.createSession(ids.teacher);
	const signature = await makeSignature(session.token, settings.BETTER_AUTH_SECRET);
	cookie = '__Secure-coursely.session_token=' + encodeURIComponent(session.token + '.' + signature);
});

afterEach(() => {
	vi.restoreAllMocks();
	client.close();
});

describe('Cookie session verification is independent of external JWT signing', () => {
	it.each([
		['server', false],
		['server', true],
		['endpoint', false],
		['endpoint', true]
	] as const)('verifies a %s session (renewal: %s) without reading signing keys', async (transport, renew) => {
		if (renew) {
			await client.execute({
				sql: 'UPDATE session SET expires_at = ?',
				args: [Date.now() + 6 * 60 * 60 * 1000]
			});
		}
		const execute = client.execute.bind(client);
		let signingReads = 0;
		vi.spyOn(client, 'execute').mockImplementation(async (statement: InStatement | string) => {
			const sql = typeof statement === 'string' ? statement : statement.sql;
			if (/\bfrom\s+["`]?jwks\b/i.test(sql)) {
				signingReads++;
				throw new Error('FICTIONAL_EXTERNAL_SIGNING_UNAVAILABLE');
			}
			return execute(statement);
		});
		const headers = new Headers({ cookie });
		const result =
			transport === 'server'
				? await auth.api.getSession({ headers, returnHeaders: true })
				: await auth.handler(new Request(origin + '/api/auth/get-session', { headers })).then(async (response) => {
						expect(response.status).toBe(200);
						return {
							response: (await response.json()) as AuthSession | null,
							headers: response.headers
						};
					});
		expect(result.response?.user.role).toBe('teacher');
		expect(result.headers.has('set-auth-jwt')).toBe(false);
		expect(result.headers.getSetCookie().some((value) => value.includes('Max-Age=28800'))).toBe(renew);
		expect(signingReads).toBe(0);
	});

	it('still rejects a revoked session instead of trusting its signed cookie', async () => {
		await client.execute('DELETE FROM session');
		const result = await auth.api.getSession({
			headers: new Headers({ cookie }),
			returnHeaders: true
		});
		expect(result.response).toBeNull();
		expect(result.headers.getSetCookie().some((value) => value.includes('Max-Age=0'))).toBe(true);
	});
});

describe('Server session reads inherit navigation metadata without becoming HTTP auth requests', () => {
	it.each([
		{ origin: 'https://campus.example.test', accepted: true },
		{ origin: 'null', accepted: false }
	])(
		'keeps native form headers subject to the explicit origin guard ($origin)',
		async ({ origin: claimedOrigin, accepted }) => {
			const request = auth.api.getSession({
				headers: new Headers({
					cookie,
					origin: claimedOrigin,
					accept: 'text/html,application/xhtml+xml',
					'content-type': 'multipart/form-data; boundary=fictional',
					'sec-fetch-site': 'same-origin',
					'sec-fetch-mode': 'navigate',
					'sec-fetch-dest': 'document'
				}),
				returnHeaders: true
			});
			if (accepted) expect((await request).response?.user.role).toBe('teacher');
			else await expect(request).rejects.toMatchObject({ statusCode: 403 });
		}
	);
	it.each([false, true])('accepts a cross-site navigation with a valid session (renewal: %s)', async (renew) => {
		if (renew) {
			await client.execute({
				sql: 'UPDATE session SET expires_at = ?',
				args: [Date.now() + 6 * 60 * 60 * 1000]
			});
		}
		const before = (await client.execute('SELECT id, expires_at FROM session')).rows[0];
		const result = await auth.api.getSession({
			headers: new Headers({
				cookie,
				'sec-fetch-site': 'cross-site',
				'sec-fetch-mode': 'navigate'
			}),
			returnHeaders: true
		});
		expect(result.response?.user.role).toBe('teacher');
		expect(result.response?.session.id).toBe(before.id);
		expect(result.headers.getSetCookie().some((value) => value.includes('Max-Age=28800'))).toBe(renew);
		const stored = (await client.execute('SELECT id, expires_at FROM session')).rows;
		expect(stored).toHaveLength(1);
		expect(stored[0].expires_at).toBe(result.response?.session.expiresAt.valueOf());
		if (renew) expect(Number(stored[0].expires_at)).toBeGreaterThan(Number(before.expires_at));
		else expect(stored[0].expires_at).toBe(before.expires_at);
	});

	it.each(['expired', 'revoked'] as const)('still rejects a %s session on direct navigation', async (state) => {
		if (state === 'expired') {
			await client.execute({
				sql: 'UPDATE session SET expires_at = ?',
				args: [Date.now() - 1000]
			});
		} else await client.execute('DELETE FROM session');
		const result = await auth.api.getSession({
			headers: new Headers({
				cookie,
				'sec-fetch-site': 'cross-site',
				'sec-fetch-mode': 'navigate'
			}),
			returnHeaders: true
		});
		expect(result.response).toBeNull();
		expect(result.headers.getSetCookie().some((value) => value.includes('Max-Age=0'))).toBe(true);
		expect((await client.execute('SELECT count(*) AS count FROM session')).rows[0].count).toBe(0);
	});

	it('keeps the origin guard on actual HTTP session reads and other server endpoints', async () => {
		const headers = new Headers({
			cookie,
			'sec-fetch-site': 'cross-site',
			'sec-fetch-mode': 'navigate'
		});
		const adapter = (await auth.$context).internalAdapter;
		const findSession = vi.spyOn(adapter, 'findSession');
		const updateSession = vi.spyOn(adapter, 'updateSession');
		const response = await auth.handler(new Request(origin + '/api/auth/get-session', { headers }));
		expect(response.status).toBe(403);
		await expect(auth.api.listSessions({ headers })).rejects.toMatchObject({ statusCode: 403 });
		await expect(auth.api.getSession({ headers, method: 'POST' })).rejects.toMatchObject({
			statusCode: 403
		});
		expect(findSession).not.toHaveBeenCalled();
		expect(updateSession).not.toHaveBeenCalled();
	});

	it('does not excuse an explicit foreign origin on an internal session read', async () => {
		await expect(
			auth.api.getSession({
				headers: new Headers({ cookie, origin: 'https://foreign.example.test' })
			})
		).rejects.toMatchObject({ statusCode: 403 });
	});
});
