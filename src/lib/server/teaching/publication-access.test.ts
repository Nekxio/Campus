import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
vi.mock('./database.js', () => ({ withTeacherDatabase: vi.fn() }));
vi.mock('./public-database.js', () => ({ withPublicDatabase: vi.fn() }));
import { withTeacherDatabase } from './database.js';
import { withPublicDatabase } from './public-database.js';
import { POST } from '../../../routes/api/teaching/modules/[moduleId]/publication/+server.js';
import { load as moduleLoad } from '../../../routes/modules/[contextId]/+page.server.js';
import { load as classLoad } from '../../../routes/classes/[classId]/+page.server.js';
import { load as reviewLoad } from '../../../routes/enseignant/modules/[moduleId]/publication/+page.server.js';

const id = '00000000-0000-4000-8000-000000000001';
const origin = 'https://coursely.example';
function event(authenticated = false, requestOrigin = origin, body = 'invalid json'): RequestEvent {
	return {
		request: new Request(origin + '/api/teaching/modules/' + id + '/publication', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: requestOrigin,
				Authorization: 'Bearer fictional-agent-key'
			},
			body
		}),
		url: new URL(origin),
		params: { moduleId: id, contextId: id, classId: id },
		setHeaders: vi.fn(),
		locals: authenticated
			? {
					user: { id: 'teacher', role: 'teacher' },
					session: { userId: 'teacher', expiresAt: new Date(Date.now() + 60000) },
					authUnavailable: false
				}
			: { user: null, session: null, authUnavailable: false }
	} as unknown as RequestEvent;
}
beforeEach(() => vi.clearAllMocks());
describe('Publication route boundaries', () => {
	it('refuses anonymous and agent-key decisions before input decoding or DB access', async () => {
		expect((await POST(event())).status).toBe(401);
		expect(withTeacherDatabase).not.toHaveBeenCalled();
		expect(withPublicDatabase).not.toHaveBeenCalled();
	});
	it('refuses cross-origin and missing-origin decisions before database access', async () => {
		expect((await POST(event(true, 'https://other.example'))).status).toBe(403);
		expect((await POST(event(true, ''))).status).toBe(403);
		expect(withTeacherDatabase).not.toHaveBeenCalled();
	});
	it('requires explicit confirmation and refuses a submitted snapshot without a DB call', async () => {
		const body = {
			requestId: id,
			contextId: id,
			action: 'publish',
			expectedRevision: 0,
			moduleRevision: 1,
			contextRevision: 1,
			classRevision: 1,
			confirm: false,
			snapshot: { private: true }
		};
		const response = await POST(event(true, origin, JSON.stringify(body)));
		expect(response.status).toBe(422);
		expect(await response.json()).toHaveProperty('fields.confirm');
		expect(withTeacherDatabase).not.toHaveBeenCalled();
	});
	it('keeps the verification screen private even for a public module link', async () => {
		await expect(
			Promise.resolve().then(() =>
				reviewLoad(event() as unknown as Parameters<typeof reviewLoad>[0])
			)
		).rejects.toMatchObject({ status: 303, location: '/connexion' });
		expect(withTeacherDatabase).not.toHaveBeenCalled();
	});
	it('loads both public routes without any teacher-session access and marks them uncached', async () => {
		vi.mocked(withPublicDatabase).mockResolvedValue({ publicOnly: true });
		const moduleEvent = event();
		const classEvent = event();
		expect(await moduleLoad(moduleEvent as unknown as Parameters<typeof moduleLoad>[0])).toEqual({
			publicOnly: true
		});
		expect(await classLoad(classEvent as unknown as Parameters<typeof classLoad>[0])).toEqual({
			publicOnly: true
		});
		expect(moduleEvent.setHeaders).toHaveBeenCalledWith({
			'Cache-Control': 'no-store',
			'X-Robots-Tag': 'noindex, nofollow'
		});
		expect(classEvent.setHeaders).toHaveBeenCalledWith({
			'Cache-Control': 'no-store',
			'X-Robots-Tag': 'noindex, nofollow'
		});
		expect(withTeacherDatabase).not.toHaveBeenCalled();
	});
	it('rejects malformed public identities before creating a database connection', async () => {
		const request = event();
		request.params.contextId = 'not-an-id';
		await expect(
			Promise.resolve().then(() =>
				moduleLoad(request as unknown as Parameters<typeof moduleLoad>[0])
			)
		).rejects.toMatchObject({ status: 404 });
		expect(withPublicDatabase).not.toHaveBeenCalled();
	});
});
