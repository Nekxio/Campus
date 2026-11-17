import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
vi.mock('./database.js', () => ({ withTeacherDatabase: vi.fn() }));
import { withTeacherDatabase } from './database.js';
import { teachingEndpoint, readTeachingJson } from './http.js';
function event(request: Request, authenticated = true): RequestEvent {
	return {
		request,
		url: new URL(request.url),
		params: {},
		locals: authenticated
			? {
					user: { id: 'teacher', role: 'teacher' },
					session: { userId: 'teacher', expiresAt: new Date(Date.now() + 60000) }
				}
			: { user: null, session: null }
	} as unknown as RequestEvent;
}
const endpoint = teachingEndpoint(z.strictObject({ title: z.string().min(1) }), async () => ({
	saved: true
}));
const request = (body: string, origin = 'https://campus.example') =>
	new Request('https://campus.example/api/teaching/modules', {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin },
		body
	});
describe('Private teaching writes', () => {
	it('refuses anonymous access before decoding input or connecting a database', async () => {
		vi.mocked(withTeacherDatabase).mockClear();
		expect((await endpoint(event(request('not json'), false))).status).toBe(401);
		expect(withTeacherDatabase).not.toHaveBeenCalled();
	});
	it('refuses cross-origin or missing-origin writes before connecting', async () => {
		vi.mocked(withTeacherDatabase).mockClear();
		expect((await endpoint(event(request('{"title":"x"}', 'https://other.example')))).status).toBe(403);
		expect((await endpoint(event(request('{"title":"x"}', '')))).status).toBe(403);
		expect(withTeacherDatabase).not.toHaveBeenCalled();
	});
	it('reports malformed JSON and strict-schema violations without DB access', async () => {
		vi.mocked(withTeacherDatabase).mockClear();
		expect((await endpoint(event(request('{')))).status).toBe(400);
		const response = await endpoint(event(request('{"title":"","role":"teacher"}')));
		expect(response.status).toBe(422);
		expect(await response.json()).toHaveProperty('fields.title');
		expect(withTeacherDatabase).not.toHaveBeenCalled();
	});
	it('limits streamed bodies even when content length is absent', async () => {
		await expect(readTeachingJson(request('a'.repeat(256001)))).rejects.toMatchObject({
			status: 413
		});
	});
});
