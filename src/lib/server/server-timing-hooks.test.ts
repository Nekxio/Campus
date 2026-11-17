import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
vi.mock('$app/env', () => ({ building: false }));
vi.mock('./auth/runtime.js', () => ({ withAuth: vi.fn() }));
import { withAuth } from './auth/runtime.js';
import { handle } from '../../hooks.server.js';

let elapsed = 0;
const request = (pathname: string, method = 'GET') => ({
	locals: {} as App.Locals,
	url: new URL('https://fixture.invalid' + pathname),
	request: new Request('https://fixture.invalid' + pathname, { method }),
	cookies: { get: () => undefined as string | undefined, parse: vi.fn(), set: vi.fn() }
});
const run = (event: ReturnType<typeof request>, resolve: () => Promise<Response>) =>
	handle({ event, resolve } as unknown as Parameters<Handle>[0]);

beforeEach(() => {
	vi.resetAllMocks();
	elapsed = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
});
afterEach(() => vi.restoreAllMocks());

describe('Navigation response timings', () => {
	it('appends authentication and data timings while preserving response headers and cookies', async () => {
		const event = request('/enseignant/vue-etudiante/__data.json');
		event.cookies.get = () => 'fictional-session';
		vi.mocked(withAuth).mockImplementation(async () => {
			elapsed += 12;
			return { response: null, headers: new Headers() } as never;
		});
		const response = await run(event, async () => {
			await event.locals.serverTiming!.measure('data', async () => {
				elapsed += 20;
			});
			elapsed += 2;
			return new Response('unchanged content', {
				headers: { 'Server-Timing': 'upstream;dur=3', 'X-Fixture': 'retained', 'Set-Cookie': 'fixture=value' }
			});
		});
		expect(await response.text()).toBe('unchanged content');
		expect(response.headers.get('server-timing')).toBe(
			'upstream;dur=3, app;dur=34.0, auth;dur=12.0, data;dur=20.0, resolve;dur=22.0'
		);
		expect(response.headers.get('x-fixture')).toBe('retained');
		expect(response.headers.getSetCookie()).toEqual(['fixture=value']);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});

	it.each(['/classes/fictional', '/modules/fictional/__data.json'])('keeps %s public and uncached', async (path) => {
		const event = request(path);
		event.cookies.get = () => 'fictional-teacher-session';
		const response = await run(event, async () => {
			elapsed += 8;
			return new Response('public');
		});
		expect(withAuth).not.toHaveBeenCalled();
		expect(response.headers.get('server-timing')).toBe('app;dur=8.0, resolve;dur=8.0');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
	});

	it('retains authentication failures and error response status without exposing private details', async () => {
		const event = request('/enseignant');
		event.cookies.get = () => 'fictional-teacher-session';
		vi.mocked(withAuth).mockImplementation(async () => {
			elapsed += 6;
			error(503, 'PRIVATE');
		});
		const response = await run(event, async () => new Response('Unavailable', { status: 503 }));
		expect(event.locals.authUnavailable).toBe(true);
		expect(response.status).toBe(503);
		expect(response.headers.get('server-timing')).toBe('app;dur=6.0, auth;dur=6.0, resolve;dur=0.0');
	});

	it('preserves redirects and does not clone runtime-owned WebSocket upgrades', async () => {
		const redirect = await run(
			request('/enseignant'),
			async () => new Response(null, { status: 307, headers: { Location: '/connexion' } })
		);
		expect(redirect.status).toBe(307);
		expect(redirect.headers.get('location')).toBe('/connexion');
		expect(redirect.headers.has('server-timing')).toBe(true);
		const upgrade = { status: 101 } as Response;
		expect(await run(request('/api/quiz/socket'), async () => upgrade)).toBe(upgrade);
	});

	it.each([
		['/enseignant', 'POST'],
		['/api/quiz', 'GET'],
		['/legal', 'GET']
	])('leaves %s %s outside navigation timing scope', async (path, method) => {
		const event = request(path, method);
		const response = await run(event, async () => new Response('fixture'));
		expect(response.headers.has('server-timing')).toBe(false);
		expect(event.locals.serverTiming).toBeUndefined();
	});
});
