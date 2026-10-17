import { it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase } from './index.js';
import * as tables from './schema.js';

it('upgrades the previous schema while retaining a legacy proposal and defaulting new decision fields', async () => {
	const temp = await mkdtemp(join(tmpdir(), 'coursely-migration-'));
	const client = createClient({ url: ':memory:' });
	try {
		await mkdir(join(temp, 'meta'));
		const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8'));
		journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 4);
		await writeFile(join(temp, 'meta/_journal.json'), JSON.stringify(journal));
		for (const entry of journal.entries)
			await copyFile('drizzle/' + entry.tag + '.sql', join(temp, entry.tag + '.sql'));
		const db = createDatabase(client);
		await migrate(db, { migrationsFolder: temp });
		const moduleId = crypto.randomUUID(),
			classId = crypto.randomUUID(),
			studentId = crypto.randomUUID(),
			contextId = crypto.randomUUID(),
			proposalId = crypto.randomUUID();
		await client.execute({
			sql: 'INSERT INTO module (id,title,preparation,created_at) VALUES (?,?,?,?)',
			args: [
				moduleId,
				'Fictional migration',
				JSON.stringify({ framing: '', nextSteps: '', sourceLinks: [] }),
				1
			]
		});
		await db
			.insert(tables.classes)
			.values({ id: classId, name: 'Demo', academicYear: '2026-2027' });
		await db.insert(tables.students).values({ id: studentId, classId, name: 'Student Demo' });
		await db
			.insert(tables.teachingContexts)
			.values({ id: contextId, moduleId, classId, className: 'Demo', academicYear: '2026-2027' });
		const legacy = {
			version: 1,
			contextId,
			studentId,
			assessmentId: crypto.randomUUID(),
			rubricRevision: 1,
			correctionRevision: 1,
			scores: [{ lineId: crypto.randomUUID(), points: 3 }]
		};
		await client.execute({
			sql: 'INSERT INTO correction_proposal (id,context_id,student_id,payload,state,created_at) VALUES (?,?,?,?,?,?)',
			args: [proposalId, contextId, studentId, JSON.stringify(legacy), 'pending', 1]
		});
		await migrate(db, { migrationsFolder: './drizzle' });
		const [saved] = await db.select().from(tables.correctionProposals);
		expect(saved).toMatchObject({
			id: proposalId,
			payload: legacy,
			state: 'pending',
			revision: 1,
			commentState: 'none',
			teacherId: null,
			receipt: null
		});
		expect(await db.select().from(tables.proposalDecisions)).toEqual([]);
	} finally {
		client.close();
		await rm(temp, { recursive: true, force: true });
	}
});
