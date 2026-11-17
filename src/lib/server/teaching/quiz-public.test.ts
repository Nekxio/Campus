import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import * as t from '../db/schema.js';
import { publicationSnapshotSchema } from '../../domain/publication.js';
import { listPublicQuizzes, requirePublicQuizRun } from './quiz-public.js';
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
	return { quizId, lessonId, runId };
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
});
