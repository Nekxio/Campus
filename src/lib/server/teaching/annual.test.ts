import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import * as t from '../db/schema.js';
import { seedGradingFixtures } from '../db/testing/grading-fixtures.js';
import { getAnnualData, getAnnualHistory, decideAnnualYear } from './annual.js';
import { getClassesData, getModule, createClass, updateModule, addStudents } from './service.js';
import { getGradeGrid, saveCorrection, saveSemesterComment } from './grading.js';
import { getFinalGradeExport } from './grade-export.js';
import { getPublicationReview, decidePublication, getPublicModule, getPublicClass } from './publications.js';
import { readImportContext } from '../agent/import.js';
import { editableModule } from '../../teaching/types.js';
import { annualActionSchema, type AnnualAction } from '../../domain/annual.js';
import { syncCalendarIfDue } from '../calendar/service.js';
import type { CalendarOccurrence } from '../../domain/calendar-subscription.js';
let client: Client, db: Database, ids: Awaited<ReturnType<typeof seedGradingFixtures>>;
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedGradingFixtures(db);
});
afterEach(() => client.close());
const seedCalendar = async (teacherId = ids.teacher, contextId = ids.currentContext) => {
	const mappingId = crypto.randomUUID();
	const lessonId = crypto.randomUUID();
	await db.insert(t.calendarSubscriptions).values({
		teacherId,
		generation: crypto.randomUUID(),
		url: 'https://school.pronote-campus.net/hp/Telechargements/ical/fictional.ics',
		active: true,
		preview: [
			{
				key: 'preview',
				course: 'Demo',
				title: 'Demo',
				startsAt: '2026-11-04T08:00:00Z',
				endsAt: '2026-11-04T10:00:00Z',
				cancelled: false
			}
		]
	});
	await db
		.insert(t.calendarMappings)
		.values({ id: mappingId, teacherId, generation: 'previous-generation', course: 'Demo', contextId, active: false });
	await db.insert(t.lessons).values({
		id: lessonId,
		contextId,
		title: 'Imported demo',
		startsAt: new Date('2026-11-04T08:00:00Z'),
		endsAt: new Date('2026-11-04T10:00:00Z'),
		recap: 'Private lesson notes'
	});
	await db.insert(t.calendarLessons).values({ lessonId, mappingId, eventKey: 'demo', status: 'disconnected' });
	return { mappingId, lessonId };
};

