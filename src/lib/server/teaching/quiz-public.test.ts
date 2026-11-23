import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import * as t from '../db/schema.js';
import { publicationSnapshotSchema } from '../../domain/publication.js';
import { listPublicQuizzes, requirePublicQuizRun } from './quiz-public.js';
import { getQuizDraft, setQuizArchive } from './quizzes.js';
import { decidePublication, getPublicationReview, getPublicModule } from './publications.js';
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

const publish = async () => {
	await db.insert(t.modulePublications).values({
		contextId: ids.currentContext,
		sourceRevision: 1,
		publishedAt: new Date(),
		snapshot: publicationSnapshotSchema.parse({
			version: 2,
			title: 'Fictional public module',
			description: '',
			className: 'Demo class',
			academicYear: '2026-2027',
			objectives: [],
			resources: [],
			deadlines: [],
			recap: '',
			toDo: '',
			lessonNotes: []
		})
	});
	await db.insert(t.publicModuleLinks).values({
		id: ids.currentContext,
		moduleId: ids.module,
		contextId: ids.currentContext,
		publishedContextId: ids.currentContext,
		enabled: true
	});
};

const createQuiz = async (contextId: string) => {
	const quizId = crypto.randomUUID();
	const lessonId = crypto.randomUUID();
	const groupId = crypto.randomUUID();
	const lineId = crypto.randomUUID();
	const correctOptionId = crypto.randomUUID();
	await db
		.insert(t.lessons)
		.values({ id: lessonId, contextId, title: 'Lesson', startsAt: new Date(), endsAt: new Date() });
	await db.insert(t.rubricGroups).values({ id: groupId, assessmentId: ids.quiz, title: 'Quizzes' });
	await db.insert(t.rubricLines).values({ id: lineId, groupId, assessmentId: ids.quiz, label: 'Quiz', maxPoints: 1 });
	await db.insert(t.quizDrafts).values({
		id: quizId,
		moduleId: ids.module,
		contextId,
		lessonId,
		assessmentId: ids.quiz,
		lineId,
		content: {
			version: 1,
			title: 'Visible quiz title',
			durationSeconds: 120,
			questions: [
				{
					id: crypto.randomUUID(),
					type: 'single',
					prompt: 'Private question before start',
					code: '',
					codeLanguage: '',
					options: [
						{ id: correctOptionId, text: 'Secret answer' },
						{ id: crypto.randomUUID(), text: 'Other' }
					],
					correctOptionIds: [correctOptionId]
				}
			]
		}
	});
	const runId = crypto.randomUUID();
	await db.insert(t.quizRuns).values({
		id: runId,
		quizId,
		contextId,
		teacherId: ids.teacher,
		gradeBaselines: [
			{
				studentId: ids.students[0],
				name: 'Private student name',
				correctionRevision: 7,
				requestId: crypto.randomUUID()
			}
		]
	});
	return { quizId, lessonId, runId, lineId, groupId };
};

