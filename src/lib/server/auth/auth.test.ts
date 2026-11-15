import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { randomBytes } from 'node:crypto';
import { createAuth, type Auth } from '../auth.js';
import { createDatabase } from '../db/index.js';
import {
	issueInvitation,
	readInvitation,
	invitationCookieName,
	invitationIdentifier,
	type PrivateRole
} from './invitations.js';
import { consumeRateLimit, rateLimitRetentionMs } from './rate-limit.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import { revokeAccount } from './revoke.js';
import { requireTeacher } from './access.js';
import { authOrigin } from './config.js';
import { virtualPasskey } from './testing/webauthn.js';
import { createAuthClient } from 'better-auth/client';
import { passkeyClient } from '@better-auth/passkey/client';

const origin = 'https://campus.example.test';
const cookies = (response: Response) =>
	response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(';')[0])
		.join(';');
let client: Client;
let auth: Auth;
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	await migrate(createDatabase(client), { migrationsFolder: './drizzle' });
	auth = await createAuth({ ORIGIN: origin, BETTER_AUTH_SECRET: randomBytes(32).toString('hex') }, client);
});
afterEach(() => {
	client.close();
	vi.restoreAllMocks();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function request(path: string, cookie = '', body?: unknown, requestOrigin = origin) {
	return auth.handler(
		new Request(origin + '/api/auth' + path, {
			method: body === undefined ? 'GET' : 'POST',
			headers: {
				origin: requestOrigin,
				cookie,
				'Content-Type': 'application/json',
				'cf-connecting-ip': '192.0.2.1'
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		})
	);
}

async function invite(role: PrivateRole = 'teacher') {
	return issueInvitation(client, { role, name: 'Compte fictif', email: role + '@example.test' });
}
async function register(role: PrivateRole = 'teacher') {
	const invitation = await invite(role);
	const authenticator = virtualPasskey(origin);
	const inviteCookie = invitationCookieName + '=' + invitation.token;
	const options = await request('/passkey/generate-register-options', inviteCookie);
	expect(options.status).toBe(200);
	const body = (await options.json()) as {
		challenge: string;
		authenticatorSelection: { userVerification: string; residentKey: string };
	};
	expect(body.authenticatorSelection.userVerification).toBe('required');
	expect(body.authenticatorSelection.residentKey).toBe('required');
	const challengeCookies = inviteCookie + ';' + cookies(options);
	const responseBody = { response: authenticator.register(body), createSession: true };
	const response = await request('/passkey/verify-registration', challengeCookies, responseBody);
	expect(response.status, await response.clone().text()).toBe(200);
	return {
		invitation,
		authenticator,
		response,
		sessionCookie: cookies(response),
		challengeCookies,
		responseBody
	};
}

describe('Required user verification in authentication options', () => {
	it.each([false, true])('requires UV with session: %s and keeps the challenge usable', async (withSession) => {
		const account = await register();
		const options = await request('/passkey/generate-authenticate-options', withSession ? account.sessionCookie : '');
		expect(options.status).toBe(200);
		const body = (await options.json()) as Record<string, unknown>;
		expect(body).toMatchObject({ userVerification: 'required', rpId: new URL(origin).hostname });
		expect(body.challenge).toEqual(expect.any(String));
		expect(options.headers.get('set-cookie')).toContain('HttpOnly');
		if (withSession) expect(body.allowCredentials).toHaveLength(1);
		const signedIn = await request('/passkey/verify-authentication', cookies(options), {
			response: account.authenticator.authenticate(body)
		});
		expect(signedIn.status).toBe(200);
		const session = await request('/get-session', cookies(signedIn));
		expect(((await session.json()) as { user: { role: string } }).user.role).toBe('teacher');
	});
	it('passes required UV through the installed browser SDK without another options fetch', async () => {
		let generated: Record<string, unknown> | undefined;
		const fetchOptions = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const response = await auth.handler(new Request(input, init));
			generated = await response.clone().json();
			return response;
		});
		const get = vi.fn<(options?: CredentialRequestOptions) => Promise<Credential | null>>(async () => {
			throw new DOMException('Fictional cancellation', 'NotAllowedError');
		});
		vi.stubGlobal('PublicKeyCredential', class {});
		vi.stubGlobal('navigator', { credentials: { get } });
		const browser = createAuthClient({
			baseURL: origin,
			plugins: [passkeyClient()],
			fetchOptions: { customFetchImpl: fetchOptions }
		});
		await browser.signIn.passkey();
		expect(fetchOptions).toHaveBeenCalledTimes(1);
		expect(get).toHaveBeenCalledTimes(1);
		expect(get.mock.calls[0][0]).toMatchObject({
			publicKey: { userVerification: 'required', rpId: new URL(origin).hostname }
		});
		const publicKey = (get.mock.calls[0][0] as CredentialRequestOptions).publicKey!;
		expect(Buffer.from(publicKey.challenge as ArrayBuffer).toString('base64url')).toBe(generated?.challenge);
	});
});

describe('Passkeys sur invitation', () => {
	it('identifies Campus when registering a passkey', async () => {
		const invitation = await invite();
		const response = await request('/passkey/generate-register-options', invitationCookieName + '=' + invitation.token);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ rp: { id: new URL(origin).hostname, name: 'Campus' } });
	});
	it('la vérification technique Better Auth répond', async () => {
		const response = await request('/ok');
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});
	it('refuse un POST de navigateur sans origine', async () => {
		const invitation = await invite();
		const cookie = invitationCookieName + '=' + invitation.token;
		const options = await request('/passkey/generate-register-options', cookie);
		const response = await auth.handler(
			new Request(origin + '/api/auth/passkey/verify-registration', {
				method: 'POST',
				headers: {
					cookie: cookie + ';' + cookies(options),
					'Content-Type': 'application/json',
					'cf-connecting-ip': '192.0.2.1'
				},
				body: JSON.stringify({
					response: virtualPasskey(origin).register(await options.json()),
					createSession: true
				})
			})
		);
		expect(response.status).toBe(403);
		expect((await client.execute('SELECT count(*) AS count FROM passkey')).rows[0].count).toBe(0);
	});
	it('applique la limite de requêtes aux endpoints réels', async () => {
		let response: Response | undefined;
		for (let i = 0; i < 31; i++) response = await request('/passkey/generate-register-options');
		expect(response?.status).toBe(429);
		expect(Number(response?.headers.get('X-Retry-After'))).toBeGreaterThan(0);
	});
	it('refuse une inscription libre et une inscription par mot de passe', async () => {
		expect((await request('/passkey/generate-register-options')).status).toBe(403);
		expect(
			(
				await request('/sign-up/email', '', {
					name: 'Intrus',
					email: 'intrus@example.test',
					password: 'password12345',
					role: 'teacher'
				})
			).status
		).toBe(400);
		expect((await client.execute('SELECT count(*) AS count FROM user')).rows[0].count).toBe(0);
	});
	it.each(['teacher'] as const)('active %s, consomme l’invitation, connecte et déconnecte', async (role) => {
		const account = await register(role);
		expect(((await account.response.json()) as { user: { role: string } }).user.role).toBe(role);
		expect(
			account.response.headers
				.getSetCookie()
				.some(
					(cookie) => cookie.includes('HttpOnly') && cookie.includes('Secure') && cookie.includes('SameSite=Strict')
				)
		).toBe(true);
		expect((await auth.api.getSession({ headers: new Headers({ cookie: account.sessionCookie }) }))?.user.role).toBe(
			role
		);
		await expect(readInvitation(client, account.invitation.token)).rejects.toThrow('Invitation');
		expect((await request('/passkey/verify-registration', account.challengeCookies, account.responseBody)).status).toBe(
			400
		);
		const options = await request('/passkey/generate-authenticate-options');
		const signIn = await request('/passkey/verify-authentication', cookies(options), {
			response: account.authenticator.authenticate(await options.json())
		});
		expect(signIn.status, await signIn.clone().text()).toBe(200);
		const sessionCookie = cookies(signIn);
		await request('/sign-out', sessionCookie, {});
		expect(await auth.api.getSession({ headers: new Headers({ cookie: sessionCookie }) })).toBeNull();
	});
	it('interdit l’élévation du rôle par le client et l’ajout de clé sans invitation', async () => {
		const account = await register();
		await request('/update-user', account.sessionCookie, { role: 'student' });
		const session = await auth.api.getSession({
			headers: new Headers({ cookie: account.sessionCookie })
		});
		expect(session?.user.role).toBe('teacher');
		const options = await request('/passkey/generate-register-options', account.sessionCookie);
		const response = await request('/passkey/verify-registration', account.sessionCookie + ';' + cookies(options), {
			response: virtualPasskey(origin).register(await options.json()),
			createSession: true
		});
		expect(response.status).toBe(403);
		expect((await client.execute('SELECT count(*) AS count FROM passkey')).rows[0].count).toBe(1);
	});
	it('refuse une origine étrangère et conserve l’invitation', async () => {
		const invitation = await invite();
		const cookie = invitationCookieName + '=' + invitation.token;
		const options = await request('/passkey/generate-register-options', cookie);
		const optionBody = await options.json();
		expect(
			(
				await request(
					'/passkey/verify-registration',
					cookie + ';' + cookies(options),
					{
						response: virtualPasskey(origin).register(optionBody),
						createSession: true
					},
					'https://hostile.example'
				)
			).status
		).toBe(403);
		const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
		const response = await request('/passkey/verify-registration', cookie + ';' + cookies(options), {
			response: virtualPasskey(origin).register(optionBody, 'https://hostile.example'),
			createSession: true
		});
		expect(response.status).toBeGreaterThanOrEqual(400);
		logger.mockRestore();
		expect((await client.execute('SELECT count(*) AS count FROM passkey')).rows[0].count).toBe(0);
		expect((await readInvitation(client, invitation.token)).id).toBe(invitation.id);
	});
	it('exige la validation de l’appareil à l’inscription et à la connexion', async () => {
		const invitation = await invite();
		const cookie = invitationCookieName + '=' + invitation.token;
		const options = await request('/passkey/generate-register-options', cookie);
		expect(
			(
				await request('/passkey/verify-registration', cookie + ';' + cookies(options), {
					response: virtualPasskey(origin).register(await options.json(), origin, false),
					createSession: true
				})
			).status
		).toBe(403);
		const account = await register();
		const authOptions = await request('/passkey/generate-authenticate-options');
		expect(
			(
				await request('/passkey/verify-authentication', cookies(authOptions), {
					response: account.authenticator.authenticate(await authOptions.json(), 1, false)
				})
			).status
		).toBe(403);
	});
	it('une même invitation n’active pas deux clés avec deux challenges valides', async () => {
		const invitation = await invite();
		const cookie = invitationCookieName + '=' + invitation.token;
		const first = await request('/passkey/generate-register-options', cookie);
		const second = await request('/passkey/generate-register-options', cookie);
		const a = await request('/passkey/verify-registration', cookie + ';' + cookies(first), {
			response: virtualPasskey(origin).register(await first.json()),
			createSession: true
		});
		const b = await request('/passkey/verify-registration', cookie + ';' + cookies(second), {
			response: virtualPasskey(origin).register(await second.json()),
			createSession: true
		});
		expect(a.status).toBe(200);
		expect(b.status).toBeGreaterThanOrEqual(400);
		expect((await client.execute('SELECT count(*) AS count FROM passkey')).rows[0].count).toBe(1);
	});
	it('renewing a teacher invitation invalidates the previous token', async () => {
		const first = await invite();
		const second = await invite();
		expect(second.id).toBe(first.id);
		await expect(readInvitation(client, first.token)).rejects.toThrow('Invitation');
		expect((await readInvitation(client, second.token)).role).toBe('teacher');
		expect((await client.execute('SELECT count(*) AS count FROM user')).rows[0].count).toBe(1);
	});
	it('refuses a distinct teacher while preserving the first pending invitation', async () => {
		const first = await invite();
		await expect(
			issueInvitation(client, { role: 'teacher', name: 'Other Demo', email: 'other@example.test' })
		).rejects.toThrow('Cette instance possède déjà un compte enseignant distinct.');
		expect((await readInvitation(client, first.token)).id).toBe(first.id);
		expect((await client.execute('SELECT id, email FROM user')).rows).toEqual([{ id: first.id, email: first.email }]);
		expect(
			(await client.execute("SELECT count(*) AS count FROM verification WHERE identifier LIKE 'coursely-invite:%'"))
				.rows[0].count
		).toBe(1);
	});
	it('recovers the same normalized teacher identity without replacing its credentials or session', async () => {
		const account = await register();
		const passkeys = (await client.execute('SELECT id, user_id FROM passkey ORDER BY id')).rows;
		const sessions = (await client.execute('SELECT id, user_id FROM session ORDER BY id')).rows;
		const invitation = await issueInvitation(client, {
			role: 'teacher',
			name: 'Teacher Recovery',
			email: '  TEACHER@EXAMPLE.TEST  '
		});
		expect(invitation.id).toBe(account.invitation.id);
		expect(invitation.email).toBe(account.invitation.email);
		expect((await readInvitation(client, invitation.token)).id).toBe(account.invitation.id);
		expect((await client.execute('SELECT id, user_id FROM passkey ORDER BY id')).rows).toEqual(passkeys);
		expect((await client.execute('SELECT id, user_id FROM session ORDER BY id')).rows).toEqual(sessions);
		expect((await client.execute('SELECT count(*) AS count FROM user')).rows[0].count).toBe(1);
	});
	it('allows only one teacher when distinct invitations are issued concurrently', async () => {
		const attempts = await Promise.allSettled(
			['first@example.test', 'second@example.test'].map((email) =>
				issueInvitation(client, { role: 'teacher', name: 'Concurrent Demo', email })
			)
		);
		const accepted = attempts.filter((attempt) => attempt.status === 'fulfilled');
		const refused = attempts.filter((attempt) => attempt.status === 'rejected');
		expect(accepted).toHaveLength(1);
		expect(refused).toHaveLength(1);
		expect(refused[0].reason).toMatchObject({
			message: 'Cette instance possède déjà un compte enseignant distinct.'
		});
		expect((await readInvitation(client, accepted[0].value.token)).id).toBe(accepted[0].value.id);
		expect((await client.execute('SELECT count(*) AS count FROM user')).rows[0].count).toBe(1);
		expect(
			(await client.execute("SELECT count(*) AS count FROM verification WHERE identifier LIKE 'coursely-invite:%'"))
				.rows[0].count
		).toBe(1);
	});
	it('refuse une invitation expirée', async () => {
		const invitation = await issueInvitation(
			client,
			{ role: 'teacher', email: 'expired@example.test', name: 'Expiration' },
			Date.now() - 25 * 60 * 60 * 1000
		);
		await expect(readInvitation(client, invitation.token)).rejects.toThrow('Invitation');
	});
	it('la révocation invalide immédiatement les sessions et supprime les clés', async () => {
		const account = await register();
		await revokeAccount(client, account.invitation.email);
		expect(await auth.api.getSession({ headers: new Headers({ cookie: account.sessionCookie }) })).toBeNull();
		expect((await client.execute('SELECT count(*) AS count FROM passkey')).rows[0].count).toBe(0);
		expect((await client.execute('SELECT count(*) AS count FROM session')).rows[0].count).toBe(0);
	});
});