describe('Annual calendar removal', () => {
	it('removes the complete teacher connection across years and preserves manual lessons, other teachers and publications', async () => {
		const calendar = await seedCalendar(ids.teacher, ids.secondContext);
		const anotherTeacher = crypto.randomUUID();
		await db
			.insert(t.user)
			.values({ id: anotherTeacher, name: 'Other teacher', email: 'other@example.test', role: 'teacher' });
		const other = await seedCalendar(anotherTeacher, ids.oldContext);
		const beforeLessons = await db.select().from(t.lessons);
		const beforePublications = await db.select().from(t.modulePublications);
		const [beforeContext] = await db
			.select()
			.from(t.teachingContexts)
			.where(eq(t.teachingContexts.id, ids.secondContext));
		const [beforeModule] = await db.select().from(t.modules).where(eq(t.modules.id, ids.secondModule));
		const preview = (await getAnnualData(db, ids.teacher, '2025-2026')).selected!;
		expect(preview.calendarCleanup).toEqual({ connection: true, lessons: 1, otherYearLessons: 1 });
		expect(JSON.stringify(preview)).not.toContain('fictional.ics');
		expect(JSON.stringify(preview)).not.toContain('Private lesson notes');
		const command = await action('purge', '2025-2026');
		const receipt = await decideAnnualYear(db, ids.teacher, command);
		expect(receipt.calendar).toEqual({ connection: true, lessons: 1 });
		expect(
			await db.select().from(t.calendarSubscriptions).where(eq(t.calendarSubscriptions.teacherId, ids.teacher))
		).toEqual([]);
		expect(await db.select().from(t.calendarMappings).where(eq(t.calendarMappings.teacherId, ids.teacher))).toEqual([]);
		expect(await db.select().from(t.calendarLessons).where(eq(t.calendarLessons.lessonId, calendar.lessonId))).toEqual(
			[]
		);
		expect(await db.select().from(t.lessons)).toEqual(
			beforeLessons.filter((lesson) => lesson.id !== calendar.lessonId)
		);
		expect(
			await db.select().from(t.calendarLessons).where(eq(t.calendarLessons.lessonId, other.lessonId))
		).toHaveLength(1);
		expect(await db.select().from(t.modulePublications)).toEqual(beforePublications);
		const [afterContext] = await db
			.select()
			.from(t.teachingContexts)
			.where(eq(t.teachingContexts.id, ids.secondContext));
		const [afterModule] = await db.select().from(t.modules).where(eq(t.modules.id, ids.secondModule));
		expect(afterContext.revision).toBe(beforeContext.revision + 1);
		expect(afterModule.revision).toBe(beforeModule.revision + 1);
		expect(afterContext.archivedAt).toBeNull();
		const nextCalendar = await seedCalendar();
		expect(await decideAnnualYear(db, ids.teacher, command)).toEqual(receipt);
		expect(await db.select().from(t.lessons).where(eq(t.lessons.id, nextCalendar.lessonId))).toHaveLength(1);
	});
	it('preserves the connection and imported lessons on archive and reopen', async () => {
		await seedCalendar();
		const subscriptions = await db.select().from(t.calendarSubscriptions);
		const lessons = await db.select().from(t.lessons);
		await decideAnnualYear(db, ids.teacher, await action('archive'));
		await decideAnnualYear(db, ids.teacher, await action('reopen'));
		expect(await db.select().from(t.calendarSubscriptions)).toEqual(subscriptions);
		expect(await db.select().from(t.lessons)).toEqual(lessons);
	});
	it('rejects connection and imported-lesson changes outside the reviewed school year', async () => {
		const calendar = await seedCalendar();
		const command = await action('purge', '2025-2026');
		await db
			.update(t.calendarSubscriptions)
			.set({ url: 'https://school.pronote-campus.net/hp/Telechargements/ical/changed.ics' })
			.where(eq(t.calendarSubscriptions.teacherId, ids.teacher));
		await expect(decideAnnualYear(db, ids.teacher, command)).rejects.toMatchObject({ status: 409 });
		const fresh = await action('purge', '2025-2026');
		await db
			.update(t.lessons)
			.set({ recap: 'Updated future-year preparation' })
			.where(eq(t.lessons.id, calendar.lessonId));
		await expect(decideAnnualYear(db, ids.teacher, fresh)).rejects.toMatchObject({ status: 409 });
		expect(await db.select().from(t.calendarSubscriptions)).toHaveLength(1);
	});
	it('rolls calendar deletion back with the annual transaction', async () => {
		await seedCalendar();
		const command = await action('purge', '2025-2026');
		const subscriptions = await db.select().from(t.calendarSubscriptions);
		const lessons = await db.select().from(t.lessons);
		await client.execute(
			"CREATE TRIGGER fail_calendar_receipt BEFORE INSERT ON annual_receipt BEGIN SELECT RAISE(ABORT, 'test rollback'); END"
		);
		await expect(decideAnnualYear(db, ids.teacher, command)).rejects.toBeDefined();
		expect(await db.select().from(t.calendarSubscriptions)).toEqual(subscriptions);
		expect(await db.select().from(t.lessons)).toEqual(lessons);
	});
	it('does not let an in-flight synchronization recreate a purged connection', async () => {
		await seedCalendar();
		let completeFeed!: (events: CalendarOccurrence[]) => void;
		const loadFeed = vi.fn(
			() =>
				new Promise<CalendarOccurrence[]>((resolve) => {
					completeFeed = resolve;
				})
		);
		const sync = syncCalendarIfDue(db, ids.teacher, true, new Date('2026-11-01T08:00:00Z'), loadFeed);
		await vi.waitFor(() => expect(loadFeed).toHaveBeenCalledOnce());
		await decideAnnualYear(db, ids.teacher, await action('purge', '2025-2026'));
		completeFeed([]);
		expect(await sync).toBe(false);
		expect(await db.select().from(t.calendarSubscriptions)).toEqual([]);
		expect(await db.select().from(t.calendarMappings)).toEqual([]);
		expect(await db.select().from(t.calendarLessons)).toEqual([]);
	});
});
async function action(kind: AnnualAction['action'], year = '2026-2027'): Promise<AnnualAction> {
	const data = await getAnnualData(db, ids.teacher, year);
	return {
		academicYear: year,
		action: kind,
		reviewToken: data.selected!.reviewToken,
		requestId: crypto.randomUUID(),
		typedYear: kind === 'purge' ? year : '',
		pdfsKept: kind === 'purge',
		moduleChoices:
			kind === 'purge'
				? [...new Set(data.selected!.contexts.map((context) => context.moduleId))].map((moduleId) => ({
						moduleId,
						decision: 'pause' as const
					}))
				: undefined
	};
}
async function completeClass() {
	const grid = await getGradeGrid(db, ids.module, ids.currentContext);
	for (const student of grid.students)
		for (const assessment of grid.rubric!.assessments) {
			const current = student.corrections.find((row) => row.assessmentId === assessment.id);
			await saveCorrection(db, ids.currentContext, student.id, assessment.id, {
				expectedRevision: current?.revision ?? 0,
				rubricRevision: grid.rubric!.module.revision,
				status: 'graded',
				submissionUrl: null,
				submittedAt: '2026-10-09T12:00:00Z',
				latenessDecision: 'automatic',
				scores: assessment.lines.map((line) => ({ lineId: line.id, points: line.maxPoints }))
			});
		}
}
describe('Annual lifecycle', () => {
	it('does not select a current year implicitly and exposes no private bodies in the review', async () => {
		expect((await getAnnualData(db, ids.teacher)).selected).toBeNull();
		const { selected } = await getAnnualData(db, ids.teacher, '2026-2027');
		expect(selected!.removed).toEqual({
			classes: 1,
			students: 12,
			corrections: 30,
			scores: expect.any(Number),
			comments: 1,
			proposals: 0,
			decisions: 0
		});
		expect(selected!.removed.scores).toBe(
			(
				await db
					.select()
					.from(t.scores)
					.innerJoin(t.corrections, eq(t.scores.correctionId, t.corrections.id))
					.where(eq(t.corrections.contextId, ids.currentContext))
			).length
		);
		expect(selected!.preserved).toEqual({
			modules: 2,
			contexts: 2,
			lessons: 0,
			deadlines: 1,
			publications: 0
		});
		expect(JSON.stringify(selected)).not.toContain('Aline Moreau');
		expect(JSON.stringify(selected)).not.toContain('Teacher-only preparation');
		expect(selected!.reviewToken).toMatch(/^[a-f0-9]{64}$/);
	});
	it('archives classes even without modules and blocks stale manual and MCP writes', async () => {
		await createClass(db, { name: 'Empty Demo', academicYear: '2026-2027' });
		const before = await getModule(db, ids.module);
		const archive = await action('archive');
		await decideAnnualYear(db, ids.teacher, archive);
		expect((await getClassesData(db)).classes.every((row) => row.academicYear !== '2026-2027')).toBe(true);
		expect((await readImportContext(db)).classes.every((row) => row.academicYear !== '2026-2027')).toBe(true);
		await expect(createClass(db, { name: 'Late Demo', academicYear: '2026-2027' })).rejects.toMatchObject({
			status: 409
		});
		await expect(
			addStudents(db, ids.currentClass, { kind: 'add', name: 'Late Student', expectedRevision: 1 })
		).rejects.toMatchObject({ status: 409 });
		await expect(
			updateModule(db, ids.module, { ...editableModule(before), expectedRevision: before.revision })
		).rejects.toMatchObject({ status: 409 });
		await expect(
			saveSemesterComment(db, ids.currentContext, ids.students[0], {
				expectedRevision: 0,
				content: 'Late comment'
			})
		).rejects.toMatchObject({ status: 404 });
		expect(await db.select().from(t.students).where(eq(t.students.classId, ids.currentClass))).toHaveLength(12);
	});
	it('keeps archived results read-only and complete PDFs exportable, then reopens explicitly', async () => {
		await completeClass();
		const before = await getFinalGradeExport(db, ids.currentContext);
		await decideAnnualYear(db, ids.teacher, await action('archive'));
		const history = await getAnnualHistory(db, '2026-2027', ids.currentContext);
		expect(history.grid!.students).toHaveLength(12);
		expect((await getFinalGradeExport(db, ids.currentContext)).students).toEqual(before.students);
		await expect(getGradeGrid(db, ids.module, ids.currentContext)).rejects.toMatchObject({
			status: 404
		});
		await decideAnnualYear(db, ids.teacher, await action('reopen'));
		expect((await getGradeGrid(db, ids.module, ids.currentContext)).students).toHaveLength(12);
		expect((await getClassesData(db, ids.currentClass)).selected).not.toBeNull();
	});
	it('purges exactly a year, cascades private records and retains modules/calendar/publication/auth', async () => {
		const state = await getAnnualData(db, ids.teacher, '2025-2026');
		const oldHistory = await getAnnualHistory(db, '2025-2026', ids.oldContext);
		const modules = await db.select().from(t.modules);
		const publications = await db.select().from(t.modulePublications);
		const auth = await db.select().from(t.user);
		const command = await action('purge', '2025-2026');
		const receipt = await decideAnnualYear(db, ids.teacher, command);
		expect(receipt.removed).toEqual(state.selected!.removed);
		expect(await db.select().from(t.classes).where(eq(t.classes.id, ids.oldClass))).toEqual([]);
		expect(await db.select().from(t.students).where(eq(t.students.id, ids.oldStudent))).toEqual([]);
		expect(await db.select().from(t.corrections).where(eq(t.corrections.contextId, ids.oldContext))).toEqual([]);
		expect(
			await db.select().from(t.correctionProposals).where(eq(t.correctionProposals.contextId, ids.oldContext))
		).toEqual([]);
		expect(await db.select().from(t.semesterComments).where(eq(t.semesterComments.contextId, ids.oldContext))).toEqual(
			[]
		);
		expect(await db.select().from(t.user)).toEqual(auth);
		expect(await db.select().from(t.modulePublications)).toEqual(publications);
		expect((await db.select().from(t.modules)).map((row) => ({ ...row, revision: 0 }))).toEqual(
			modules.map((row) => ({ ...row, revision: 0 }))
		);
		const after = await getAnnualHistory(db, '2025-2026', ids.oldContext);
		expect(after.lessons).toEqual(oldHistory.lessons);
		expect(after.deadlines).toEqual(oldHistory.deadlines);
		expect(after.grid).toBeNull();
		await expect(getFinalGradeExport(db, ids.oldContext)).rejects.toMatchObject({ status: 404 });
		expect((await getGradeGrid(db, ids.module, ids.currentContext)).students).toHaveLength(12);
		expect((await getAnnualData(db, ids.teacher, '2025-2026')).selected!.status).toBe('purged');
		expect(JSON.stringify(receipt)).not.toContain('Old Student');
	});
	it('replays exact lost-response commands without deleting again and refuses key reuse', async () => {
		const command = await action('purge', '2025-2026');
		const first = await decideAnnualYear(db, ids.teacher, command);
		expect(await decideAnnualYear(db, ids.teacher, command)).toEqual(first);
		await expect(decideAnnualYear(db, ids.teacher, { ...command, action: 'archive' })).rejects.toMatchObject({
			status: 409
		});
		await expect(decideAnnualYear(db, ids.teacher, await action('reopen', '2025-2026'))).rejects.toMatchObject({
			status: 409
		});
		await expect(createClass(db, { name: 'Accidental recreation', academicYear: '2025-2026' })).rejects.toMatchObject({
			status: 409
		});
	});
	it('revalidates same-count score changes, new classes and preserved calendar changes', async () => {
		const command = await action('purge');
		await db.update(t.scores).set({ points: 1 }).where(eq(t.scores.lineId, ids.firstLine));
		await expect(decideAnnualYear(db, ids.teacher, command)).rejects.toMatchObject({ status: 409 });
		const newer = await action('purge');
		await createClass(db, { name: 'Added Demo', academicYear: '2026-2027' });
		await expect(decideAnnualYear(db, ids.teacher, newer)).rejects.toMatchObject({ status: 409 });
		const old = await action('purge', '2025-2026');
		await db.update(t.lessons).set({ recap: 'Changed after preview' }).where(eq(t.lessons.contextId, ids.oldContext));
		await expect(decideAnnualYear(db, ids.teacher, old)).rejects.toMatchObject({ status: 409 });
		expect(await db.select().from(t.students).where(eq(t.students.classId, ids.currentClass))).toHaveLength(12);
	});
	it('requires exact year and explicit PDF acknowledgement without requiring all modules graded', async () => {
		const command = await action('purge');
		expect(annualActionSchema.safeParse({ ...command, typedYear: '2025-2026' }).success).toBe(false);
		expect(annualActionSchema.safeParse({ ...command, pdfsKept: false }).success).toBe(false);
		expect(annualActionSchema.safeParse({ ...command, extra: true }).success).toBe(false);
		await expect(decideAnnualYear(db, ids.teacher, { ...command, pdfsKept: false })).rejects.toMatchObject({
			status: 422
		});
		expect((await getAnnualData(db, ids.teacher, '2026-2027')).selected!.contexts.some((row) => !row.pdf.ready)).toBe(
			true
		);
		await expect(decideAnnualYear(db, ids.teacher, command)).resolves.toMatchObject({
			action: 'purge'
		});
	});
	it('rolls back all deletion and detachment if the receipt cannot be recorded', async () => {
		const command = await action('purge');
		await client.execute(
			"CREATE TRIGGER fail_annual_receipt BEFORE INSERT ON annual_receipt BEGIN SELECT RAISE(ABORT, 'test rollback'); END"
		);
		await expect(decideAnnualYear(db, ids.teacher, command)).rejects.toBeDefined();
		expect((await getAnnualData(db, ids.teacher, '2026-2027')).selected!.reviewToken).toBe(command.reviewToken);
		expect((await getGradeGrid(db, ids.module, ids.currentContext)).students).toHaveLength(12);
	});
	it('rejects a mismatched legacy year/class association before destructive review', async () => {
		await db
			.update(t.teachingContexts)
			.set({ academicYear: '2025-2026' })
			.where(eq(t.teachingContexts.id, ids.currentContext));
		await expect(getAnnualData(db, ids.teacher, '2025-2026')).rejects.toMatchObject({ status: 409 });
	});
	it('preserves the pedagogical snapshot privately when pausing and removes the class and private graph', async () => {
		await db
			.update(t.modules)
			.set({ description: 'Fictional published module', objectives: ['Understand the demo'] })
			.where(eq(t.modules.id, ids.module));
		const selected = (await getPublicationReview(db, ids.module, ids.currentContext)).selected!;
		await decidePublication(db, ids.teacher, ids.module, {
			requestId: crypto.randomUUID(),
			contextId: ids.currentContext,
			action: 'publish',
			expectedRevision: selected.publicationRevision,
			moduleRevision: selected.moduleRevision,
			contextRevision: selected.contextRevision,
			classRevision: selected.classRevision,
			confirm: true
		});
		const [proposal] = await db
			.select()
			.from(t.correctionProposals)
			.where(eq(t.correctionProposals.contextId, ids.oldContext));
		if (proposal)
			await db.insert(t.proposalDecisions).values({
				proposalId: proposal.id,
				requestId: crypto.randomUUID(),
				fingerprint: 'fictional',
				receipt: { id: proposal.id, revision: 1, state: 'rejected', commentState: 'none' }
			});
		const before = await getPublicModule(db, ids.currentContext);
		await decideAnnualYear(db, ids.teacher, await action('purge'));
		await expect(getPublicModule(db, ids.currentContext)).rejects.toMatchObject({ status: 404 });
		const [after] = await db
			.select()
			.from(t.modulePublications)
			.where(eq(t.modulePublications.contextId, ids.currentContext));
		expect(after.snapshot).toEqual(before.snapshot);
		await expect(getPublicClass(db, ids.currentClass)).rejects.toMatchObject({ status: 404 });
		expect(
			await db
				.select()
				.from(t.scores)
				.innerJoin(t.corrections, eq(t.scores.correctionId, t.corrections.id))
				.where(eq(t.corrections.contextId, ids.currentContext))
		).toEqual([]);
		// The other year and its decision records remain until its own purge.
		if (proposal)
			expect(
				await db.select().from(t.proposalDecisions).where(eq(t.proposalDecisions.proposalId, proposal.id))
			).toHaveLength(1);
		await decideAnnualYear(db, ids.teacher, await action('purge', '2025-2026'));
		expect(await db.select().from(t.proposalDecisions)).toEqual([]);
	});
});
