import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./database.js', () => ({ withTeacherDatabase: vi.fn() }));
import { withTeacherDatabase } from './database.js';
import { GET } from '../../../routes/api/teaching/years/[academicYear]/contexts/[contextId]/+server.js';
import { POST } from '../../../routes/api/teaching/years/[academicYear]/+server.js';
const teacher = {
	user: { id: 'teacher', role: 'teacher' },
	session: { userId: 'teacher', expiresAt: new Date(Date.now() + 60000) }
};
beforeEach(() => vi.mocked(withTeacherDatabase).mockReset());
function mutation(locals: unknown, origin = 'https://coursely.example', body = 'not json') {
	return {
		locals,
		params: { academicYear: '2025-2026' },
		url: new URL('https://coursely.example/api/teaching/years/2025-2026'),
		request: new Request('https://coursely.example/api/teaching/years/2025-2026', {
			method: 'POST',
			headers: { origin, 'content-type': 'application/json' },
			body
		})
	} as Parameters<typeof POST>[0];
}
describe('Annual routes', () => {
	it.each([
		{ user: null, session: null },
		{ ...teacher, user: { id: 'student', role: 'student' } }
	])(
		'authorizes history and purge before parsing identities, body or private reads',
		async (locals) => {
			const history = await GET({
				locals,
				params: { academicYear: 'invalid', contextId: 'invalid' }
			} as Parameters<typeof GET>[0]);
			expect([401, 403]).toContain(history.status);
			const purge = await POST(mutation(locals));
			expect([401, 403]).toContain(purge.status);
			expect(withTeacherDatabase).not.toHaveBeenCalled();
			for (const response of [history, purge])
				expect(response.headers.get('cache-control')).toBe('private, no-store');
		}
	);
	it('rejects cross-origin writes and incomplete purge confirmations before DB access', async () => {
		expect((await POST(mutation(teacher, 'https://other.example'))).status).toBe(403);
		expect((await POST(mutation(teacher, ''))).status).toBe(403);
		const bad = {
			academicYear: '2025-2026',
			action: 'purge',
			requestId: crypto.randomUUID(),
			reviewToken: 'a'.repeat(64),
			typedYear: '2025-2026',
			pdfsKept: false
		};
		const response = await POST(mutation(teacher, undefined, JSON.stringify(bad)));
		expect(response.status).toBe(422);
		expect(await response.json()).toHaveProperty('fields.pdfsKept');
		expect(withTeacherDatabase).not.toHaveBeenCalled();
	});
	it('makes failures private and hides driver details', async () => {
		vi.mocked(withTeacherDatabase).mockRejectedValueOnce(new Error('private driver'));
		const response = await GET({
			locals: teacher,
			params: { academicYear: '2025-2026', contextId: crypto.randomUUID() }
		} as Parameters<typeof GET>[0]);
		expect(response.status).toBe(503);
		expect(await response.text()).not.toContain('private driver');
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});
});