function captureFailure(operation: () => unknown) {
	try {
		return operation();
	} catch (cause) {
		return cause;
	}
}

it('server guards require a current teacher session with the matching identity', async () => {
	expect(captureFailure(() => requireTeacher({ user: null, session: null }))).toMatchObject({
		status: 401
	});
	const account = await register();
	const session = await auth.api.getSession({
		headers: new Headers({ cookie: account.sessionCookie })
	});
	if (!session) throw new Error('Missing test session');
	expect(requireTeacher(session).role).toBe('teacher');
	expect(
		captureFailure(() => requireTeacher({ ...session, user: { ...session.user, role: 'student' as 'teacher' } }))
	).toMatchObject({ status: 403 });
	expect(
		captureFailure(() => requireTeacher({ ...session, session: { ...session.session, userId: 'another-user' } }))
	).toMatchObject({ status: 403 });
	expect(
		captureFailure(() => requireTeacher({ ...session, session: { ...session.session, expiresAt: new Date(0) } }))
	).toMatchObject({ status: 401 });
});

it('le quota partagé résiste aux appels concurrents et se réinitialise', async () => {
	const now = Date.now();
	const rule = { window: 60, max: 3 };
	await client.batch(
		Array.from({ length: 125 }, (_, index) => ({
			sql: 'INSERT INTO auth_rate_limit (key, count, started_at) VALUES (?, 1, ?)',
			args: [`synthetic-history-${index}`, now - rateLimitRetentionMs - 1]
		})),
		'write'
	);
	const responses = await Promise.all(
		Array.from({ length: 8 }, () => consumeRateLimit(client, 'same-client', rule, now))
	);
	expect(responses.filter((response) => response.allowed)).toHaveLength(3);
	const buckets = (await client.execute('SELECT key, count FROM auth_rate_limit')).rows;
	expect(buckets).toHaveLength(1);
	expect(buckets[0].count).toBe(8);
	expect((await consumeRateLimit(client, 'same-client', rule, now + 60000)).allowed).toBe(true);
	expect((await client.execute('SELECT key FROM auth_rate_limit')).rows[0].key).not.toBe('same-client');
});

