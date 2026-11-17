import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import { seedGradingFixtures } from '../db/testing/grading-fixtures.js';
import { seedGradingSelectionFixtures } from '../db/testing/grading-selection-fixtures.js';
import * as tables from '../db/schema.js';
import {
	getGradeWorkspace,
	gradingPreference,
	gradingYearPreference,
	rememberGradingWorkspace
} from './grading-selection.js';
import { gradeExportStatus } from '../../domain/grade-export.js';
import { copyModuleToClass, createClass } from './service.js';

let client: Client, db: Database, ids: Awaited<ReturnType<typeof seedGradingFixtures>>;
beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedGradingFixtures(db);
});
afterEach(() => {
	client.close();
	vi.useRealTimers();
});

describe('current-year grade selection', () => {
	it('keeps the current class when an older year remains open and a future class exists', async () => {
		await db
			.update(tables.teachingContexts)
			.set({ archivedAt: null })
			.where(eq(tables.teachingContexts.id, ids.oldContext));
		const futureClass = await createClass(db, { name: 'Future class', academicYear: '2027-2028' });
		const futureModule = await copyModuleToClass(db, ids.module, futureClass.id);
		const readStoredData = () =>
			Promise.all([
				db.select().from(tables.classes),
				db.select().from(tables.teachingContexts),
				db.select().from(tables.students),
				db.select().from(tables.corrections),
				db.select().from(tables.scores),
				db.select().from(tables.semesterComments)
			]);
		const before = await readStoredData();
		const grid = await getGradeWorkspace(db, { currentYearOnly: true, contextId: ids.currentContext });
		expect(grid.academicYears).toEqual(['2026-2027']);
		expect(grid.classes.map((item) => item.id)).toEqual([ids.currentClass]);
		expect(grid.contexts.map((item) => item.id)).toEqual(
			expect.arrayContaining([ids.currentContext, ids.secondContext])
		);
		expect(grid.contexts.every((item) => item.academicYear === '2026-2027')).toBe(true);
		expect(grid.students.map((item) => item.id)).toEqual(ids.students);
		expect(await getGradeWorkspace(db, { contextId: ids.oldContext })).toMatchObject({
			academicYear: '2025-2026',
			classId: ids.oldClass,
			contextId: ids.oldContext
		});
		expect(await getGradeWorkspace(db, { contextId: futureModule.contexts[0].id })).toMatchObject({
			academicYear: '2027-2028',
			classId: futureClass.id
		});
		expect(await readStoredData()).toEqual(before);
	});

	it('returns an empty workspace when no class belongs to the current year', async () => {
		await db.update(tables.classes).set({ academicYear: '2027-2028' }).where(eq(tables.classes.id, ids.currentClass));
		await db
			.update(tables.teachingContexts)
			.set({ academicYear: '2027-2028' })
			.where(eq(tables.teachingContexts.classId, ids.currentClass));
		const grid = await getGradeWorkspace(db, { currentYearOnly: true });
		expect(grid).toMatchObject({
			academicYears: [],
			academicYear: null,
			classes: [],
			classId: null,
			contexts: [],
			contextId: null,
			modules: [],
			rubric: null,
			students: []
		});
	});

	it('rejects explicit older or future identities instead of selecting a current roster', async () => {
		await db
			.update(tables.teachingContexts)
			.set({ archivedAt: null })
			.where(eq(tables.teachingContexts.id, ids.oldContext));
		const futureClass = await createClass(db, { name: 'Future class', academicYear: '2027-2028' });
		const futureModule = await copyModuleToClass(db, ids.module, futureClass.id);
		for (const selection of [
			{ academicYear: '2025-2026' },
			{ academicYear: '2027-2028' },
			{ classId: ids.oldClass },
			{ classId: futureClass.id },
			{ contextId: ids.oldContext },
			{ contextId: futureModule.contexts[0].id },
			{ moduleId: futureModule.id },
			{ academicYear: '2025-2026', contextId: ids.currentContext }
		])
			await expect(getGradeWorkspace(db, { ...selection, currentYearOnly: true })).rejects.toMatchObject({
				status: 404
			});
	});

	it('restores only the current-year context preference', async () => {
		const fixture = await seedGradingSelectionFixtures(db, ids.module);
		const grid = await getGradeWorkspace(db, {
			currentYearOnly: true,
			preferredContexts: [
				{
					academicYear: '2027-2028',
					classId: fixture.futureClass,
					moduleId: fixture.futureModule,
					contextId: fixture.futureContext
				},
				{
					academicYear: '2026-2027',
					classId: fixture.b3Class,
					moduleId: fixture.b3Module,
					contextId: fixture.b3Context
				}
			]
		});
		expect(grid).toMatchObject({
			academicYear: '2026-2027',
			classId: fixture.b3Class,
			contextId: fixture.b3Context
		});
	});
});

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
	it('uses the sole open year and class while keeping a real module choice', async () => {
		await db.insert(tables.academicYears).values({ academicYear: '2025-2026', archivedAt: new Date() });
		const grid = await getGradeWorkspace(db);
		expect(grid).toMatchObject({
			academicYear: '2026-2027',
			classId: ids.currentClass,
			rubric: null
		});
		expect(grid.classes.map((item) => item.id)).toEqual([ids.currentClass]);
	});
	it('selects the sole admissible class and module without recording grades', async () => {
		const fixture = await seedGradingSelectionFixtures(db, ids.module);
		const before = await db.select().from(tables.corrections);
		const grid = await getGradeWorkspace(db, { academicYear: '2027-2028' });
		expect(grid).toMatchObject({
			classId: fixture.futureClass,
			contextId: fixture.futureContext,
			rubric: { module: { id: fixture.futureModule } }
		});
		expect(await db.select().from(tables.corrections)).toEqual(before);
	});
	it('restores a remembered context for the work year and lets an explicit URL override it', async () => {
		const fixture = await seedGradingSelectionFixtures(db, ids.module);
		const preferredContexts = [
			{
				academicYear: '2026-2027',
				classId: fixture.b3Class,
				moduleId: fixture.b3Module,
				contextId: fixture.b3Context
			}
		];
		const remembered = await getGradeWorkspace(db, {
			preferredYear: '2026-2027',
			preferredContexts
		});
		expect(remembered).toMatchObject({ classId: fixture.b3Class, contextId: fixture.b3Context });
		const explicit = await getGradeWorkspace(db, {
			moduleId: ids.module,
			preferredYear: '2026-2027',
			preferredContexts
		});
		expect(explicit).toMatchObject({ classId: ids.currentClass, contextId: ids.currentContext });
		const cleared = await getGradeWorkspace(db, {
			academicYear: '2026-2027',
			classId: '',
			preferredContexts
		});
		expect(cleared).toMatchObject({ classId: null, contextId: null, students: [] });
	});
	it.each(['archived', 'paused', 'missing'] as const)(
		'explains a %s remembered context without opening a replacement grid',
		async (state) => {
			const fixture = await seedGradingSelectionFixtures(db, ids.module);
			if (state === 'archived')
				await db
					.update(tables.teachingContexts)
					.set({ archivedAt: new Date() })
					.where(eq(tables.teachingContexts.id, fixture.b3Context));
			if (state === 'paused')
				await db.update(tables.modules).set({ pausedAt: new Date() }).where(eq(tables.modules.id, fixture.b3Module));
			const grid = await getGradeWorkspace(db, {
				preferredYear: '2026-2027',
				preferredContexts: [
					{
						academicYear: '2026-2027',
						classId: fixture.b3Class,
						moduleId: fixture.b3Module,
						contextId: state === 'missing' ? crypto.randomUUID() : fixture.b3Context
					}
				]
			});
			expect(grid).toMatchObject({
				classId: fixture.b3Class,
				contextId: null,
				rubric: null,
				students: []
			});
			expect(grid.selectionNotice).toContain('n’est plus disponible');
		}
	);
	it('accepts a teacher-scoped context preference without trusting another teacher', () => {
		const raw = JSON.stringify({
			teacherId: ids.teacher,
			academicYear: '2026-2027',
			contexts: [
				{
					academicYear: '2026-2027',
					classId: ids.currentClass,
					moduleId: ids.module,
					contextId: ids.currentContext
				}
			]
		});
		expect(gradingYearPreference(raw, ids.teacher)).toBe('2026-2027');
		expect(gradingYearPreference(raw, 'another-teacher')).toBeUndefined();
	});
	it('retains the last complete context while a new selection is incomplete', async () => {
		const selected = await getGradeWorkspace(db, { contextId: ids.currentContext });
		const preference = gradingPreference(rememberGradingWorkspace(selected, ids.teacher, undefined), ids.teacher);
		const incomplete = await getGradeWorkspace(db, {
			academicYear: '2026-2027',
			classId: ids.currentClass
		});
		const remembered = gradingPreference(rememberGradingWorkspace(incomplete, ids.teacher, preference), ids.teacher);
		expect(remembered?.contexts).toEqual(preference?.contexts);
	});
	it('opens a sole module with an empty roster without inventing student results', async () => {
		const fixture = await seedGradingSelectionFixtures(db, ids.module);
		const module = await copyModuleToClass(db, ids.module, fixture.emptyClass);
		const grid = await getGradeWorkspace(db, { classId: fixture.emptyClass });
		expect(grid).toMatchObject({ rubric: { module: { id: module.id } }, students: [] });
	});
	it('limits module options to the chosen class, with no stale grid after clearing it', async () => {
		const fixture = await seedGradingSelectionFixtures(db, ids.module);
		const b2 = await getGradeWorkspace(db, {
			academicYear: '2026-2027',
			classId: ids.currentClass
		});
		expect(b2.modules.map((item) => item.id)).toEqual(expect.arrayContaining([ids.module, ids.secondModule]));
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
