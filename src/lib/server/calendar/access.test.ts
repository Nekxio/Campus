import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.mock('../teaching/database.js', () => ({ withTeacherDatabase: vi.fn() }));
vi.mock('../auth/runtime.js', () => ({ withAuth: vi.fn() }));
import { withTeacherDatabase } from '../teaching/database.js';
import { POST } from '../../../routes/api/teaching/calendar/+server.js';
import { actions } from '../../../routes/enseignant/applications/+page.server.js';
const teacher = {
	user: { id: 'teacher', role: 'teacher' },
	session: { userId: 'teacher', expiresAt: new Date(Date.now() + 60000) }
};
const event = (locals: unknown, origin = 'http://localhost', body = '{"action":"sync","manual":false}') =>
	({
		locals,
		url: new URL('http://localhost/api/teaching/calendar'),
		request: new Request('http://localhost/api/teaching/calendar', {
			method: 'POST',
			headers: { origin, 'content-type': 'application/json' },
			body
		})
	}) as Parameters<typeof POST>[0];
beforeEach(() => vi.mocked(withTeacherDatabase).mockReset());
describe('calendar teacher boundary', () => {
	it.each([
		{ locals: { user: null, session: null }, status: 401 },
		{ locals: { ...teacher, user: { id: 'student', role: 'student' } }, status: 403 }
	])('authorizes before decoding or accessing the database', async ({ locals, status }) => {
		const response = await POST(event(locals, 'http://localhost', 'not-json'));
		expect(response.status).toBe(status);
		expect(withTeacherDatabase).not.toHaveBeenCalled();
	});
	it('rejects cross-origin triggers before database or network access', async () => {
		expect((await POST(event(teacher, 'https://untrusted.example'))).status).toBe(403);
		expect(withTeacherDatabase).not.toHaveBeenCalled();
	});
	it('rejects unexpected fields before storage', async () => {
		expect(
			(await POST(event(teacher, 'http://localhost', '{"action":"sync","manual":false,"teacherId":"other"}'))).status
		).toBe(422);
		expect(withTeacherDatabase).not.toHaveBeenCalled();
	});
	it('reserves form actions for explicit synchronization and keeps the automatic JSON API', async () => {
		const data = new FormData();
		data.set('__superform_json', '[{"action":1,"manual":2},"sync",false]');
		const request = new Request('http://localhost/enseignant/applications?/calendarCommand', {
			method: 'POST',
			headers: { origin: 'http://localhost' },
			body: data
		});
		const incoming = { ...event(teacher), request, url: new URL(request.url) };
		expect(await actions.calendarCommand(incoming)).toMatchObject({ status: 422 });
		expect(withTeacherDatabase).not.toHaveBeenCalled();
		await POST(event(teacher));
		expect(withTeacherDatabase).toHaveBeenCalledOnce();
	});
	it.each(['preview', 'sync', 'evil'])(
		'never returns a private calendar subscription URL for %s action data',
		async (action) => {
			const subscriptionUrl = 'https://school.example.test/private-fixture';
			const data = new FormData();
			data.set(
				'__superform_json',
				JSON.stringify([
					action === 'sync' ? { action: 1, url: 2, manual: 3 } : { action: 1, url: 2 },
					action,
					subscriptionUrl,
					true
				])
			);
			const request = new Request('http://localhost/enseignant/applications?/calendarCommand', {
				method: 'POST',
				headers: { origin: 'http://localhost' },
				body: data
			});
			const incoming = { ...event(teacher), request, url: new URL(request.url) };
			const result = await actions.calendarCommand(incoming);
			expect(JSON.stringify(result)).not.toContain(subscriptionUrl);
			if (action !== 'preview') {
				expect(result).toMatchObject({ status: 422 });
				expect(withTeacherDatabase).not.toHaveBeenCalled();
			}
		}
	);
});