it('unknown auth paths create temporary buckets that ordinary requests clean without touching private records', async () => {
	await seedFoundationFixtures(createDatabase(client));
	await register();
	const sessions = (await client.execute('SELECT * FROM session ORDER BY id')).rows;
	const students = (await client.execute('SELECT * FROM student ORDER BY id')).rows;
	expect(sessions).not.toHaveLength(0);
	expect(students).toHaveLength(13);
	const now = Date.now();
	const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
	const before = new Set((await client.execute('SELECT key FROM auth_rate_limit')).rows.map((row) => row.key));
	expect((await request('/synthetic-unknown-before')).status).toBe(404);
	const temporary = (await client.execute('SELECT key, started_at FROM auth_rate_limit')).rows.filter(
		(row) => !before.has(row.key)
	);
	expect(temporary).toHaveLength(1);
	expect(temporary[0].started_at).toBe(now);
	clock.mockReturnValue(now + rateLimitRetentionMs + 1);
	expect((await request('/synthetic-unknown-after')).status).toBe(404);
	const retained = (await client.execute('SELECT key FROM auth_rate_limit')).rows;
	expect(retained.map((row) => row.key)).not.toContain(temporary[0].key);
	expect(retained).toHaveLength(1);
	expect((await client.execute('SELECT * FROM session ORDER BY id')).rows).toEqual(sessions);
	expect((await client.execute('SELECT * FROM student ORDER BY id')).rows).toEqual(students);
});

