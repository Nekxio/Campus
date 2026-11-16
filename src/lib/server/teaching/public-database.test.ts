import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { createDatabase, createTursoClient } from '../db/index.js';
import { classes } from '../db/schema.js';
import { seedPublicationFixtures } from '../db/testing/publication-fixtures.js';
import { createServerTiming } from '../server-timing.js';

vi.mock('$app/env/private', () => ({ TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '' }));
vi.mock('../db/index.js', async (original) => ({
	...(await original<typeof import('../db/index.js')>()),
	createTursoClient: vi.fn()
}));

import { withPublicDatabase } from './public-database.js';
import { load as moduleLoad } from '../../../routes/modules/[contextId]/+page.server.js';
import { load as classLoad } from '../../../routes/classes/[classId]/+page.server.js';

let client: Client;
let readers: Client[];
let ids: Awaited<ReturnType<typeof seedPublicationFixtures>>;

beforeEach(async () => {
	const directory = await mkdtemp(join(tmpdir(), 'campus-public-readers-'));
	const url = pathToFileURL(join(directory, 'fictional.db')).href;
	client = createClient({ url });
	await client.execute('PRAGMA journal_mode = WAL');
	const db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedPublicationFixtures(db);
	readers = [];
	vi.mocked(createTursoClient).mockImplementation(() => {
		const reader = createClient({ url });
		readers.push(reader);
		return reader;
	});
});

afterEach(() => {
	for (const reader of readers) reader.close();
	client.close();
	vi.restoreAllMocks();
});

const readClassName = (db: Pick<ReturnType<typeof createDatabase>, 'select'>) =>
	db.select({ name: classes.name }).from(classes).where(eq(classes.id, ids.currentClass));

describe('Public read transactions', () => {
	it.each([
		{ name: 'module', load: moduleLoad },
		{ name: 'class directory', load: classLoad }
	])('loads the $name while another public reader holds its snapshot', async ({ load }) => {
		await withPublicDatabase((db) =>
			db.transaction(async (tx) => {
				await readClassName(tx);
				const request = {
					params: { contextId: ids.publicationContext, classId: ids.currentClass },
					locals: {},
					setHeaders: vi.fn()
				} as unknown as Parameters<typeof moduleLoad>[0] & Parameters<typeof classLoad>[0];
				const result = await load(request);
				expect(result).toMatchObject(
					load === moduleLoad ? { contextId: ids.publicationContext } : { classId: ids.currentClass }
				);
			})
		);
		expect(readers).toHaveLength(2);
		expect(readers.every((reader) => reader.closed)).toBe(true);
	});

	it('keeps a consistent snapshot across a concurrent committed update', async () => {
		await withPublicDatabase((db) =>
			db.transaction(async (tx) => {
				const before = await readClassName(tx);
				await createDatabase(client)
					.update(classes)
					.set({ name: 'Updated fictional class' })
					.where(eq(classes.id, ids.currentClass));
				expect(await readClassName(tx)).toEqual(before);
			})
		);
		expect(await withPublicDatabase(readClassName)).toEqual([{ name: 'Updated fictional class' }]);
	});

	it('preserves HTTP errors and closes a failed reader before the next request', async () => {
		await expect(
			withPublicDatabase((db) => db.transaction(async () => error(404, 'Fictional unavailable page')))
		).rejects.toMatchObject({ status: 404 });
		expect(readers[0].closed).toBe(true);
		expect(await withPublicDatabase((db) => db.transaction(readClassName))).toHaveLength(1);
	});

	it('maps unexpected failures to 503 and keeps database timing enabled', async () => {
		const timing = createServerTiming();
		await expect(
			withPublicDatabase(
				(db) =>
					db.transaction(async () => {
						throw new Error('Fictional database failure');
					}),
				timing
			)
		).rejects.toMatchObject({ status: 503 });
		expect(readers[0].closed).toBe(true);
		expect(timing.header()).toMatch(/db;dur=[\d.]+;desc="2 calls"/);
	});
});
