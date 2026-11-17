import { describe, it, expect, vi } from 'vitest';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import type { RequestEvent } from '@sveltejs/kit';
vi.mock('$app/env', () => ({ building: false }));
vi.mock('../auth/runtime.js', () => ({ withAuth: vi.fn() }));
import { withAuth } from '../auth/runtime.js';
import { handle, handleError } from '../../../hooks.server.js';

const id = '00000000-0000-4000-8000-000000000001';
function event(path: string) {
	return {
		locals: { publicClassId: id } as App.Locals,
		url: new URL('https://campus.example' + path),
		request: new Request('https://campus.example' + path),
		cookies: { get: () => 'fictional-session-cookie', parse: vi.fn(), set: vi.fn() }
	};
}
function caught(input: Pick<Parameters<HandleServerError>[0], 'kind' | 'error'>, request = event('/modules/' + id)) {
	return handleError({
		...input,
		event: request as unknown as RequestEvent
	} as Parameters<HandleServerError>[0]);
}
describe('Public course hook behavior', () => {
	it.each([
		'/modules/fictional',
		'/classes/fictional',
		'/modules/fictional/__data.json',
		'/classes/fictional/__data.json'
	])('does not hydrate teacher identity for %s, including error responses', async (path) => {
		vi.mocked(withAuth).mockClear();
		const request = event(path);
		const resolve = vi.fn(async () => new Response('Public page unavailable', { status: 404 }));
		const response = await handle({ event: request, resolve } as unknown as Parameters<Handle>[0]);
		expect(withAuth).not.toHaveBeenCalled();
		expect(request.cookies.parse).not.toHaveBeenCalled();
		expect(request.cookies.set).not.toHaveBeenCalled();
		expect(response.status).toBe(404);
		expect(response.headers.getSetCookie()).toHaveLength(0);
		expect(request.locals).toEqual({
			user: null,
			session: null,
			authUnavailable: false,
			publicClassId: null,
			serverTiming: expect.objectContaining({ measure: expect.any(Function) })
		});
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
		expect(response.headers.get('referrer-policy')).toBe('no-referrer');
	});
	it('does not add public recovery state to unrelated requests', async () => {
		for (const path of ['/connexion', '/.well-known/oauth-authorization-server/api/auth']) {
			const request = event(path);
			delete request.locals.publicClassId;
			request.cookies.get = () => '';
			await handle({
				event: request,
				resolve: async () => new Response('Private or discovery fixture')
			} as unknown as Parameters<Handle>[0]);
			expect(request.locals).toEqual({ user: null, session: null, authUnavailable: false });
		}
	});
	it.each([
		{ kind: 'app', error: { status: 404, message: 'PRIVATE', publicClassId: id } },
		{ kind: 'app', error: { status: 503, message: 'PRIVATE' } },
		{ kind: 'framework', error: { status: 404, message: 'PRIVATE' } },
		{ kind: 'validation', error: { status: 400, message: 'PRIVATE' } },
		{ kind: 'unknown', error: { status: 418, message: 'PRIVATE', publicClassId: id } }
	] as const)('returns a synchronous, allowlisted public error for $kind/$error.status', (input) => {
		const request = event('/modules/' + id);
		request.locals.publicClassId = null;
		const result = caught(input, request);
		expect(result).not.toBeInstanceOf(Promise);
		expect(result).toEqual({
			status: input.kind === 'unknown' ? 500 : input.error.status,
			message: 'Cette page de cours n’est pas disponible.',
			publicClassId: null
		});
	});
	it('reads only acquired Locals evidence, never exception properties or request hints', () => {
		const input = { kind: 'unknown', error: new Error('PRIVATE') } as const;
		const request = event('/modules/' + id + '?classId=' + id + '#B3');
		expect(caught(input, request)).toMatchObject({ status: 500, publicClassId: id });
		request.locals.publicClassId = null;
		expect(caught(input, request)).toMatchObject({ publicClassId: null });
		const hostile = Object.defineProperties(
			{},
			{
				status: {
					get() {
						throw new Error('Untrusted status');
					}
				},
				publicClassId: {
					get() {
						throw new Error('Untrusted proof');
					}
				}
			}
		);
		expect(() => caught({ kind: 'unknown', error: hostile }, request)).not.toThrow();
	});
	it('does not send an unavailable directory back to itself or change nonpublic errors', () => {
		const input = { kind: 'unknown', error: new Error('PRIVATE') } as const;
		expect(caught(input, event('/classes/' + id))).toMatchObject({ publicClassId: null });
		for (const path of ['/', '/enseignant/modules/' + id, '/modules-private', '/classes-private'])
			expect(caught(input, event(path))).toBeUndefined();
	});
	it('keeps evidence request-local when public requests overlap', async () => {
		const first = event('/modules/' + id),
			second = event('/modules/missing');
		let release!: () => void;
		const pending = new Promise<void>((done) => {
			release = done;
		});
		const one = handle({
			event: first,
			resolve: async () => {
				expect(first.locals.publicClassId).toBeNull();
				first.locals.publicClassId = id;
				await pending;
				return new Response('first', { status: 500 });
			}
		} as unknown as Parameters<Handle>[0]);
		const two = handle({
			event: second,
			resolve: async () => {
				expect(second.locals.publicClassId).toBeNull();
				expect(caught({ kind: 'unknown', error: null }, second)).toMatchObject({
					publicClassId: null
				});
				release();
				return new Response('second', { status: 503 });
			}
		} as unknown as Parameters<Handle>[0]);
		expect((await Promise.all([one, two])).map((response) => response.status)).toEqual([500, 503]);
		expect(first.locals.publicClassId).toBe(id);
		expect(second.locals.publicClassId).toBeNull();
	});
});
