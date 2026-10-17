import { describe, expect, it, vi } from 'vitest';
import type { Handle } from '@sveltejs/kit/hooks';
vi.mock('$app/env', () => ({ building: false }));
vi.mock('./runtime.js', () => ({ withAuth: vi.fn() }));
import { withAuth } from './runtime.js';
import { handle } from '../../../hooks.server.js';

const discoveryPaths = [
	'/.well-known/oauth-protected-resource/mcp',
	'/.well-known/oauth-authorization-server/api/auth'
];
const cases = discoveryPaths.flatMap((path) =>
	[200, 503].flatMap((status) => [false, true].map((hasSession) => ({ path, status, hasSession })))
);

function event(path: string, hasSession = false) {
	return {
		locals: {},
		url: new URL('https://coursely.example.test' + path),
		request: new Request('https://coursely.example.test' + path),
		cookies: {
			get: () => (hasSession ? 'fictional-session-cookie' : undefined),
			parse: vi.fn(),
			set: vi.fn()
		}
	};
}

describe('Public OAuth discovery cache policy', () => {
	it.each(cases)(
		'keeps $path public and uncacheable for $status (session cookie: $hasSession)',
		async ({ path, status, hasSession }) => {
			vi.mocked(withAuth).mockClear();
			const current = event(path, hasSession);
			const body =
				status === 200 ? { resource: 'fictional-public-metadata' } : { error: 'unavailable' };
			const headers = new Headers({ 'Cache-Control': 'public, max-age=3600' });
			if (status === 200) headers.set('Access-Control-Allow-Origin', '*');
			const resolve = vi.fn(async () => Response.json(body, { status, headers }));
			const response = await handle({
				event: current,
				resolve
			} as unknown as Parameters<Handle>[0]);

			expect(resolve).toHaveBeenCalledExactlyOnceWith(current);
			expect(withAuth).not.toHaveBeenCalled();
			expect(current.cookies.parse).not.toHaveBeenCalled();
			expect(current.cookies.set).not.toHaveBeenCalled();
			expect(current.locals).toEqual({ user: null, session: null, authUnavailable: false });
			expect(response.status).toBe(status);
			expect(await response.json()).toEqual(body);
			expect(response.headers.get('cache-control')).toBe('private, no-store');
			expect(response.headers.get('access-control-allow-origin')).toBe(status === 200 ? '*' : null);
			expect(response.headers.getSetCookie()).toHaveLength(0);
		}
	);

	it('preserves the cache policy of unrelated public well-known metadata', async () => {
		vi.mocked(withAuth).mockClear();
		const current = event('/.well-known/unrelated-public-metadata');
		const response = await handle({
			event: current,
			resolve: async () =>
				new Response('Public metadata', { headers: { 'Cache-Control': 'public, max-age=3600' } })
		} as unknown as Parameters<Handle>[0]);
		expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
		expect(withAuth).not.toHaveBeenCalled();
	});
});
