import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import { seedGradingFixtures } from '../db/testing/grading-fixtures.js';
import { seedGradingSelectionFixtures } from '../db/testing/grading-selection-fixtures.js';
import * as tables from '../db/schema.js';
import { getGradeWorkspace, gradingYearPreference } from './grading-selection.js';
import { gradeExportStatus } from '../../domain/grade-export.js';

let client: Client, db: Database, ids: Awaited<ReturnType<typeof seedGradingFixtures>>;
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedGradingFixtures(db);
});
afterEach(() => client.close());

describe('class-first grade selection', () => {
	it('requires a work year when several years remain open and never chooses a module', async () => {
		const grid = await getGradeWorkspace(db);
		expect(grid.academicYears).toEqual(['2025-2026', '2026-2027']);
		expect(grid).toMatchObject({
			academicYear: null,
			classId: null,
			modules: [],
			rubric: null,
			students: []
		});
	});
	it('uses the sole open year without choosing a class and excludes archived years', async () => {
		await db
			.insert(tables.academicYears)
			.values({ academicYear: '2025-2026', archivedAt: new Date() });
		const grid = await getGradeWorkspace(db);
		expect(grid).toMatchObject({
			academicYear: '2026-2027',
			classId: null,
			modules: [],
			rubric: null
		});
		expect(grid.classes.map((item) => item.id)).toEqual([ids.currentClass]);
	});
	it('limits module options to the chosen class, with no stale grid after clearing it', async () => {
		const fixture = await seedGradingSelectionFixtures(db, ids.module);
		const b2 = await getGradeWorkspace(db, {
			academicYear: '2026-2027',
			classId: ids.currentClass
		});
		expect(b2.modules.map((item) => item.id)).toEqual(
			expect.arrayContaining([ids.module, ids.secondModule])
		);
		expect(b2.modules.some((item) => item.id === fixture.b3Module)).toBe(false);
		expect(b2.rubric).toBeNull();
		const empty = await getGradeWorkspace(db, { classId: fixture.emptyClass });
		expect(empty).toMatchObject({ modules: [], contexts: [], rubric: null, students: [] });
		const cleared = await getGradeWorkspace(db, { academicYear: '2026-2027' });
		expect(cleared).toMatchObject({
			classId: null,
			modules: [],
			contexts: [],
			rubric: null,
			students: []
		});
	});
	it('resolves a module deep link to its class and year, overriding an unrelated preference', async () => {
		const fixture = await seedGradingSelectionFixtures(db, ids.module);
		const grid = await getGradeWorkspace(db, {
			moduleId: fixture.b3Module,
			preferredYear: '2027-2028'
		});
		expect(grid).toMatchObject({
			academicYear: '2026-2027',
			classId: fixture.b3Class,
			contextId: fixture.b3Context
		});
		expect(grid.students.map((item) => item.name)).toEqual(['B3 Alice Démo', 'B3 Boris Démo']);
		expect(gradeExportStatus(grid)).toMatchObject({ complete: 1, total: 2, ready: false });
	});
	it('persists only the explicitly preferred open year and never advances a closed preference', async () => {
		await seedGradingSelectionFixtures(db, ids.module);
		const future = await getGradeWorkspace(db, { preferredYear: '2027-2028' });
		expect(future.academicYear).toBe('2027-2028');
		expect(future.classes.map((item) => item.academicYear)).toEqual(['2027-2028']);
		const closed = await getGradeWorkspace(db, { preferredYear: '2025-2026' });
		expect(closed).toMatchObject({ academicYear: null, classId: null, modules: [], students: [] });
	});
	it('rejects incompatible class, module, context and year identities before reading another roster', async () => {
		const fixture = await seedGradingSelectionFixtures(db, ids.module);
		for (const selection of [
			{ classId: ids.currentClass, moduleId: fixture.b3Module },
			{ classId: fixture.b3Class, contextId: ids.currentContext },
			{ moduleId: ids.module, contextId: ids.secondContext },
			{ classId: fixture.futureClass, academicYear: '2026-2027' },
			{ academicYear: '2025-2026' },
			{ moduleId: crypto.randomUUID() },
			{ contextId: ids.oldContext }
		])
			await expect(getGradeWorkspace(db, selection)).rejects.toMatchObject({ status: 404 });
	});
	it('does not infer a class for ambiguous legacy module attachments', async () => {
		await db
			.update(tables.teachingContexts)
			.set({ archivedAt: null })
			.where(eq(tables.teachingContexts.id, ids.oldContext));
		const grid = await getGradeWorkspace(db, { moduleId: ids.module });
		expect(grid).toMatchObject({ academicYear: null, classId: null, rubric: null, students: [] });
	});
	it('scopes the non-authentication year preference to its teacher and rejects malformed values', () => {
		const raw = JSON.stringify({ teacherId: ids.teacher, academicYear: '2026-2027' });
		expect(gradingYearPreference(raw, ids.teacher)).toBe('2026-2027');
		for (const invalid of ['{', '{}', raw, undefined])
			expect(gradingYearPreference(invalid, 'another-teacher')).toBeUndefined();
	});
});