it('refuse un secret court et HTTP hors localhost', () => {
	expect(() => authOrigin({ ORIGIN: origin, BETTER_AUTH_SECRET: 'court' })).toThrow();
	expect(() => authOrigin({ ORIGIN: 'http://campus.example.test', BETTER_AUTH_SECRET: 'a'.repeat(64) })).toThrow();
	expect(authOrigin({ ORIGIN: 'http://localhost:5173', BETTER_AUTH_SECRET: 'a'.repeat(64) })).toBe(
		'http://localhost:5173'
	);
});

it('rejects an expired invitation even when its registration challenge was issued earlier', async () => {
	const invitation = await invite();
	const cookie = invitationCookieName + '=' + invitation.token;
	const options = await request('/passkey/generate-register-options', cookie);
	await client.execute({
		sql: 'UPDATE verification SET expires_at = 0 WHERE identifier LIKE ?',
		args: ['coursely-invite:%']
	});
	const response = await request('/passkey/verify-registration', cookie + ';' + cookies(options), {
		response: virtualPasskey(origin).register(await options.json()),
		createSession: true
	});
	expect(response.status).toBeGreaterThanOrEqual(400);
	expect((await client.execute('SELECT count(*) AS count FROM passkey')).rows[0].count).toBe(0);
});

it('a single invitation cannot register two credentials concurrently', async () => {
	const invitation = await invite();
	const cookie = invitationCookieName + '=' + invitation.token;
	const first = await request('/passkey/generate-register-options', cookie);
	const second = await request('/passkey/generate-register-options', cookie);
	const firstResponse = virtualPasskey(origin).register(await first.json());
	const secondResponse = virtualPasskey(origin).register(await second.json());
	const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
	const responses = await Promise.all([
		request('/passkey/verify-registration', cookie + ';' + cookies(first), {
			response: firstResponse,
			createSession: true
		}),
		request('/passkey/verify-registration', cookie + ';' + cookies(second), {
			response: secondResponse,
			createSession: true
		})
	]);
	logger.mockRestore();
	expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
	expect((await client.execute('SELECT count(*) AS count FROM passkey')).rows[0].count).toBe(1);
	await expect(readInvitation(client, invitation.token)).rejects.toThrow('Invitation');
});

