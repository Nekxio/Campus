import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import type { Cookies } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
vi.mock('$app/env', () => ({ building: false }));
vi.mock('./runtime.js', () => ({ withAuth: vi.fn() }));
import { withAuth } from './runtime.js';
import { handle } from '../../../hooks.server.js';

const codec = createRequire(import.meta.resolve('@sveltejs/kit/package.json'))('cookie') as {
	parseSetCookie: Cookies['parse'];
	stringifySetCookie: (cookie: ReturnType<Cookies['parse']>) => string;
};
const identity = {
	user: { id: 'fictional-teacher', role: 'teacher' },
	session: { id: 'fictional-session' }
};
function event(path = '/enseignant/classes', hasSession = true) {
	const written: string[] = [];
	return {
		locals: {},
		url: new URL('https://campus.example.test' + path),
		request: new Request('https://campus.example.test' + path),
		cookies: {
			get: () => (hasSession ? 'fictional-cookie' : undefined),
			parse: vi.fn(codec.parseSetCookie),
			set: vi.fn((name: string, value: string, options: Parameters<Cookies['set']>[2]) => {
				written.push(codec.stringifySetCookie({ name, value, ...options }));
			})
		},
		written
	};
}
function result(headers: Headers, response: unknown = identity) {
	vi.mocked(withAuth).mockResolvedValue({ headers, response });
}
async function run(current: ReturnType<typeof event>) {
	return handle({
		event: current,
		resolve: async () => new Response('Private fictional page')
	} as unknown as Parameters<Handle>[0]);
}
beforeEach(() => vi.resetAllMocks());

describe('Request-local session cookie propagation', () => {
	it.each(['/mentions-legales', '/confidentialite', '/conditions-utilisation'])(
		'keeps legal information available with a stale session at %s',
		async (path) => {
			vi.mocked(withAuth).mockRejectedValue(new Error('Fictional unavailable database'));
			const response = await run(event(path));
			expect(response.status).toBe(200);
			expect(withAuth).not.toHaveBeenCalled();
			expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
		}
	);
	it('preserves the original WebSocket upgrade response and its socket', async () => {
		const current = event('/api/quizzes/fictional/rooms/fictional', false);
		const upgrade = { status: 101, webSocket: { fictional: true } } as unknown as Response;
		const response = await handle({
			event: current,
			resolve: async () => upgrade
		} as unknown as Parameters<Handle>[0]);
		expect(response).toBe(upgrade);
	});
	it('forwards renewal and deletion cookies with all attributes and encoded values', async () => {
		const headers = new Headers();
		headers.append(
			'set-cookie',
			'__Secure-coursely.session_token=fictional%2Fvalue%2B%25; Max-Age=28800; Expires=Tue, 20 Oct 2026 20:00:00 GMT; Path=/; HttpOnly; Secure; SameSite=Strict'
		);
		headers.append(
			'set-cookie',
			'coursely.session_data=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; Secure; SameSite=Strict'
		);
		result(headers);
		const current = event();
		const response = await run(current);
		expect(current.cookies.set).toHaveBeenCalledTimes(2);
		expect(current.locals).toMatchObject({ ...identity, authUnavailable: false });
		const [renewed, deleted] = current.written.map((header) => codec.parseSetCookie(header));
		expect(renewed.value === 'fictional/value+%', 'Cookie value round trips without double encoding').toBe(true);
		expect(renewed).toMatchObject({
			name: '__Secure-coursely.session_token',
			maxAge: 28800,
			httpOnly: true,
			secure: true,
			sameSite: 'strict',
			path: '/',
			expires: new Date('2026-10-20T20:00:00Z')
		});
		expect(deleted.value === '').toBe(true);
		expect(deleted).toMatchObject({
			maxAge: 0,
			expires: new Date(0),
			httpOnly: true,
			secure: true,
			sameSite: 'strict',
			path: '/'
		});
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});
	it('keeps two independent events and null-session deletion isolated', async () => {
		const first = event(),
			second = event();
		result(
			new Headers({
				'set-cookie': 'coursely.session_token=fictional-first; Path=/; HttpOnly; SameSite=Strict'
			})
		);
		await run(first);
		result(
			new Headers({
				'set-cookie': 'coursely.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict'
			}),
			null
		);
		await run(second);
		expect(first.written.length).toBe(1);
		expect(second.written.length).toBe(1);
		expect(first.locals).toMatchObject({ ...identity, authUnavailable: false });
		expect(second.locals).toMatchObject({ user: null, session: null, authUnavailable: false });
		expect(codec.parseSetCookie(first.written[0]).value === 'fictional-first').toBe(true);
		expect(codec.parseSetCookie(second.written[0]).value === '').toBe(true);
	});
	it('requests response headers exactly once on the current request', async () => {
		const current = event();
		const getSession = vi.fn(async () => ({ headers: new Headers(), response: null }));
		vi.mocked(withAuth).mockImplementation(async (operation) =>
			operation(
				{ api: { getSession } } as unknown as Parameters<Parameters<typeof withAuth>[0]>[0],
				undefined as unknown as Parameters<Parameters<typeof withAuth>[0]>[1],
				current.url.origin
			)
		);
		await run(current);
		expect(getSession).toHaveBeenCalledExactlyOnceWith({
			headers: current.request.headers,
			returnHeaders: true
		});
		expect(current.cookies.set).not.toHaveBeenCalled();
	});
	it('retains unavailable-auth handling without emitting cookies', async () => {
		vi.mocked(withAuth).mockImplementation(async () => error(503, 'Fictional unavailable auth'));
		const current = event();
		await run(current);
		expect(current.locals).toMatchObject({ user: null, session: null, authUnavailable: true });
		expect(current.cookies.set).not.toHaveBeenCalled();
	});
	it.each(['/api/auth/get-session', '/modules/fictional', '/classes/fictional'])(
		'does not duplicate endpoint cookies or hydrate public route %s',
		async (path) => {
			const current = event(path);
			await run(current);
			expect(withAuth).not.toHaveBeenCalled();
			expect(current.cookies.set).not.toHaveBeenCalled();
		}
	);
	it('does not call auth without a session cookie', async () => {
		const current = event('/enseignant/classes', false);
		await run(current);
		expect(withAuth).not.toHaveBeenCalled();
		expect(current.cookies.set).not.toHaveBeenCalled();
	});
});
