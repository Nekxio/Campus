import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import * as tables from '../db/schema.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import { emptyModule, editableModule } from '../../teaching/types.js';
import { moduleDraftSchema } from '../../domain/teaching.js';
import {
	addStudents,
	attachModule,
	changeStudent,
	createClass,
	createModule,
	getClassesData,
	getHomeData,
	getModule,
	listModules,
	updateClass,
	updateModule
} from './service.js';
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
describe('current-year class choices', () => {
	it('keeps older and future cohorts out of daily choices without removing their data', async () => {
		const future = await createClass(db, { name: 'Future cohort', academicYear: '2027-2028' });
		const before = await db.select().from(tables.students);
		const daily = await getClassesData(db, undefined, '2026-2027');
		expect(daily.classes.map((item) => item.id)).toEqual([ids.currentClass]);
		expect(daily.selected?.id).toBe(ids.currentClass);
		for (const classId of [ids.oldClass, future.id])
			await expect(getClassesData(db, classId, '2026-2027')).rejects.toMatchObject({ status: 404 });
		expect((await getClassesData(db, undefined, '2028-2029')).selected).toBeNull();
		expect((await getClassesData(db)).classes).toHaveLength(3);
		expect(await db.select().from(tables.students)).toEqual(before);
	});
	it('ignores lessons from other open cohorts on the daily calendar', async () => {
		await db
			.update(tables.teachingContexts)
			.set({ archivedAt: null })
			.where(eq(tables.teachingContexts.id, ids.oldContext));
		await db.insert(tables.lessons).values([
			{
				contextId: ids.oldContext,
				title: 'Old cohort',
				startsAt: new Date('2026-11-03T08:00:00Z'),
				endsAt: new Date('2026-11-03T10:00:00Z')
			},
			{
				contextId: ids.currentContext,
				title: 'Current cohort',
				startsAt: new Date('2026-11-05T08:00:00Z'),
				endsAt: new Date('2026-11-05T10:00:00Z')
			}
		]);
		const home = await getHomeData(db, new Date('2026-11-01T12:00:00Z'), '2026-11');
		expect(home.nextLesson?.title).toBe('Current cohort');
		expect(home.calendar.lessonDates).toEqual(['2026-11-05']);
	});
});
describe('module library read budget', () => {
	it('keeps the same summaries without reading large private and public documents', async () => {
		await db
			.update(tables.modules)
			.set({
				description: 'Library summary',
				needsReview: true,
				agentChanges: ['Review imported material'],
				pausedAt: new Date('2026-11-04T09:00:00Z'),
				revision: 7
			})
			.where(eq(tables.modules.id, ids.module));
		const expected = await listModules(db);
		expect(expected).toEqual([
			{
				id: ids.module,
				title: 'Demo · Application web',
				description: 'Library summary',
				revision: 7,
				needsReview: true,
				agentChanges: ['Review imported material'],
				paused: true,
				resourceCount: 1,
				classes: [{ id: ids.currentClass, name: 'B2 Demo', academicYear: '2026-2027' }]
			},
			{
				id: ids.secondModule,
				title: 'Demo · Independent module',
				description: '',
				revision: 1,
				needsReview: false,
				agentChanges: [],
				paused: false,
				resourceCount: 0,
				classes: [{ id: ids.currentClass, name: 'B2 Demo', academicYear: '2026-2027' }]
			}
		]);
		await db
			.update(tables.modules)
			.set({
				preparation: { framing: 'F'.repeat(20000), nextSteps: 'N'.repeat(20000), sourceLinks: [] },
				studentContent: {
					instructions: 'I'.repeat(20000),
					projectInstructions: 'P'.repeat(20000),
					exercises: []
				}
			})
			.where(eq(tables.modules.id, ids.module));
		let readBytes = 0;
		const execute = client.execute.bind(client);
		const measuredRead = vi.spyOn(client, 'execute').mockImplementation(async (...args) => {
			const result = await execute(...args);
			readBytes += Buffer.byteLength(
				JSON.stringify({ columns: result.columns, rows: result.rows.map((row) => Array.from(row)) })
			);
			return result;
		});
		try {
			expect(await listModules(db)).toEqual(expected);
			expect(readBytes).toBeGreaterThan(0);
			expect(readBytes).toBeLessThan(4096);
		} finally {
			measuredRead.mockRestore();
		}
	});
});
describe('home calendar browsing', () => {
	const now = new Date('2026-10-29T12:00:00Z');
	beforeEach(async () => {
		await db.insert(tables.lessons).values([
			{
				contextId: ids.currentContext,
				title: 'Next lesson',
				startsAt: new Date('2026-11-02T08:00:00Z'),
				endsAt: new Date('2026-11-02T10:00:00Z')
			},
			{
				contextId: ids.secondContext,
				title: 'Second lesson on the same day',
				startsAt: new Date('2026-11-02T13:00:00Z'),
				endsAt: new Date('2026-11-02T15:00:00Z')
			},
			{
				contextId: ids.secondContext,
				title: 'Other November lesson',
				startsAt: new Date('2026-11-15T08:00:00Z'),
				endsAt: new Date('2026-11-15T10:00:00Z')
			},
			{
				contextId: ids.oldContext,
				title: 'Archived November lesson',
				startsAt: new Date('2026-11-04T08:00:00Z'),
				endsAt: new Date('2026-11-04T10:00:00Z')
			},
			{
				contextId: ids.currentContext,
				title: 'Paris new year',
				startsAt: new Date('2026-12-31T23:30:00Z'),
				endsAt: new Date('2027-01-01T01:00:00Z')
			}
		]);
	});
	it('starts in the next lesson month and includes the other active lessons in that month', async () => {
		const home = await getHomeData(db, now);
		expect(home.calendar).toMatchObject({
			month: '2026-11',
			lessonDates: ['2026-11-02', '2026-11-15'],
			lessonTimes: {
				'2026-11-02': [
					{ startsAt: '2026-11-02T08:00:00.000Z', endsAt: '2026-11-02T10:00:00.000Z' },
					{ startsAt: '2026-11-02T13:00:00.000Z', endsAt: '2026-11-02T15:00:00.000Z' }
				],
				'2026-11-15': [{ startsAt: '2026-11-15T08:00:00.000Z', endsAt: '2026-11-15T10:00:00.000Z' }]
			}
		});
		expect(home.nextLesson?.title).toBe('Next lesson');
	});
	it('browses another month without changing the meaning of the next lesson', async () => {
		const home = await getHomeData(db, now, '2027-01');
		expect(home.calendar).toMatchObject({
			month: '2027-01',
			lessonDates: ['2027-01-01'],
			lessonTimes: {
				'2027-01-01': [{ startsAt: '2026-12-31T23:30:00.000Z', endsAt: '2027-01-01T01:00:00.000Z' }]
			}
		});
		expect(home.nextLesson?.title).toBe('Next lesson');
	});
	it.each(['2026-13', '2026-1', '0000-01', '10000-01', '2026-11-extra'])(
		'falls back safely for invalid month %s',
		async (month) => {
			expect((await getHomeData(db, now, month)).calendar.month).toBe('2026-11');
		}
	);
	it('uses the current Paris month when there is no next lesson', async () => {
		const home = await getHomeData(db, new Date('2028-12-31T23:30:00Z'));
		expect(home.nextLesson).toBeNull();
		expect(home.calendar).toMatchObject({ month: '2029-01', lessonDates: [], lessonTimes: {} });
	});
});
describe('Classes and durable drafts', () => {
	it('replays a creation key without duplicating a draft or overwriting changed content', async () => {
		const creationId = crypto.randomUUID();
		const draft = { ...emptyModule(), title: 'Retry-safe draft' };
		const first = await createModule(db, draft, creationId);
		const replay = await createModule(db, draft, creationId);
		expect(replay.id).toBe(first.id);
		expect(await db.select().from(tables.modules).where(eq(tables.modules.id, creationId))).toHaveLength(1);
		await expect(createModule(db, { ...draft, title: 'Changed' }, creationId)).rejects.toMatchObject({ status: 409 });
		expect((await getModule(db, creationId)).title).toBe('Retry-safe draft');
		const updated = await updateModule(db, creationId, {
			...draft,
			title: 'Explicit later update',
			expectedRevision: first.revision
		});
		await expect(createModule(db, draft, creationId)).rejects.toMatchObject({ status: 409 });
		expect((await getModule(db, creationId)).revision).toBe(updated.revision);
		expect((await getModule(db, creationId)).title).toBe('Explicit later update');
	});

	it('creates an annual class and retains the shared roster across modules', async () => {
		const created = await createClass(db, { name: 'B3', academicYear: '2026-2027' });
		expect((await getClassesData(db, created.id)).selected?.students).toEqual([]);
		expect((await getClassesData(db, ids.currentClass)).selected?.modules).toHaveLength(2);
		await expect(createClass(db, { name: 'b3', academicYear: '2026-2027' })).rejects.toMatchObject({
			status: 409
		});
	});
	it('imports new students atomically, skipping explicit duplicates and protecting revisions', async () => {
		expect(
			await addStudents(db, ids.currentClass, {
				kind: 'import',
				source: 'Student Demo 1\nAlice Martin\nAlice Martin',
				expectedRevision: 1
			})
		).toEqual({ added: 1, skipped: 2 });
		expect((await getClassesData(db, ids.currentClass)).selected?.studentCount).toBe(13);
		await expect(
			addStudents(db, ids.currentClass, { kind: 'add', name: 'Bob', expectedRevision: 1 })
		).rejects.toMatchObject({ status: 409 });
		await expect(
			addStudents(db, ids.currentClass, {
				kind: 'import',
				source: 'prénom;nom\nGood;Student\nInvalid;',
				expectedRevision: 2
			})
		).rejects.toMatchObject({ status: 422 });
		expect((await getClassesData(db, ids.currentClass)).selected?.studentCount).toBe(13);
		expect((await getClassesData(db, ids.currentClass)).selected?.revision).toBe(2);
	});
	it('renames a class with active snapshots but preserves archived names and years', async () => {
		await updateClass(db, ids.currentClass, {
			name: 'B2 Renamed',
			academicYear: '2026-2027',
			expectedRevision: 1
		});
		expect(
			(await db.select().from(tables.teachingContexts).where(eq(tables.teachingContexts.id, ids.currentContext)))[0]
				.className
		).toBe('B2 Renamed');
		await expect(
			updateClass(db, ids.currentClass, {
				name: 'B2 Renamed',
				academicYear: '2027-2028',
				expectedRevision: 2
			})
		).rejects.toMatchObject({ status: 422 });
		expect(
			(await db.select().from(tables.teachingContexts).where(eq(tables.teachingContexts.id, ids.oldContext)))[0]
				.academicYear
		).toBe('2025-2026');
	});
	it('rejects cross-class roster edits without changing either roster revision', async () => {
		await expect(
			changeStudent(db, ids.currentClass, ids.oldStudent, {
				name: 'Wrong',
				expectedRevision: 1,
				classRevision: 1
			})
		).rejects.toMatchObject({ status: 409 });
		expect((await getClassesData(db, ids.currentClass)).selected?.revision).toBe(1);
		expect((await getClassesData(db, ids.oldClass)).selected?.students[0].name).toBe('Old Student Demo');
	});
	it('removes only the selected student and their grading records, preserving content', async () => {
		await changeStudent(db, ids.currentClass, ids.students[0], {
			expectedRevision: 1,
			classRevision: 1,
			confirm: true
		});
		expect((await getClassesData(db, ids.currentClass)).selected?.studentCount).toBe(11);
		expect(await db.select().from(tables.corrections).where(eq(tables.corrections.id, ids.correction))).toHaveLength(0);
		expect(await db.select().from(tables.modules)).toHaveLength(2);
		expect(await db.select().from(tables.scores).where(eq(tables.scores.correctionId, ids.oldCorrection))).toHaveLength(
			1
		);
	});
	it('reuses a module in a new annual class without copying grades, students or dates', async () => {
		const created = await createClass(db, { name: 'B3', academicYear: '2027-2028' });
		const attached = await attachModule(db, created.id, {
			moduleId: ids.module,
			moduleRevision: 1,
			expectedRevision: 1
		});
		expect((await getClassesData(db, created.id)).selected?.modules).toHaveLength(1);
		expect((await getClassesData(db, created.id)).selected?.students).toHaveLength(0);
		expect(await db.select().from(tables.lessons).where(eq(tables.lessons.contextId, attached.id))).toHaveLength(0);
		expect(
			await db.select().from(tables.corrections).where(eq(tables.corrections.contextId, attached.id))
		).toHaveLength(0);
	});
	it('creates a module without a class and retains source references and objectives', async () => {
		const draft = {
			...emptyModule(),
			title: 'New module',
			objectives: ['Build an API'],
			sourcePath: '/local/private/module'
		};
		const saved = await createModule(db, moduleDraftSchema.parse(draft));
		expect((await getModule(db, saved.id)).objectives).toEqual(['Build an API']);
		expect(saved.sourcePath).toBe('/local/private/module');
		expect(saved.contexts).toEqual([]);
	});
	it('replaces links in one save with stable identities and leaves publication snapshots intact', async () => {
		const before = await getModule(db, ids.module);
		const draft = editableModule(before);
		draft.resources[0].url = 'https://example.test/replacement.pdf';
		const saved = await updateModule(db, before.id, {
			...draft,
			expectedRevision: before.revision
		});
		expect(saved.resources[0].id).toBe(ids.resource);
		expect(saved.resources[0].url).toContain('replacement');
		expect((await db.select().from(tables.modulePublications))[0].snapshot.resources[0].url).toBe(
			'https://example.test/course.pdf'
		);
		await expect(updateModule(db, before.id, { ...draft, expectedRevision: before.revision })).rejects.toMatchObject({
			status: 409
		});
	});
	it('saves an optional class schedule and retrieves it after reload', async () => {
		const contextId = crypto.randomUUID();
		const lessonId = crypto.randomUUID();
		const draft = {
			...emptyModule(),
			title: 'Scheduled',
			contexts: [
				{
					id: contextId,
					classId: ids.currentClass,
					lessons: [
						{
							id: lessonId,
							title: 'First lesson',
							startsAt: '2099-10-13T07:00:00Z',
							endsAt: '2099-10-13T10:00:00Z',
							recap: '',
							toDo: ''
						}
					]
				}
			]
		};
		const saved = await createModule(db, moduleDraftSchema.parse(draft));
		expect((await getModule(db, saved.id)).contexts[0].lessons[0].id).toBe(lessonId);
		expect((await getHomeData(db)).nextLesson?.moduleId).toBe(saved.id);
		const changed = editableModule(saved);
		changed.contexts[0].lessons[0].title = 'Updated lesson';
		const updated = await updateModule(db, saved.id, {
			...changed,
			expectedRevision: saved.revision
		});
		expect(updated.contexts[0].lessons[0].title).toBe('Updated lesson');
	});
	it('rejects cross-module resource/context/lesson identities and rolls back the whole draft', async () => {
		const target = await getModule(db, ids.secondModule);
		const draft = editableModule(target);
		draft.resources = [{ id: ids.resource, label: 'Stolen', url: 'https://example.test/x', kind: 'course' }];
		await expect(updateModule(db, target.id, { ...draft, expectedRevision: 1 })).rejects.toMatchObject({ status: 422 });
		expect((await getModule(db, target.id)).revision).toBe(1);
		draft.resources = [];
		draft.contexts[0].id = ids.currentContext;
		await expect(updateModule(db, target.id, { ...draft, expectedRevision: 1 })).rejects.toMatchObject({ status: 409 });
		expect((await getModule(db, ids.module)).resources[0].label).toBe('Demo · Course PDF');
	});
	it('keeps archived preparation, calendar and grades while editing current module content', async () => {
		const before = await getModule(db, ids.module);
		const draft = editableModule(before);
		draft.title = 'Updated title';
		await updateModule(db, before.id, { ...draft, expectedRevision: before.revision });
		expect(await db.select().from(tables.lessons).where(eq(tables.lessons.contextId, ids.oldContext))).toHaveLength(1);
		expect(await db.select().from(tables.scores).where(eq(tables.scores.correctionId, ids.oldCorrection))).toHaveLength(
			1
		);
	});
});
