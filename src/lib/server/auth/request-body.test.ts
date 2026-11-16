import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isHttpError, json, type RequestEvent } from '@sveltejs/kit';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { randomBytes } from 'node:crypto';
vi.mock('./runtime.js', () => ({ withAuth: vi.fn() }));
import { withAuth } from './runtime.js';
import { createAuth, type Auth } from '../auth.js';
import { createDatabase } from '../db/index.js';
import { issueInvitation, invitationCookieName } from './invitations.js';
import { virtualPasskey } from './testing/webauthn.js';
import * as rateLimit from './rate-limit.js';
import { POST as activation } from '../../../routes/api/activation/+server.js';
import { GET as authGet, POST as authPost } from '../../../routes/api/auth/[...all]/+server.js';

const origin = 'https://campus.example.test';
let client: Client;
let auth: Auth;
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	await migrate(createDatabase(client), { migrationsFolder: './drizzle' });
	auth = await createAuth({ ORIGIN: origin, BETTER_AUTH_SECRET: randomBytes(32).toString('hex') }, client);
	vi.mocked(withAuth).mockImplementation(async (operation) => operation(auth, client, origin));
});
afterEach(() => {
	client.close();
	vi.restoreAllMocks();
});

function event(request: Request) {
	return {
		request,
		url: new URL(request.url),
		getClientAddress: () => '192.0.2.1',
		cookies: { set: vi.fn() }
	} as unknown as RequestEvent;
}
async function dispatch(handler: typeof activation | typeof authPost, current: RequestEvent) {
	try {
		return await handler(current as Parameters<typeof activation>[0] & Parameters<typeof authPost>[0]);
	} catch (cause) {
		if (isHttpError(cause)) return json(cause.body, { status: cause.status });
		throw cause;
	}
}
function request(path: string, body?: string, headers: Record<string, string> = {}) {
	return new Request(origin + path, {
		method: body === undefined ? 'GET' : 'POST',
		headers: {
			origin,
			'content-type': 'application/json',
			'cf-connecting-ip': '192.0.2.1',
			...headers
		},
		body
	});
}
function streamed(path: string, chunks: Uint8Array[], headers: Record<string, string> = {}) {
	let index = 0;
	const cancel = vi.fn<() => void | Promise<void>>();
	const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
		if (index < chunks.length) controller.enqueue(chunks[index++]);
		else controller.close();
	});
	const body = new ReadableStream({ pull, cancel }, { highWaterMark: 0 });
	const current = new Request(origin + path, {
		method: 'POST',
		headers: { origin, 'content-type': 'application/json', ...headers },
		body,
		duplex: 'half'
	} as RequestInit & { duplex: 'half' });
	return { current, cancel, pull };
}
const endpoints = [
	{ name: 'activation', handler: activation, path: '/api/activation', limit: 1024 },
	{
		name: 'Better Auth',
		handler: authPost,
		path: '/api/auth/passkey/verify-authentication',
		limit: 64 * 1024
	}
];
const cookies = (response: Response) =>
	response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(';')[0])
		.join(';');

function noDiagnosticHeaders(response: Response) {
	expect(response.headers.get('X-Campus-Auth-Diagnostic')).toBeNull();
	expect(response.headers.get('X-Campus-Auth-Details')).toBeNull();
}

