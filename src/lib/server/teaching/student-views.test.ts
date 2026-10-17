import { beforeEach, afterEach, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import * as tables from '../db/schema.js';
import { seedPublicationFixtures } from '../db/testing/publication-fixtures.js';
import { listPublishedClasses, getPublishedModulePath } from './student-views.js';

let client: Client;
let db: Database;
let ids: Awaited<ReturnType<typeof seedPublicationFixtures>>;
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedPublicationFixtures(db);
});
afterEach(() => client.close());

it('lists only classes with available public snapshots using a navigation allowlist', async () => {
	expect(await listPublishedClasses(db)).toEqual([
		{
			publicId: ids.currentClass,
			publicPath: '/classes/' + ids.currentClass,
			className: 'B2 Demo',
			academicYear: '2026-2027',
			moduleCount: 1
		}
	]);
	expect(await getPublishedModulePath(db, ids.module)).toBeNull();
	expect(await getPublishedModulePath(db, ids.publicationModule)).toBe(
		'/modules/' + ids.publicationContext
	);
});

it('fails closed for an unpublished or malformed snapshot', async () => {
	await db
		.update(tables.modulePublications)
		.set({ unpublishedAt: new Date() })
		.where(eq(tables.modulePublications.contextId, ids.publicationContext));
	expect(await listPublishedClasses(db)).toEqual([]);
	expect(await getPublishedModulePath(db, ids.publicationModule)).toBeNull();
	await db
		.update(tables.modulePublications)
		.set({ unpublishedAt: null, snapshot: { version: 1 } as never })
		.where(eq(tables.modulePublications.contextId, ids.publicationContext));
	expect(await listPublishedClasses(db)).toEqual([]);
	expect(await getPublishedModulePath(db, ids.publicationModule)).toBeNull();
});

it('keeps the latest private module and class identity out of navigation', async () => {
	await db
		.update(tables.modules)
		.set({ title: 'PRIVATE DRAFT', description: 'PRIVATE DESCRIPTION' })
		.where(eq(tables.modules.id, ids.publicationModule));
	await db
		.update(tables.classes)
		.set({ name: 'PRIVATE RENAMED CLASS' })
		.where(eq(tables.classes.id, ids.currentClass));
	const links = await listPublishedClasses(db);
	expect(links[0].className).toBe('B2 Demo');
	expect(JSON.stringify(links)).not.toContain('PRIVATE');
});

it('omits a paused module and its class when no public module remains', async () => {
	await db
		.update(tables.modules)
		.set({ pausedAt: new Date() })
		.where(eq(tables.modules.id, ids.publicationModule));
	expect(await listPublishedClasses(db)).toEqual([]);
	expect(await getPublishedModulePath(db, ids.publicationModule)).toBeNull();
});
