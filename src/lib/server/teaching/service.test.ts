import { beforeEach, afterEach, describe, expect, it } from 'vitest';
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
describe('Classes and durable drafts', () => {
	it('replays a creation key without duplicating a draft or overwriting changed content', async () => {
		const creationId = crypto.randomUUID();
		const draft = { ...emptyModule(), title: 'Retry-safe draft' };
		const first = await createModule(db, draft, creationId);
		const replay = await createModule(db, draft, creationId);
		expect(replay.id).toBe(first.id);
		expect(
			await db.select().from(tables.modules).where(eq(tables.modules.id, creationId))
		).toHaveLength(1);
		await expect(
			createModule(db, { ...draft, title: 'Changed' }, creationId)
		).rejects.toMatchObject({ status: 409 });
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
			(
				await db
					.select()
					.from(tables.teachingContexts)
					.where(eq(tables.teachingContexts.id, ids.currentContext))
			)[0].className
		).toBe('B2 Renamed');
		await expect(
			updateClass(db, ids.currentClass, {
				name: 'B2 Renamed',
				academicYear: '2027-2028',
				expectedRevision: 2
			})
		).rejects.toMatchObject({ status: 422 });
		expect(
			(
				await db
					.select()
					.from(tables.teachingContexts)
					.where(eq(tables.teachingContexts.id, ids.oldContext))
			)[0].academicYear
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
		expect((await getClassesData(db, ids.oldClass)).selected?.students[0].name).toBe(
			'Old Student Demo'
		);
	});
	it('removes only the selected student and their grading records, preserving content', async () => {
		await changeStudent(db, ids.currentClass, ids.students[0], {
			expectedRevision: 1,
			classRevision: 1,
			confirm: true
		});
		expect((await getClassesData(db, ids.currentClass)).selected?.studentCount).toBe(11);
		expect(
			await db.select().from(tables.corrections).where(eq(tables.corrections.id, ids.correction))
		).toHaveLength(0);
		expect(await db.select().from(tables.modules)).toHaveLength(2);
		expect(
			await db.select().from(tables.scores).where(eq(tables.scores.correctionId, ids.oldCorrection))
		).toHaveLength(1);
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
		expect(
			await db.select().from(tables.lessons).where(eq(tables.lessons.contextId, attached.id))
		).toHaveLength(0);
		expect(
			await db
				.select()
				.from(tables.corrections)
				.where(eq(tables.corrections.contextId, attached.id))
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
		await expect(
			updateModule(db, before.id, { ...draft, expectedRevision: before.revision })
		).rejects.toMatchObject({ status: 409 });
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
		draft.resources = [
			{ id: ids.resource, label: 'Stolen', url: 'https://example.test/x', kind: 'course' }
		];
		await expect(
			updateModule(db, target.id, { ...draft, expectedRevision: 1 })
		).rejects.toMatchObject({ status: 422 });
		expect((await getModule(db, target.id)).revision).toBe(1);
		draft.resources = [];
		draft.contexts[0].id = ids.currentContext;
		await expect(
			updateModule(db, target.id, { ...draft, expectedRevision: 1 })
		).rejects.toMatchObject({ status: 409 });
		expect((await getModule(db, ids.module)).resources[0].label).toBe('Demo · Course PDF');
	});
	it('keeps archived preparation, calendar and grades while editing current module content', async () => {
		const before = await getModule(db, ids.module);
		const draft = editableModule(before);
		draft.title = 'Updated title';
		await updateModule(db, before.id, { ...draft, expectedRevision: before.revision });
		expect(
			await db.select().from(tables.lessons).where(eq(tables.lessons.contextId, ids.oldContext))
		).toHaveLength(1);
		expect(
			await db.select().from(tables.scores).where(eq(tables.scores.correctionId, ids.oldCorrection))
		).toHaveLength(1);
	});
});