it('an invitation cannot attach a credential to another signed-in identity', async () => {
	const account = await register();
	const invitation = {
		id: crypto.randomUUID(),
		role: 'teacher',
		name: 'Other Demo',
		email: 'other@example.test',
		token: randomBytes(32).toString('hex')
	};
	const now = Date.now();
	// A historical second identity must not bypass credential ownership checks.
	await client.batch(
		[
			{
				sql: 'INSERT INTO user (id, name, email, email_verified, created_at, updated_at, role) VALUES (?, ?, ?, 0, ?, ?, ?)',
				args: [invitation.id, invitation.name, invitation.email, now, now, invitation.role]
			},
			{
				sql: 'INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
				args: [
					crypto.randomUUID(),
					await invitationIdentifier(invitation.token),
					JSON.stringify({ id: invitation.id, role: invitation.role, name: invitation.name, email: invitation.email }),
					now + 24 * 60 * 60 * 1000,
					now,
					now
				]
			}
		],
		'write'
	);
	const cookie = account.sessionCookie + ';' + invitationCookieName + '=' + invitation.token;
	const options = await request('/passkey/generate-register-options', cookie);
	const response = await request('/passkey/verify-registration', cookie + ';' + cookies(options), {
		response: virtualPasskey(origin).register(await options.json()),
		createSession: true
	});
	expect(response.status).toBe(403);
	expect((await readInvitation(client, invitation.token)).id).toBe(invitation.id);
	expect((await client.execute('SELECT count(*) AS count FROM passkey')).rows[0].count).toBe(1);
});