describe('Passkey rejection privacy through the route', () => {
	beforeEach(() => {
		vi.mocked(withAuth).mockImplementation(async (operation) => {
			const current = await createAuth(
				{ ORIGIN: origin, BETTER_AUTH_SECRET: 'fictional-stable-request-local-secret-32-chars' },
				client
			);
			return operation(current, client, origin);
		});
	});
	const account = async () => {
		const invitation = await issueInvitation(client, {
			role: 'teacher',
			name: 'Compte fictif',
			email: 'diagnostic@example.test'
		});
		const authenticator = virtualPasskey(origin);
		const options = await dispatch(
			authGet,
			event(
				request('/api/auth/passkey/generate-register-options', undefined, {
					cookie: invitationCookieName + '=' + invitation.token
				})
			)
		);
		const registration = await dispatch(
			authPost,
			event(
				request(
					'/api/auth/passkey/verify-registration',
					JSON.stringify({
						response: authenticator.register(await options.json()),
						createSession: true
					}),
					{ cookie: invitationCookieName + '=' + invitation.token + ';' + cookies(options) }
				)
			)
		);
		expect(registration.status).toBe(200);
		return authenticator;
	};
	async function options() {
		return dispatch(authGet, event(request('/api/auth/passkey/generate-authenticate-options')));
	}
	async function verify(cookie: string, response: unknown, claimedOrigin = origin) {
		return dispatch(
			authPost,
			event(
				request('/api/auth/passkey/verify-authentication', JSON.stringify({ response }), {
					cookie,
					origin: claimedOrigin
				})
			)
		);
	}
	it.each(['counter-write', 'session-write'])(
		'keeps the real 400 for %s and redacts raw SQL errors',
		async (category) => {
			const authenticator = await account();
			const generated = await options();
			const responseBody = authenticator.authenticate(await generated.json());
			await client.execute(
				category === 'counter-write'
					? "CREATE TRIGGER fictional_failure BEFORE UPDATE OF counter ON passkey BEGIN SELECT RAISE(ABORT, 'FICTIONAL_PRIVATE_SENTINEL'); END"
					: "CREATE TRIGGER fictional_failure BEFORE INSERT ON session BEGIN SELECT RAISE(ABORT, 'FICTIONAL_PRIVATE_SENTINEL'); END"
			);
			const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
			const response = await verify(cookies(generated), responseBody);
			expect(response.status).toBe(400);
			noDiagnosticHeaders(response);
			expect(await response.json()).toEqual({
				code: 'AUTHENTICATION_FAILED',
				message: 'Authentication failed'
			});
			expect(JSON.stringify(logger.mock.calls)).not.toContain('FICTIONAL_PRIVATE_SENTINEL');
			expect(logger).toHaveBeenCalledWith(expect.stringContaining('Passkey authentication verification failed.'));
		}
	);
	it('keeps concurrent rejections and a successful request isolated on fresh auth instances', async () => {
		const authenticator = await account();
		const otherAuthenticator = await account();
		const first = await options();
		const second = await options();
		const third = await options();
		const firstOptions = await first.json();
		const wrongOrigin = authenticator.authenticate(firstOptions);
		const clientData = JSON.parse(Buffer.from(wrongOrigin.response.clientDataJSON, 'base64url').toString());
		clientData.origin = 'https://other.example.test';
		wrongOrigin.response.clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');
		const wrongChallenge = otherAuthenticator.authenticate(firstOptions);
		const valid = authenticator.authenticate(await third.json());
		const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
		const [a, b, c] = await Promise.all([
			verify(cookies(first), wrongOrigin),
			verify(cookies(second), wrongChallenge),
			verify(cookies(third), valid)
		]);
		expect([a.status, b.status, c.status]).toEqual([400, 400, 200]);
		for (const response of [a, b, c]) noDiagnosticHeaders(response);
		expect(JSON.stringify(logger.mock.calls)).not.toContain('FICTIONAL_PRIVATE_SENTINEL');
		expect(logger).toHaveBeenCalledWith(expect.stringContaining('Passkey authentication verification failed.'));
	});
	it('preserves missing challenge, same-origin rejection and successful session without diagnostics', async () => {
		const authenticator = await account();
		const generated = await options();
		const body = authenticator.authenticate(await generated.json());
		const missing = await verify('', body);
		expect(missing.status).toBe(400);
		expect(await missing.json()).toMatchObject({ code: 'CHALLENGE_NOT_FOUND' });
		noDiagnosticHeaders(missing);
		const foreign = await verify(cookies(generated), body, 'https://other.example.test');
		expect(foreign.status).toBe(403);
		noDiagnosticHeaders(foreign);
		const success = await verify(cookies(generated), body);
		expect(success.status).toBe(200);
		noDiagnosticHeaders(success);
		const session = await dispatch(
			authGet,
			event(request('/api/auth/get-session', undefined, { cookie: cookies(success) }))
		);
		expect(session.status).toBe(200);
		expect(await session.json()).toMatchObject({ user: { role: 'teacher' } });
		noDiagnosticHeaders(session);
	});
});

