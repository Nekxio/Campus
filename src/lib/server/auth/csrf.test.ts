import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Handle } from '@sveltejs/kit/hooks';
import { rejectCrossOriginForm } from './csrf.js';
vi.mock('$app/env', () => ({ building: false }));
vi.mock('./runtime.js', () => ({ withAuth: vi.fn() }));
import { withAuth } from './runtime.js';
import { handle } from '../../../hooks.server.js';
const origin = 'https://campus.example.test';
const native = ['/api/auth/oauth2/token', '/api/auth/oauth2/revoke', '/api/auth/oauth2/introspect'];
function request(path: string, headers: HeadersInit = {}, method = 'POST') {
	const url = new URL(path, origin);
	return [new Request(url, { method, headers }), url] as const;
}
describe('Form origin boundary with native OAuth exception', () => {
	it('normalizes a validated opaque navigation only for the internal session read', async () => {
		const getSession = vi.fn<
			(input: { headers: Headers; returnHeaders: boolean }) => Promise<{ response: null; headers: Headers }>
		>(async () => ({
			response: null,
			headers: new Headers()
		}));
		vi.mocked(withAuth).mockImplementation(async (operation) =>
			operation({ api: { getSession } } as never, {} as never, origin)
		);
		const [incoming, url] = request('/enseignant/compte?/updateProfile', {
			origin: 'null',
			'content-type': 'multipart/form-data; boundary=fictional',
			'sec-fetch-site': 'same-origin',
			'sec-fetch-mode': 'navigate',
			'sec-fetch-dest': 'document',
			cookie: 'coursely.session_token=fictional'
		});
		await handle({
			event: { request: incoming, url, cookies: { get: () => 'fictional' }, locals: {} },
			resolve: async () => new Response()
		} as unknown as Parameters<Handle>[0]);
		expect(getSession).toHaveBeenCalledOnce();
		expect(getSession.mock.calls[0]?.[0]).toMatchObject({ returnHeaders: true });
		expect((getSession.mock.calls[0]?.[0] as unknown as { headers: Headers }).headers.get('origin')).toBe(origin);
		expect(incoming.headers.get('origin')).toBe('null');
	});
	it('allows opaque native navigation only on the three progressively enhanced pages', () => {
		const headers = {
			'content-type': 'multipart/form-data; boundary=fictional',
			origin: 'null',
			'sec-fetch-site': 'same-origin',
			'sec-fetch-mode': 'navigate',
			'sec-fetch-dest': 'document'
		};
		for (const path of ['/enseignant/compte', '/autoriser', '/enseignant/applications']) {
			expect(rejectCrossOriginForm(...request(path, headers))).toBeUndefined();
			for (const [key, value] of Object.entries({
				origin: '',
				'sec-fetch-site': 'cross-site',
				'sec-fetch-mode': 'cors',
				'sec-fetch-dest': ''
			}))
				expect(rejectCrossOriginForm(...request(path, { ...headers, [key]: value }))).toHaveProperty('status', 403);
		}
		for (const path of ['/enseignant/classes', '/enseignant/compte/', '/api/enseignant/compte'])
			expect(rejectCrossOriginForm(...request(path, headers))).toHaveProperty('status', 403);
	});
	it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
		'preserves the framework boundary for %s form mutations',
		async (method) => {
			for (const type of [
				'',
				'application/x-www-form-urlencoded',
				'multipart/form-data; boundary=fictional',
				'text/plain',
				'application/x-sveltekit-formdata',
				' Application/X-WWW-Form-Urlencoded; charset=UTF-8 '
			]) {
				for (const path of [
					'/connexion',
					'/api/mcp/consent',
					'/api/teaching/classes',
					'/enseignant/classes',
					'/unrecognized-route'
				]) {
					for (const claimed of [undefined, 'null', 'https://foreign.example.test']) {
						const headers: Record<string, string> = {};
						if (type) headers['content-type'] = type;
						if (claimed) headers.origin = claimed;
						const denied = rejectCrossOriginForm(...request(path, headers, method));
						expect(denied?.status).toBe(403);
						expect(denied?.headers.get('cache-control')).toBe('private, no-store');
						expect(await denied?.json()).toEqual({
							message: `Cross-site ${method} form submissions are forbidden`
						});
						expect(rejectCrossOriginForm(...request(path, { ...headers, origin }, method))).toBeUndefined();
					}
				}
			}
		}
	);
	it.each(native)('admits only cookie-free native URL-encoded POST to %s', (path) => {
		const type = { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' };
		expect(rejectCrossOriginForm(...request(path, type))).toBeUndefined();
		const suspiciousHeaders: Record<string, string>[] = [
			{ origin: 'null' },
			{ origin: 'https://foreign.example.test' },
			{ cookie: 'fictional=session' },
			{ cookie: '' },
			{ 'sec-fetch-site': 'cross-site' },
			{ 'sec-fetch-site': 'none' },
			{ 'sec-fetch-mode': 'navigate' },
			{ 'sec-fetch-dest': '' }
		];
		for (const headers of suspiciousHeaders) {
			expect(rejectCrossOriginForm(...request(path, { ...type, ...headers }))).toHaveProperty('status', 403);
		}
		for (const method of ['PUT', 'PATCH', 'DELETE'])
			expect(rejectCrossOriginForm(...request(path, type, method))).toHaveProperty('status', 403);
		for (const contentType of [undefined, 'multipart/form-data', 'text/plain', 'application/x-sveltekit-formdata']) {
			expect(
				rejectCrossOriginForm(...request(path, contentType ? { 'content-type': contentType } : {}))
			).toHaveProperty('status', 403);
		}
	});
	it.each(native)('accepts Node Fetch metadata without browser credentials or context on %s', (path) => {
		const headers = {
			'content-type': 'application/x-www-form-urlencoded',
			'sec-fetch-mode': 'cors'
		};
		expect(rejectCrossOriginForm(...request(path, headers))).toBeUndefined();
		const forbiddenContexts: Record<string, string>[] = [
			{ origin: '' },
			{ origin: 'null' },
			{ origin: 'https://foreign.example.test' },
			{ cookie: '' },
			{ cookie: 'fictional=session' },
			{ 'sec-fetch-site': '' },
			{ 'sec-fetch-site': 'none' },
			{ 'sec-fetch-site': 'same-origin' },
			{ 'sec-fetch-site': 'cross-site' },
			{ 'sec-fetch-dest': '' },
			{ 'sec-fetch-dest': 'empty' },
			{ 'sec-fetch-dest': 'document' }
		];
		for (const forbidden of forbiddenContexts)
			expect(rejectCrossOriginForm(...request(path, { ...headers, ...forbidden }))).toHaveProperty('status', 403);
		for (const mode of ['', 'no-cors', 'navigate', 'same-origin', 'websocket', 'CORS', 'cors, cors'])
			expect(rejectCrossOriginForm(...request(path, { ...headers, 'sec-fetch-mode': mode }))).toHaveProperty(
				'status',
				403
			);
		for (const method of ['PUT', 'PATCH', 'DELETE'])
			expect(rejectCrossOriginForm(...request(path, headers, method))).toHaveProperty('status', 403);
	});
	it.each(native)('passes cookie-free Node Fetch forms to the OAuth route on %s', async (path) => {
		vi.mocked(withAuth).mockClear();
		const [incoming, url] = request(path, {
			'content-type': 'application/x-www-form-urlencoded',
			'sec-fetch-mode': 'cors'
		});
		const resolve = vi.fn(async () => new Response(null, { status: 503 }));
		const response = await handle({
			event: { request: incoming, url, cookies: { get: () => undefined }, locals: {} },
			resolve
		} as unknown as Parameters<Handle>[0]);
		expect(response.status).toBe(503);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(resolve).toHaveBeenCalledOnce();
		expect(withAuth).not.toHaveBeenCalled();
	});
	it('does not widen the exception to lookalike paths or client registration forms', () => {
		const metadataVariants: Record<string, string>[] = [{}, { 'sec-fetch-mode': 'cors' }];
		for (const path of [
			'/api/auth/oauth2/token/',
			'/api/auth/oauth2/token-extra',
			'/api/auth/oauth2/register',
			'/api/auth/sign-out',
			'/api/mcp/consent'
		])
			for (const metadata of metadataVariants)
				expect(
					rejectCrossOriginForm(...request(path, { 'content-type': 'application/x-www-form-urlencoded', ...metadata }))
				).toHaveProperty('status', 403);
		expect(
			rejectCrossOriginForm(...request('/api/auth/oauth2/register', { 'content-type': 'application/json' }))
		).toBeUndefined();
		expect(rejectCrossOriginForm(...request('/connexion', {}, 'GET'))).toBeUndefined();
	});
	it('rejects before session reads or route resolution and is paired with the Kit override', async () => {
		vi.mocked(withAuth).mockClear();
		const [incoming, url] = request('/enseignant/classes', {
			'content-type': 'text/plain',
			cookie: 'coursely.session_token=fictional'
		});
		const get = vi.fn();
		const resolve = vi.fn();
		const response = await handle({
			event: { request: incoming, url, cookies: { get }, locals: {} },
			resolve
		} as unknown as Parameters<Handle>[0]);
		expect(response.status).toBe(403);
		expect(get).not.toHaveBeenCalled();
		expect(withAuth).not.toHaveBeenCalled();
		expect(resolve).not.toHaveBeenCalled();
		expect(readFileSync('vite.config.ts', 'utf8')).toContain("csrf: { trustedOrigins: ['*'] }");
	});
});
