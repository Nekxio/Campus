import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDatabase, type Database } from '../db/index.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
vi.mock('./database.js', () => ({ withTeacherDatabase: vi.fn() }));
import { withTeacherDatabase } from './database.js';
import { GET } from '../../../routes/api/teaching/modules/[moduleId]/+server.js';
import { moduleDetailSchema } from '../../domain/teaching.js';
import { getModule } from './service.js';

let client: Client;
let db: Database;
let ids: Awaited<ReturnType<typeof seedFoundationFixtures>>;
const teacher = {
	user: { id: 'teacher', role: 'teacher' },
	session: { userId: 'teacher', expiresAt: new Date(Date.now() + 60000) }
};
const event = (id: string, locals: unknown = teacher) =>
	({ params: { moduleId: id }, locals }) as Parameters<typeof GET>[0];
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedFoundationFixtures(db);
	vi.mocked(withTeacherDatabase).mockReset();
	vi.mocked(withTeacherDatabase).mockImplementation((_locals, operation) => operation(db));
});
afterEach(() => client.close());

describe('Private module recovery reads', () => {
	it.each([
		{ locals: { user: null, session: null }, status: 401 },
		{ locals: { ...teacher, user: { id: 'student', role: 'student' } }, status: 403 }
	])(
		'authorizes before validating malformed IDs or accessing storage',
		async ({ locals, status }) => {
			const response = await GET(event('not-an-id', locals));
			expect(response.status).toBe(status);
			expect(withTeacherDatabase).not.toHaveBeenCalled();
			expect(response.headers.get('cache-control')).toBe('private, no-store');
			expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
		}
	);
	it('rejects authenticated malformed IDs before DB access and missing modules with 404', async () => {
		const malformed = await GET(event('not-an-id'));
		expect(malformed.status).toBe(404);
		expect(withTeacherDatabase).not.toHaveBeenCalled();
		const missing = await GET(event(crypto.randomUUID()));
		expect(missing.status).toBe(404);
		expect(missing.headers.get('cache-control')).toBe('private, no-store');
	});
	it('reads the migrated private draft projection without roster or corrections', async () => {
		const response = await GET(event(ids.module));
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
		const projection = moduleDetailSchema.parse(await response.json());
		expect(projection).toEqual(await getModule(db, ids.module));
		expect(Object.keys(projection).sort()).toEqual([
			'contexts',
			'description',
			'id',
			'objectives',
			'preparation',
			'resources',
			'revision',
			'sourcePath',
			'title'
		]);
		expect(moduleDetailSchema.safeParse({ ...projection, students: [] }).success).toBe(false);
	});
	it('fails closed on malformed projections and keeps driver failures private', async () => {
		vi.mocked(withTeacherDatabase).mockResolvedValueOnce({ id: ids.module, title: 'Incomplete' });
		const malformed = await GET(event(ids.module));
		expect(malformed.status).toBe(503);
		vi.mocked(withTeacherDatabase).mockRejectedValueOnce(new Error('private driver detail'));
		const failed = await GET(event(ids.module));
		expect(failed.status).toBe(503);
		expect(await failed.text()).not.toContain('private driver detail');
		expect(failed.headers.get('cache-control')).toBe('private, no-store');
	});
});
