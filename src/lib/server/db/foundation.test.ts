import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { and, eq } from 'drizzle-orm';
import { createDatabase, type Database } from './index.js';
import * as schema from './schema.js';
import { requireRosterEntry } from '../teaching/roster.js';
import { seedFoundationFixtures } from './testing/fixtures.js';

let client: Client;
let db: Database;
let ids: Awaited<ReturnType<typeof seedFoundationFixtures>>;
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedFoundationFixtures(db);
});
afterEach(() => client.close());

describe('Locally migrated foundation', () => {
	it('shares the roster between modules, with independent annual contexts', async () => {
		expect((await client.execute('PRAGMA foreign_keys')).rows[0].foreign_keys).toBe(1);
		expect(await db.select().from(schema.students).where(eq(schema.students.classId, ids.currentClass))).toHaveLength(
			12
		);
		expect(
			await db.select().from(schema.teachingContexts).where(eq(schema.teachingContexts.classId, ids.currentClass))
		).toHaveLength(2);
		expect(await db.select().from(schema.modules)).toHaveLength(2);
		await expect(migrate(db, { migrationsFolder: './drizzle' })).resolves.toBeUndefined();
		expect(await db.select().from(schema.modules)).toHaveLength(2);
	});
	it('class deletion removes student data while keeping modules, preparation and calendar history', async () => {
		await db.delete(schema.classes).where(eq(schema.classes.id, ids.oldClass));
		expect(await db.select().from(schema.students).where(eq(schema.students.id, ids.oldStudent))).toHaveLength(0);
		expect(await db.select().from(schema.corrections).where(eq(schema.corrections.id, ids.oldCorrection))).toHaveLength(
			0
		);
		expect(await db.select().from(schema.scores).where(eq(schema.scores.correctionId, ids.oldCorrection))).toHaveLength(
			0
		);
		expect(await db.select().from(schema.semesterComments)).toHaveLength(0);
		expect(await db.select().from(schema.correctionProposals)).toHaveLength(0);
		const context = (
			await db.select().from(schema.teachingContexts).where(eq(schema.teachingContexts.id, ids.oldContext))
		)[0];
		expect(context.classId).toBeNull();
		expect(context.academicYear).toBe('2025-2026');
		expect(await db.select().from(schema.lessons).where(eq(schema.lessons.contextId, ids.oldContext))).toHaveLength(1);
		expect(await db.select().from(schema.assessmentDeadlines)).toHaveLength(1);
		expect(await db.select().from(schema.modulePublications)).toHaveLength(1);
		expect(
			(await db.select().from(schema.modules).where(eq(schema.modules.id, ids.module)))[0].preparation.framing
		).toBe('Teacher-only preparation.');
		expect(await db.select().from(schema.resources)).toHaveLength(1);
		expect(await db.select().from(schema.rubricLines)).toHaveLength(2);
		expect(await db.select().from(schema.students).where(eq(schema.students.classId, ids.currentClass))).toHaveLength(
			12
		);
		expect(await db.select().from(schema.corrections).where(eq(schema.corrections.id, ids.correction))).toHaveLength(1);
		expect(await db.select().from(schema.user)).toHaveLength(1);
	});
	it('rejects students from another class and detached annual contexts', async () => {
		expect(await requireRosterEntry(db, ids.currentContext, ids.students[0])).toMatchObject({
			moduleId: ids.module,
			studentId: ids.students[0]
		});
		await expect(requireRosterEntry(db, ids.currentContext, ids.oldStudent)).rejects.toMatchObject({
			status: 404
		});
		await db.delete(schema.classes).where(eq(schema.classes.id, ids.oldClass));
		await expect(requireRosterEntry(db, ids.oldContext, ids.students[0])).rejects.toMatchObject({
			status: 404
		});
	});
	it('keeps raw points and retired lines after a rubric replacement', async () => {
		await db.update(schema.rubricLines).set({ maxPoints: 5 }).where(eq(schema.rubricLines.id, ids.firstLine));
		expect(
			(
				await db
					.select()
					.from(schema.scores)
					.where(and(eq(schema.scores.correctionId, ids.correction), eq(schema.scores.lineId, ids.firstLine)))
			)[0].points
		).toBe(8);
		await db.update(schema.rubricLines).set({ retiredAt: new Date() }).where(eq(schema.rubricLines.id, ids.firstLine));
		expect(await db.select().from(schema.scores).where(eq(schema.scores.lineId, ids.firstLine))).toHaveLength(2);
	});
	it('rejects fractional/negative points, mismatched module assessments and duplicate roster records', async () => {
		await expect(
			db.update(schema.scores).set({ points: 8.5 }).where(eq(schema.scores.correctionId, ids.correction))
		).rejects.toThrow();
		await expect(
			db.update(schema.scores).set({ points: -1 }).where(eq(schema.scores.correctionId, ids.correction))
		).rejects.toThrow();
		await expect(
			db.insert(schema.corrections).values({
				contextId: ids.secondContext,
				moduleId: ids.secondModule,
				studentId: ids.students[0],
				assessmentId: ids.project
			})
		).rejects.toThrow();
		await expect(
			db.insert(schema.corrections).values({
				contextId: ids.currentContext,
				moduleId: ids.module,
				studentId: ids.students[0],
				assessmentId: ids.project
			})
		).rejects.toThrow();
	});
	it('keeps an empty score distinct from zero and rejects non-teacher accounts', async () => {
		await db.update(schema.scores).set({ points: null }).where(eq(schema.scores.lineId, ids.firstLine));
		expect(
			(
				await db
					.select()
					.from(schema.scores)
					.where(and(eq(schema.scores.correctionId, ids.correction), eq(schema.scores.lineId, ids.firstLine)))
			)[0].points
		).toBeNull();
		await db.update(schema.scores).set({ points: 0 }).where(eq(schema.scores.lineId, ids.firstLine));
		expect(
			(
				await db
					.select()
					.from(schema.scores)
					.where(and(eq(schema.scores.correctionId, ids.correction), eq(schema.scores.lineId, ids.firstLine)))
			)[0].points
		).toBe(0);
		await expect(
			client.execute({
				sql: 'UPDATE user SET role = ? WHERE id = ?',
				args: ['student', ids.teacher]
			})
		).rejects.toThrow();
	});
});
