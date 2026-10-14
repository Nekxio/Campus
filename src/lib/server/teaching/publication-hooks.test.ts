import { describe, it, expect, vi } from 'vitest';
import type { Handle } from '@sveltejs/kit/hooks';
vi.mock('$app/env', () => ({ building: false }));
vi.mock('../auth/runtime.js', () => ({ withAuth: vi.fn() }));
import { withAuth } from '../auth/runtime.js';
import { handle } from '../../../hooks.server.js';

describe('Public course hook behavior', () => {
	it.each(['/modules/fictional', '/classes/fictional'])(
		'does not hydrate teacher identity for %s, including error responses',
		async (path) => {
			vi.mocked(withAuth).mockClear();
			const event = {
				locals: {},
				url: new URL('https://coursely.example' + path),
				request: new Request('https://coursely.example' + path),
				cookies: { get: () => 'fictional-session-cookie', parse: vi.fn(), set: vi.fn() }
			};
			const resolve = vi.fn(async () => new Response('Public page unavailable', { status: 404 }));
			const response = await handle({ event, resolve } as unknown as Parameters<Handle>[0]);
			expect(withAuth).not.toHaveBeenCalled();
			expect(event.cookies.parse).not.toHaveBeenCalled();
			expect(event.cookies.set).not.toHaveBeenCalled();
			expect(response.headers.getSetCookie()).toHaveLength(0);
			expect(event.locals).toEqual({ user: null, session: null, authUnavailable: false });
			expect(response.headers.get('cache-control')).toBe('no-store');
			expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
			expect(response.headers.get('referrer-policy')).toBe('no-referrer');
		}
	);
});