describe.each(endpoints)('$name body boundary', ({ handler, path, limit }) => {
	const framingHeaders: Record<string, string>[] = [
		{},
		{ 'content-length': '1' },
		{ 'content-length': '0' },
		{ 'content-length': 'invalid' },
		{ 'transfer-encoding': 'chunked' }
	];
	it.each(framingHeaders)('counts actual bytes with framing %j and cancels before parsing', async (headers) => {
		const stream = streamed(path, [new Uint8Array(limit), new Uint8Array(1), new Uint8Array(8)], headers);
		const parser = vi.spyOn(stream.current, 'json');
		const relay = vi.spyOn(auth, 'handler');
		const response = await dispatch(handler, event(stream.current));
		expect(response.status).toBe(413);
		expect(stream.cancel).toHaveBeenCalledOnce();
		expect(stream.pull).toHaveBeenCalledTimes(2);
		expect(parser).not.toHaveBeenCalled();
		expect(relay).toHaveBeenCalledTimes(handler === authPost ? 1 : 0);
	});
	it('rejects a declared oversized body before pulling the stream', async () => {
		const stream = streamed(path, [new Uint8Array(1)], { 'content-length': String(limit + 1) });
		const response = await dispatch(handler, event(stream.current));
		expect(response.status).toBe(413);
		expect(stream.pull).not.toHaveBeenCalled();
		expect(stream.cancel).toHaveBeenCalledOnce();
	});
	it.each(['rejects', 'never settles'])('keeps 413 when stream cancellation %s', async (behavior) => {
		const stream = streamed(path, [new Uint8Array(limit + 1)]);
		stream.cancel.mockImplementation(() =>
			behavior === 'rejects' ? Promise.reject(new Error('Fictional cancellation failure')) : new Promise<void>(() => {})
		);
		const response = await dispatch(handler, event(stream.current));
		expect(response.status).toBe(413);
		expect(stream.cancel).toHaveBeenCalledOnce();
	});
	it('counts UTF-8 bytes rather than JavaScript characters', async () => {
		const body = JSON.stringify({ token: 'é'.repeat(Math.floor(limit / 2)) });
		expect(body.length).toBeLessThan(limit);
		const response = await dispatch(handler, event(request(path, body)));
		expect(response.status).toBe(413);
	});
	it('rejects a large valid JSON document in a single chunk', async () => {
		const body = JSON.stringify({
			token: 'a'.repeat(64),
			response: {},
			padding: 'x'.repeat(limit)
		});
		const response = await dispatch(handler, event(request(path, body)));
		expect(response.status).toBe(413);
	});
	it('keeps malformed or truncated JSON and empty bodies as 400 errors', async () => {
		for (const body of ['{', '{"token":"a", "response":', '']) {
			const response = await dispatch(handler, event(request(path, body)));
			expect(response.status).toBe(400);
		}
	});
	it('returns 400 for an interrupted input stream without forwarding partial data', async () => {
		let reads = 0;
		const body = new ReadableStream<Uint8Array>(
			{
				pull(controller) {
					if (reads++ === 0) controller.enqueue(new TextEncoder().encode('{"token":'));
					else controller.error(new Error('Fictional truncated transport'));
				}
			},
			{ highWaterMark: 0 }
		);
		const current = new Request(origin + path, {
			method: 'POST',
			headers: { origin, 'content-type': 'application/json' },
			body,
			duplex: 'half'
		} as RequestInit & { duplex: 'half' });
		const relay = vi.spyOn(auth, 'handler');
		const response = await dispatch(handler, event(current));
		expect(response.status).toBe(400);
		expect(relay).toHaveBeenCalledTimes(handler === authPost ? 1 : 0);
	});
});