describe('Session renewal headers from real authentication', () => {
	it('does not renew before updateAge, then renews the same session for eight hours', async () => {
		const account = await register();
		const headers = new Headers({ cookie: account.sessionCookie });
		const first = await auth.api.getSession({ headers, returnHeaders: true });
		if (!first.response) throw new Error('Missing fictional session');
		expect(first.headers.getSetCookie().length).toBe(0);
		const original = first.response.session;
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(original.expiresAt.valueOf() - 8 * 60 * 60 * 1000 + 60 * 60 * 1000 + 1000));
		const renewed = await auth.api.getSession({ headers, returnHeaders: true });
		if (!renewed.response) throw new Error('Missing renewed fictional session');
		expect(renewed.response.session.id).toBe(original.id);
		expect(renewed.response.user.id).toBe(first.response.user.id);
		expect(renewed.response.session.token === original.token, 'Same credential remains in memory').toBe(true);
		expect(renewed.response.session.expiresAt.valueOf()).toBeGreaterThan(original.expiresAt.valueOf());
		expect(renewed.response.session.expiresAt.valueOf()).toBe(Date.now() + 8 * 60 * 60 * 1000);
		const emitted = renewed.headers.getSetCookie();
		expect(
			emitted.some(
				(header) =>
					header.includes('Max-Age=28800') &&
					header.includes('HttpOnly') &&
					header.split(';').some((attribute) => attribute.trim() === 'Secure') &&
					header.includes('SameSite=Strict') &&
					header.includes('Path=/')
			)
		).toBe(true);
		const stored = (
			await client.execute({
				sql: 'SELECT id, user_id, expires_at FROM session WHERE id = ?',
				args: [original.id]
			})
		).rows;
		expect(stored).toHaveLength(1);
		expect(stored[0].expires_at).toBe(renewed.response.session.expiresAt.valueOf());
		const again = await auth.api.getSession({ headers, returnHeaders: true });
		expect(again.headers.getSetCookie().length).toBe(0);
		expect(again.response?.session.expiresAt.valueOf()).toBe(renewed.response.session.expiresAt.valueOf());
	});
	it('expired sessions return null with deletion cookies and remove the session', async () => {
		const account = await register();
		await client.execute({ sql: 'UPDATE session SET expires_at = ?', args: [Date.now() - 1000] });
		const result = await auth.api.getSession({
			headers: new Headers({ cookie: account.sessionCookie }),
			returnHeaders: true
		});
		expect(result.response === null).toBe(true);
		expect(result.headers.getSetCookie().some((header) => header.includes('Max-Age=0'))).toBe(true);
		expect((await client.execute('SELECT count(*) AS count FROM session')).rows[0].count).toBe(0);
	});
	it('revoked sessions cannot be renewed and clear their cookie', async () => {
		const account = await register();
		await revokeAccount(client, account.invitation.email);
		const result = await auth.api.getSession({
			headers: new Headers({ cookie: account.sessionCookie }),
			returnHeaders: true
		});
		expect(result.response === null).toBe(true);
		expect(result.headers.getSetCookie().some((header) => header.includes('Max-Age=0'))).toBe(true);
		expect((await client.execute('SELECT count(*) AS count FROM session')).rows[0].count).toBe(0);
	});
});

