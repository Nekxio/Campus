import { it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase } from './index.js';
import * as tables from './schema.js';

it('adds publication revisions without rebuilding or losing a previous snapshot', async () => {
	const temp = await mkdtemp(join(tmpdir(), 'campus-publication-migration-'));
	const client = createClient({ url: ':memory:' });
	try {
		await mkdir(join(temp, 'meta'));
		const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
		journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 5);
		await writeFile(join(temp, 'meta/_journal.json'), JSON.stringify(journal));
		for (const entry of journal.entries)
			await copyFile('drizzle/' + entry.tag + '.sql', join(temp, entry.tag + '.sql'));
		const db = createDatabase(client);
		await migrate(db, { migrationsFolder: temp });
		const moduleId = crypto.randomUUID(),
			contextId = crypto.randomUUID(),
			publicationId = crypto.randomUUID();
		await client.execute({
			sql: 'INSERT INTO module (id,title,preparation,created_at) VALUES (?,?,?,?)',
			args: [moduleId, 'Fictional legacy module', JSON.stringify({ framing: '', nextSteps: '', sourceLinks: [] }), 1]
		});
		await db
			.insert(tables.teachingContexts)
			.values({ id: contextId, moduleId, className: 'Archived Demo', academicYear: '2025-2026' });
		const snapshot = {
			version: 1,
			title: 'Previous title',
			description: 'Previous public text',
			resources: [],
			deadlines: [],
			recap: '',
			toDo: ''
		};
		await client.execute({
			sql: 'INSERT INTO module_publication (id,context_id,snapshot,source_revision,published_at,unpublished_at) VALUES (?,?,?,?,?,?)',
			args: [publicationId, contextId, JSON.stringify(snapshot), 3, 1000, null]
		});
		await migrate(db, { migrationsFolder: './drizzle' });
		const [saved] = await db.select().from(tables.modulePublications);
		expect(saved).toMatchObject({
			id: publicationId,
			contextId,
			snapshot,
			sourceRevision: 3,
			revision: 1,
			sourceContextRevision: 0,
			sourceClassRevision: 0,
			unpublishedAt: null
		});
		expect(saved.publishedAt.getTime()).toBe(1000);
		expect(await db.select().from(tables.publicationReceipts)).toEqual([]);
	} finally {
		client.close();
		await rm(temp, { recursive: true, force: true });
	}
});
