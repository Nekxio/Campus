import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

vi.mock('../auth/runtime.js', () => ({ withAuth: vi.fn(), withPrivateClient: vi.fn() }));
vi.mock('../db/index.js', () => ({ createDatabase: vi.fn() }));
import { withAuth, withPrivateClient } from '../auth/runtime.js';
import { createDatabase } from '../db/index.js';
import { withTeacherDatabase } from './database.js';

const teacher = {
	user: { id: 'fictional-teacher', role: 'teacher' },
	session: { userId: 'fictional-teacher', expiresAt: new Date(Date.now() + 60000) }
} as Parameters<typeof withTeacherDatabase>[0];

beforeEach(() => vi.resetAllMocks());

describe('Request-local teacher database access', () => {
	it('uses the configured client without rebuilding authentication or its OAuth registry', async () => {
		const client = {} as Parameters<typeof createDatabase>[0];
		const database = {} as ReturnType<typeof createDatabase>;
		vi.mocked(createDatabase).mockReturnValue(database);
		vi.mocked(withPrivateClient).mockImplementation(async (operation) => operation(client, 'https://fixture.invalid'));
		const operation = vi.fn(async () => ({ ready: true }));
		expect(await withTeacherDatabase(teacher, operation)).toEqual({ ready: true });
		expect(operation).toHaveBeenCalledExactlyOnceWith(database);
		expect(withPrivateClient).toHaveBeenCalledTimes(1);
		expect(withAuth).not.toHaveBeenCalled();
	});
	it.each([
		{ user: null, session: null },
		{ ...teacher, session: { ...teacher.session, expiresAt: new Date(0) } },
		{ ...teacher, session: { ...teacher.session, userId: 'another-fictional-user' } }
	])('rejects invalid identities before connecting', async (locals) => {
		expect(() => withTeacherDatabase(locals as typeof teacher, vi.fn())).toThrow();
		expect(withPrivateClient).not.toHaveBeenCalled();
		expect(withAuth).not.toHaveBeenCalled();
	});
	it('retains unavailable database errors', async () => {
		vi.mocked(withPrivateClient).mockImplementation(async () => error(503, 'Fixture unavailable'));
		await expect(withTeacherDatabase(teacher, vi.fn())).rejects.toMatchObject({ status: 503 });
	});
});