it('keeps logout retriable when session deletion fails, then revokes the retained cookie', async () => {
	const account = await register();
	const headers = new Headers({ cookie: account.sessionCookie });
	await client.execute(`CREATE TRIGGER fictional_logout_delete_failure BEFORE DELETE ON session
 BEGIN SELECT RAISE(FAIL, 'Fictional session-delete failure'); END`);
	vi.spyOn(console, 'error').mockImplementation(() => {});
	let response: Response;
	try {
		response = await request('/sign-out', account.sessionCookie, {});
	} finally {
		await client.execute('DROP TRIGGER fictional_logout_delete_failure');
	}
	expect(response.status).toBe(503);
	expect(await response.json()).not.toMatchObject({ success: true });
	expect(response.headers.getSetCookie().some((cookie) => cookie.includes('session_token=;'))).toBe(false);
	expect((await auth.api.getSession({ headers }))?.user.id).toBe(account.invitation.id);
	const retry = await request('/sign-out', account.sessionCookie, {});
	expect(retry.status).toBe(200);
	expect(await retry.json()).toEqual({ success: true });
	expect(await auth.api.getSession({ headers })).toBeNull();
	expect((await request('/sign-out', account.sessionCookie, {})).status).toBe(200);
});

it('refuses successful logout when the adapter suppresses its preliminary session-read failure', async () => {
	const account = await register();
	const context = await auth.$context;
	const original = context.adapter.findMany.bind(context.adapter);
	const lookup = vi.spyOn(context.adapter, 'findMany').mockImplementation(async (input) => {
		if (input.model === 'session') throw new Error('Fictional session lookup failure');
		return original(input);
	});
	const response = await request('/sign-out', account.sessionCookie, {});
	lookup.mockRestore();
	expect(response.status).toBe(503);
	expect(response.headers.getSetCookie().some((cookie) => cookie.includes('session_token=;'))).toBe(false);
	expect((await auth.api.getSession({ headers: new Headers({ cookie: account.sessionCookie }) }))?.user.id).toBe(
		account.invitation.id
	);
	expect((await request('/sign-out', account.sessionCookie, {})).status).toBe(200);
	expect(await auth.api.getSession({ headers: new Headers({ cookie: account.sessionCookie }) })).toBeNull();
});
