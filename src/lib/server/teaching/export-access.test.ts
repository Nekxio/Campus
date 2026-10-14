import { describe, expect, it, vi } from 'vitest';
vi.mock('./database.js', () => ({ withTeacherDatabase: vi.fn() }));
import { withTeacherDatabase } from './database.js';
import { GET } from '../../../routes/api/teaching/contexts/[contextId]/export/+server.js';
const teacher = {
	user: { id: 'teacher', role: 'teacher' },
	session: { userId: 'teacher', expiresAt: new Date(Date.now() + 60000) }
};
describe('Export access', () => {
	it.each([
		{ user: null, session: null, authUnavailable: false },
		{ ...teacher, user: { id: 'student', role: 'student' } }
	])(
		'authorizes before identity validation and private reads; errors are never cacheable',
		async (locals) => {
			vi.mocked(withTeacherDatabase).mockClear();
			const response = await GET({
				locals,
				params: { contextId: 'invalid' }
			} as Parameters<typeof GET>[0]);
			expect([401, 403]).toContain(response.status);
			expect(withTeacherDatabase).not.toHaveBeenCalled();
			expect(response.headers.get('cache-control')).toBe('private, no-store');
		}
	);
	it('keeps success and transient failures private with retryable French errors', async () => {
		vi.mocked(withTeacherDatabase).mockResolvedValueOnce({ moduleTitle: 'Demo' });
		const event = {
			locals: teacher,
			params: { contextId: crypto.randomUUID() }
		} as Parameters<typeof GET>[0];
		const response = await GET(event);
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		vi.mocked(withTeacherDatabase).mockRejectedValueOnce(new Error('private driver detail'));
		const failure = await GET(event);
		expect(failure.status).toBe(503);
		expect(await failure.text()).not.toContain('private driver detail');
		expect(failure.headers.get('cache-control')).toBe('private, no-store');
	});
});
