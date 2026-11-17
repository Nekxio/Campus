import { afterEach, beforeEach, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import { classes, students, academicYears } from '../db/schema.js';
import { createAgentClass, addAgentStudents, readClassRoster } from './roster.js';
import { addAgentStudentsSchema } from '../../domain/roster-agent.js';

let client: Client, db: Database;
const classId = crypto.randomUUID();
const command = { id: classId, name: 'Demo', academicYear: '2026-2027' };
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
});
afterEach(() => client.close());

it('creates a class and retries the same identity without duplicates', async () => {
	expect(await createAgentClass(db, 'teacher', command)).toEqual(await createAgentClass(db, 'teacher', command));
	expect(await db.select().from(classes)).toHaveLength(1);
	await expect(createAgentClass(db, 'teacher', { ...command, name: 'Other' })).rejects.toMatchObject({ status: 409 });
	await expect(
		createAgentClass(db, 'teacher', { ...command, id: crypto.randomUUID(), name: 'demo' })
	).rejects.toMatchObject({ status: 409 });
});

it('adds stable student identities atomically and retries without changing the class revision', async () => {
	await createAgentClass(db, 'teacher', command);
	const input = {
		classId,
		expectedRevision: 1,
		students: [
			{ id: crypto.randomUUID(), name: 'Aline Demo' },
			{ id: crypto.randomUUID(), name: 'Camille Demo' }
		]
	};
	const first = await addAgentStudents(db, 'teacher', input);
	expect(first.revision).toBe(2);
	expect(await addAgentStudents(db, 'teacher', input)).toEqual(first);
	const roster = await readClassRoster(db, classId);
	expect(roster.students.map((s) => s.name)).toEqual(['Aline Demo', 'Camille Demo']);
	expect(Object.keys(roster.students[0]).sort()).toEqual(['id', 'name', 'position', 'revision']);
	await expect(
		addAgentStudents(db, 'teacher', {
			...input,
			students: [{ ...input.students[0], name: 'Changed' }]
		})
	).rejects.toMatchObject({ status: 409 });
});

it('rejects stale revisions, partially replayed batches and cross-class identities without adding anyone', async () => {
	await createAgentClass(db, 'teacher', command);
	const first = {
		classId,
		expectedRevision: 1,
		students: [{ id: crypto.randomUUID(), name: 'Demo' }]
	};
	await addAgentStudents(db, 'teacher', first);
	await expect(
		addAgentStudents(db, 'teacher', {
			...first,
			students: [{ id: crypto.randomUUID(), name: 'Late' }]
		})
	).rejects.toMatchObject({ status: 409 });
	await expect(
		addAgentStudents(db, 'teacher', {
			...first,
			expectedRevision: 2,
			students: [...first.students, { id: crypto.randomUUID(), name: 'Partial' }]
		})
	).rejects.toMatchObject({ status: 409 });
	const other = crypto.randomUUID();
	await createAgentClass(db, 'teacher', { ...command, id: other, name: 'Other' });
	await expect(addAgentStudents(db, 'teacher', { ...first, classId: other })).rejects.toMatchObject({ status: 409 });
	expect(await db.select().from(students)).toHaveLength(1);
});

it('does not recreate archived years or mutate their rosters', async () => {
	await createAgentClass(db, 'teacher', command);
	await db.insert(academicYears).values({ academicYear: command.academicYear, archivedAt: new Date() });
	await expect(
		createAgentClass(db, 'teacher', { ...command, id: crypto.randomUUID(), name: 'New' })
	).rejects.toMatchObject({ status: 409 });
	await expect(
		addAgentStudents(db, 'teacher', {
			classId,
			expectedRevision: 1,
			students: [{ id: crypto.randomUUID(), name: 'Late' }]
		})
	).rejects.toMatchObject({ status: 409 });
	expect((await db.select().from(classes).where(eq(classes.id, classId)))[0].revision).toBe(1);
});

it('validates bounded names and unique identities and rejects unrelated writes', () => {
	const base = {
		classId,
		expectedRevision: 1,
		students: [{ id: crypto.randomUUID(), name: ' Demo  Student ' }]
	};
	expect(addAgentStudentsSchema.parse(base).students[0].name).toBe('Demo Student');
	expect(addAgentStudentsSchema.safeParse({ ...base, students: [...base.students, ...base.students] }).success).toBe(
		false
	);
	expect(addAgentStudentsSchema.safeParse({ ...base, scores: [] }).success).toBe(false);
	expect(addAgentStudentsSchema.safeParse({ ...base, students: [] }).success).toBe(false);
});
