import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import * as t from '../db/schema.js';
import { readQuizContext, createAgentQuizDraft, patchAgentQuizDraft } from './quizzes.js';
import { getQuizDraft } from '../teaching/quizzes.js';
import type { QuizDraftWrite } from '../../domain/quiz-content.js';

let client: Client;
let db: Database;
let ids: Awaited<ReturnType<typeof seedFoundationFixtures>>;
let input: QuizDraftWrite;

beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedFoundationFixtures(db);
	const lessonId = crypto.randomUUID();
	const groupId = crypto.randomUUID();
	const lineId = crypto.randomUUID();
	const correctId = crypto.randomUUID();
	await db.insert(t.lessons).values({
		id: lessonId,
		contextId: ids.currentContext,
		title: 'Fictional lesson',
		startsAt: new Date('2026-11-03T08:00:00Z'),
		endsAt: new Date('2026-11-03T10:00:00Z')
	});
	await db.insert(t.rubricGroups).values({ id: groupId, assessmentId: ids.quiz, title: 'Quizzes' });
	await db
		.insert(t.rubricLines)
		.values({ id: lineId, assessmentId: ids.quiz, groupId, label: 'Native quiz', maxPoints: 1 });
	input = {
		id: crypto.randomUUID(),
		requestId: crypto.randomUUID(),
		moduleId: ids.module,
		contextId: ids.currentContext,
		lessonId,
		assessmentId: ids.quiz,
		lineId,
		expectedRevision: 0,
		content: {
			version: 1,
			title: 'Fictional quiz',
			durationSeconds: 1200,
			questions: [
				{
					id: crypto.randomUUID(),
					type: 'single',
					prompt: 'Two?',
					code: '1 + 1',
					codeLanguage: 'javascript',
					options: [
						{ id: correctId, text: '2' },
						{ id: crypto.randomUUID(), text: '3' }
					],
					correctOptionIds: [correctId]
				}
			]
		}
	};
});
afterEach(() => client.close());

describe('agent quiz authoring', () => {
	it('returns exact teaching identities with a selected draft and no students, grades or rooms', async () => {
		await createAgentQuizDraft(db, ids.teacher, input);
		const index = await readQuizContext(db, {
			moduleId: ids.module,
			contextId: ids.currentContext
		});
		expect(index.contexts).toEqual([
			expect.objectContaining({
				id: ids.currentContext,
				lessons: [expect.objectContaining({ id: input.lessonId })]
			})
		]);
		expect(index.scoringLines).toEqual([
			expect.objectContaining({ assessmentId: ids.quiz, lineId: input.lineId, maxPoints: 1 })
		]);
		expect(index.quizzes).toEqual([
			expect.objectContaining({ id: input.id, revision: 1, needsReview: true, frozen: false })
		]);
		expect(index.quiz).toBeNull();
		const selected = await readQuizContext(db, { moduleId: ids.module, quizId: input.id });
		expect(selected.quiz?.content).toEqual(input.content);
		for (const forbidden of [
			'Student Demo',
			'Teacher-only preparation',
			'"students"',
			'"scores"',
			'"gradeBaselines"',
			'"requestId"'
		])
			expect(JSON.stringify(selected)).not.toContain(forbidden);
		await expect(readQuizContext(db, { moduleId: ids.secondModule, quizId: input.id })).rejects.toMatchObject({
			status: 404
		});
	});

	it('keeps agent edits private, marked for review and exactly retryable without changing the rubric', async () => {
		const before = await db.select().from(t.rubricLines);
		const first = await createAgentQuizDraft(db, ids.teacher, input);
		expect(await createAgentQuizDraft(db, ids.teacher, input)).toEqual(first);
		const patch = {
			moduleId: ids.module,
			id: input.id,
			requestId: crypto.randomUUID(),
			expectedRevision: 1,
			patch: { questions: [{ id: input.content.questions[0].id, prompt: 'Reworded' }] }
		};
		const updated = await patchAgentQuizDraft(db, ids.teacher, patch);
		expect(await patchAgentQuizDraft(db, ids.teacher, patch)).toEqual(updated);
		expect(await getQuizDraft(db, input.id)).toMatchObject({
			revision: 2,
			needsReview: true,
			content: {
				questions: [
					expect.objectContaining({
						prompt: 'Reworded',
						code: '1 + 1',
						options: input.content.questions[0].options
					})
				]
			}
		});
		expect(await createAgentQuizDraft(db, ids.teacher, input)).toEqual(first);
		expect(await db.select().from(t.rubricLines)).toEqual(before);
		expect(await db.select().from(t.quizRuns)).toEqual([]);
		await expect(patchAgentQuizDraft(db, ids.teacher, { ...patch, moduleId: ids.secondModule })).rejects.toMatchObject({
			status: 404
		});
		await expect(
			patchAgentQuizDraft(db, ids.teacher, { ...patch, requestId: crypto.randomUUID() })
		).rejects.toMatchObject({ status: 409 });
		await db.update(t.quizDrafts).set({ needsReview: false }).where(eq(t.quizDrafts.id, input.id));
		await patchAgentQuizDraft(db, ids.teacher, {
			...patch,
			requestId: crypto.randomUUID(),
			expectedRevision: 2
		});
		expect((await getQuizDraft(db, input.id)).needsReview).toBe(true);
	});
});