describe('public quiz availability', () => {
	it('fails closed for an invalid or unpublished course before exposing quiz data', async () => {
		await expect(listPublicQuizzes(db, ids.currentContext)).rejects.toMatchObject({ status: 404 });
	});
	it('accepts only the validated current public projection and does not expose a roster', async () => {
		await publish();
		expect(await listPublicQuizzes(db, ids.currentContext)).toEqual([]);
		await expect(requirePublicQuizRun(db, ids.currentContext, crypto.randomUUID())).rejects.toMatchObject({
			status: 404
		});
	});
	it('projects only quiz availability metadata without questions, grading baselines or student identities', async () => {
		await publish();
		const { quizId, lessonId, runId } = await createQuiz(ids.currentContext);
		expect(await listPublicQuizzes(db, ids.currentContext)).toEqual([
			{
				id: quizId,
				title: 'Visible quiz title',
				lessonId,
				durationSeconds: 120,
				status: 'lobby',
				runId
			}
		]);
	});
	it('rejects another course room before inspecting its private annual lifecycle', async () => {
		await publish();
		const { runId } = await createQuiz(ids.oldContext);
		await expect(requirePublicQuizRun(db, ids.currentContext, runId)).rejects.toMatchObject({
			status: 404
		});
	});
	it('keeps agent-authored quizzes private until teacher review', async () => {
		await publish();
		const { quizId, runId } = await createQuiz(ids.currentContext);
		await db.update(t.quizDrafts).set({ needsReview: true }).where(eq(t.quizDrafts.id, quizId));
		expect(await listPublicQuizzes(db, ids.currentContext)).toEqual([]);
		await expect(requirePublicQuizRun(db, ids.currentContext, runId)).rejects.toMatchObject({
			status: 404
		});
	});

	it('lists quizzes in lesson order, including two sittings on the same day, with stable ties', async () => {
		await publish();
		const afternoon = await createQuiz(ids.currentContext);
		const morning = await createQuiz(ids.currentContext);
		const sameTime = await createQuiz(ids.currentContext);
		for (const [quiz, hour] of [
			[afternoon, 13],
			[morning, 8],
			[sameTime, 8]
		] as const) {
			const time = new Date(Date.UTC(2026, 11, 3, hour));
			await db.update(t.lessons).set({ startsAt: time, endsAt: time }).where(eq(t.lessons.id, quiz.lessonId));
		}
		const first = [morning, sameTime].sort((a, b) => a.lessonId.localeCompare(b.lessonId));
		expect((await listPublicQuizzes(db, ids.currentContext)).map((item) => item.id)).toEqual([
			...first.map((quiz) => quiz.quizId),
			afternoon.quizId
		]);
	});

	it('archives a closed quiz for students and the next reviewed rubric, preserving teacher history and identical retries', async () => {
		await publish();
		const quiz = await createQuiz(ids.currentContext);
		await db.update(t.quizRuns).set({ status: 'closed' }).where(eq(t.quizRuns.id, quiz.runId));
		const review = (await getPublicationReview(db, ids.module, ids.currentContext)).selected!;
		const publishCommand = {
			requestId: crypto.randomUUID(),
			contextId: ids.currentContext,
			action: 'publish' as const,
			expectedRevision: review.publicationRevision,
			moduleRevision: review.moduleRevision,
			contextRevision: review.contextRevision,
			classRevision: review.classRevision,
			confirm: true as const
		};
		await decidePublication(db, ids.teacher, ids.module, publishCommand);
		const change = {
			id: quiz.quizId,
			moduleId: ids.module,
			contextId: ids.currentContext,
			requestId: crypto.randomUUID(),
			expectedRevision: 1,
			expectedContextRevision: review.contextRevision,
			archived: true
		};
		const receipt = await setQuizArchive(db, ids.teacher, change);
		expect(receipt.contextRevision).toBe(review.contextRevision + 1);
		expect(await listPublicQuizzes(db, ids.currentContext)).toEqual([]);
		await expect(requirePublicQuizRun(db, ids.currentContext, quiz.runId)).rejects.toMatchObject({ status: 404 });
		expect(await getQuizDraft(db, quiz.quizId)).toMatchObject({
			archived: true,
			content: { title: 'Visible quiz title' }
		});
		expect((await db.select().from(t.quizRuns).where(eq(t.quizRuns.id, quiz.runId)))[0].status).toBe('closed');
		const next = (await getPublicationReview(db, ids.module, ids.currentContext)).selected!;
		expect(next.draft!.rubric.some((section) => section.title === 'Quiz Demo')).toBe(false);
		expect(
			(await getPublicModule(db, ids.currentContext)).snapshot.rubric.some((section) => section.title === 'Quiz Demo')
		).toBe(true);
		await expect(
			decidePublication(db, ids.teacher, ids.module, {
				...publishCommand,
				expectedRevision: next.publicationRevision,
				requestId: crypto.randomUUID()
			})
		).rejects.toMatchObject({ status: 409 });
		await decidePublication(db, ids.teacher, ids.module, {
			...publishCommand,
			expectedRevision: next.publicationRevision,
			contextRevision: next.contextRevision,
			requestId: crypto.randomUUID()
		});
		expect(
			(await getPublicModule(db, ids.currentContext)).snapshot.rubric.some((section) => section.title === 'Quiz Demo')
		).toBe(false);
		const restore = {
			...change,
			requestId: crypto.randomUUID(),
			expectedContextRevision: receipt.contextRevision,
			archived: false
		};
		await setQuizArchive(db, ids.teacher, restore);
		expect((await listPublicQuizzes(db, ids.currentContext)).map((item) => item.id)).toEqual([quiz.quizId]);
		expect((await requirePublicQuizRun(db, ids.currentContext, quiz.runId)).id).toBe(quiz.runId);
		expect(await setQuizArchive(db, ids.teacher, change)).toEqual(receipt);
		expect((await getQuizDraft(db, quiz.quizId)).archived).toBe(false);
		await expect(setQuizArchive(db, ids.teacher, { ...change, archived: false })).rejects.toMatchObject({
			status: 409
		});
	});

	it('keeps external and unrelated-context lines when ordering active native quizzes in the public rubric', async () => {
		const late = await createQuiz(ids.currentContext);
		const early = await createQuiz(ids.currentContext);
		const archive = await createQuiz(ids.currentContext);
		const foreign = await createQuiz(ids.oldContext);
		for (const [quiz, label, position] of [
			[late, 'Later', 0],
			[early, 'Earlier', 2],
			[archive, 'Archived', 3],
			[foreign, 'Other class', 4]
		] as const)
			await db
				.update(t.rubricLines)
				.set({ groupId: late.groupId, label, position })
				.where(eq(t.rubricLines.id, quiz.lineId));
		await db.insert(t.rubricLines).values({
			id: crypto.randomUUID(),
			groupId: late.groupId,
			assessmentId: ids.quiz,
			label: 'Wayground',
			maxPoints: 5,
			position: 1
		});
		await db
			.update(t.lessons)
			.set({ startsAt: new Date('2026-11-01'), endsAt: new Date('2026-11-01') })
			.where(eq(t.lessons.id, early.lessonId));
		await db.update(t.quizDrafts).set({ archived: true }).where(eq(t.quizDrafts.id, archive.quizId));
		await db.update(t.quizDrafts).set({ archived: true }).where(eq(t.quizDrafts.id, foreign.quizId));
		const review = (await getPublicationReview(db, ids.module, ids.currentContext)).selected!;
		const groups = review.draft!.rubric.find((section) => section.title === 'Quiz Demo')!.groups;
		expect(groups.flatMap((group) => group.lines.map((line) => line.label))).toEqual([
			'Earlier',
			'Wayground',
			'Later',
			'Other class'
		]);
	});
});