describe('Auth relay compatibility', () => {
	it('counts oversized auth requests in the existing quota before reading', async () => {
		const limiter = vi.spyOn(rateLimit, 'consumeRateLimit');
		const stream = streamed('/api/auth/passkey/verify-authentication', [new Uint8Array(64 * 1024 + 1)]);
		expect((await dispatch(authPost, event(stream.current))).status).toBe(413);
		expect(limiter).toHaveBeenCalledOnce();
	});
	it.each([{}, { 'content-length': String(64 * 1024 + 1) }] as Record<string, string>[])(
		'keeps an exhausted Better Auth quota ahead of body reads with framing %j',
		async (headers) => {
			const limiter = vi.spyOn(rateLimit, 'consumeRateLimit').mockResolvedValue({ allowed: false, retryAfter: 60 });
			const stream = streamed('/api/auth/passkey/verify-authentication', [new Uint8Array(64 * 1024 + 1)], headers);
			const response = await dispatch(authPost, event(stream.current));
			expect(response.status).toBe(429);
			expect(stream.pull).not.toHaveBeenCalled();
			expect(stream.cancel).toHaveBeenCalledOnce();
			expect(limiter).toHaveBeenCalledOnce();
		}
	);
	it.each(['application/json; charset=utf-8', 'application/x-www-form-urlencoded'])(
		'bounds accepted parser representations: %s',
		async (contentType) => {
			const stream = streamed('/api/auth/sign-in/email', [new Uint8Array(64 * 1024 + 1)], {
				'content-type': contentType
			});
			expect((await dispatch(authPost, event(stream.current))).status).toBe(413);
			expect(stream.cancel).toHaveBeenCalledOnce();
		}
	);
	it.each(['application/problem+json', 'multipart/form-data; boundary=fictional', 'text/plain'])(
		'preserves unsupported media rejection before reading: %s',
		async (contentType) => {
			const stream = streamed('/api/auth/passkey/verify-authentication', [new Uint8Array(64 * 1024 + 1)], {
				'content-type': contentType
			});
			expect((await dispatch(authPost, event(stream.current))).status).toBe(415);
			expect(stream.pull).not.toHaveBeenCalled();
			expect(stream.cancel).toHaveBeenCalledOnce();
		}
	);
	it('preserves GET and denies operator-only key management before body reads', async () => {
		const response = await dispatch(authGet, event(request('/api/auth/ok')));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		const stream = streamed('/api/auth/api-key/create', [new Uint8Array(64 * 1024 + 1)]);
		expect((await dispatch(authPost, event(stream.current))).status).toBe(403);
		expect(stream.pull).not.toHaveBeenCalled();
	});
	it('keeps activation origin and quota checks before body reads', async () => {
		const foreign = streamed('/api/activation', [new Uint8Array(1025)], {
			origin: 'https://other.example.test'
		});
		expect((await dispatch(activation, event(foreign.current))).status).toBe(403);
		expect(foreign.pull).not.toHaveBeenCalled();
		for (let i = 0; i < 10; i++) await dispatch(activation, event(request('/api/activation', '{}')));
		const limited = streamed('/api/activation', [new Uint8Array(1025)]);
		const response = await dispatch(activation, event(limited.current));
		expect(response.status).toBe(429);
		expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
		expect(limited.pull).not.toHaveBeenCalled();
	});
	it('preserves escaped activation tokens split across many chunks with no length', async () => {
		const invite = await issueInvitation(client, {
			role: 'teacher',
			name: 'Compte fictif',
			email: 'escaped@example.test'
		});
		const escaped = invite.token
			.split('')
			.map((character) => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'))
			.join('');
		const bytes = new TextEncoder().encode('{"token":"' + escaped + '"}');
		const chunks = Array.from(bytes, (byte) => new Uint8Array([byte])).flatMap((chunk) => [new Uint8Array(), chunk]);
		const stream = streamed('/api/activation', chunks);
		const response = await dispatch(activation, event(stream.current));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ name: invite.name, email: invite.email });
		expect(stream.cancel).not.toHaveBeenCalled();
	});
	it('activates at the exact limit and registers, signs in and signs out through the real relay', async () => {
		const invite = await issueInvitation(client, {
			role: 'teacher',
			name: 'Compte fictif',
			email: 'fictional@example.test'
		});
		const activationBody = JSON.stringify({ token: invite.token }).padEnd(1024);
		const activationEvent = event(request('/api/activation', activationBody, { 'content-length': '1' }));
		const prepared = await dispatch(activation, activationEvent);
		expect(prepared.status).toBe(200);
		expect(await prepared.json()).toEqual({ name: invite.name, email: invite.email });
		expect(activationEvent.cookies.set).toHaveBeenCalledWith(
			invitationCookieName,
			invite.token,
			expect.objectContaining({
				path: '/api/auth',
				httpOnly: true,
				secure: true,
				sameSite: 'strict'
			})
		);
		const authenticator = virtualPasskey(origin);
		const inviteCookie = invitationCookieName + '=' + invite.token;
		const options = await dispatch(
			authGet,
			event(request('/api/auth/passkey/generate-register-options', undefined, { cookie: inviteCookie }))
		);
		expect(options.status).toBe(200);
		const optionBody = await options.json();
		expect(optionBody).toMatchObject({
			attestation: 'none',
			authenticatorSelection: { userVerification: 'required', residentKey: 'required' }
		});
		const registration = JSON.stringify({
			response: authenticator.register(optionBody),
			createSession: true
		}).padEnd(64 * 1024);
		const registered = await dispatch(
			authPost,
			event(
				request('/api/auth/passkey/verify-registration', registration, {
					cookie: inviteCookie + ';' + cookies(options)
				})
			)
		);
		expect(registered.status, await registered.clone().text()).toBe(200);
		expect(cookies(registered)).toContain('coursely.session_token=');
		expect(
			(await client.execute("SELECT count(*) AS count FROM verification WHERE identifier LIKE 'coursely-invite:%'"))
				.rows[0].count
		).toBe(0);
		const authOptions = await dispatch(authGet, event(request('/api/auth/passkey/generate-authenticate-options')));
		const signInBody = new TextEncoder().encode(
			JSON.stringify({ response: authenticator.authenticate(await authOptions.json()) })
		);
		const signInRequest = streamed(
			'/api/auth/passkey/verify-authentication',
			[signInBody.subarray(0, 17), signInBody.subarray(17)],
			{ cookie: cookies(authOptions), 'transfer-encoding': 'chunked' }
		);
		const signedIn = await dispatch(authPost, event(signInRequest.current));
		expect(signedIn.status, await signedIn.clone().text()).toBe(200);
		const sessionCookie = cookies(signedIn);
		expect((await auth.api.getSession({ headers: new Headers({ cookie: sessionCookie }) }))?.user.role).toBe('teacher');
		const signedOut = await dispatch(authPost, event(request('/api/auth/sign-out', '{}', { cookie: sessionCookie })));
		expect(signedOut.status).toBe(200);
		expect(await auth.api.getSession({ headers: new Headers({ cookie: sessionCookie }) })).toBeNull();
	});
});
