import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import * as t from '../db/schema.js';
import { saveQuizDraft, patchQuizDraft, getQuizDraft, applyQuizGrade } from './quizzes.js';
import type { QuizContent, QuizDraftWrite, QuizGradeWrite } from '../../domain/quiz-content.js';

let client: Client;
let db: Database;
let ids: Awaited<ReturnType<typeof seedFoundationFixtures>>;
let input: QuizDraftWrite;
let correctionId: string;
let otherLineId: string;

const content = (): QuizContent => {
	const optionId = crypto.randomUUID();
	return {
		version: 1,
		title: 'Fictional lesson quiz',
		durationSeconds: 1200,
		questions: [
			{
				id: crypto.randomUUID(),
				type: 'single',
				prompt: 'What does this code return?',
				code: '1 + 1',
				codeLanguage: 'javascript',
				options: [
					{ id: optionId, text: '2' },
					{ id: crypto.randomUUID(), text: '11' }
				],
				correctOptionIds: [optionId]
			}
		]
	};
};

const run = async (sourceRunId: string | null = null) => {
	const id = crypto.randomUUID();
	await db.insert(t.quizRuns).values({
		id,
		quizId: input.id,
		contextId: ids.currentContext,
		teacherId: ids.teacher,
		status: 'closed',
		sourceRunId
	});
	return id;
};

const grade = (runId: string, changes: Partial<QuizGradeWrite> = {}): QuizGradeWrite => ({
	requestId: crypto.randomUUID(),
	quizId: input.id,
	runId,
	studentId: ids.students[0],
	expectedCorrectionRevision: 1,
	points: 1,
	source: 'attempt',
	...changes
});

beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedFoundationFixtures(db);
	const lessonId = crypto.randomUUID();
	const groupId = crypto.randomUUID();
	const lineId = crypto.randomUUID();
	correctionId = crypto.randomUUID();
	otherLineId = crypto.randomUUID();
	await db.insert(t.lessons).values({
		id: lessonId,
		contextId: ids.currentContext,
		title: 'Fictional lesson',
		startsAt: new Date('2026-11-03T08:00:00Z'),
		endsAt: new Date('2026-11-03T10:00:00Z')
	});
	await db.insert(t.rubricGroups).values({ id: groupId, assessmentId: ids.quiz, title: 'Quizzes' });
	await db.insert(t.rubricLines).values([
		{ id: lineId, assessmentId: ids.quiz, groupId, label: 'Native quiz', maxPoints: 1 },
		{ id: otherLineId, assessmentId: ids.quiz, groupId, label: 'Existing quiz', maxPoints: 10 }
	]);
	await db.insert(t.corrections).values({
		id: correctionId,
		moduleId: ids.module,
		contextId: ids.currentContext,
		studentId: ids.students[0],
		assessmentId: ids.quiz,
		status: 'to_evaluate'
	});
	await db.insert(t.scores).values({
		correctionId,
		assessmentId: ids.quiz,
		lineId: otherLineId,
		points: 7
	});
	input = {
		requestId: crypto.randomUUID(),
		id: crypto.randomUUID(),
		moduleId: ids.module,
		contextId: ids.currentContext,
		lessonId,
		assessmentId: ids.quiz,
		lineId,
		expectedRevision: 0,
		content: content()
	};
});

afterEach(() => client.close());

describe('private native quiz drafts', () => {
	it('saves a private draft with a durable identity and replays the original receipt after a later edit', async () => {
		const first = await saveQuizDraft(db, ids.teacher, input);
		expect(first.revision).toBe(1);
		const changed = await saveQuizDraft(db, ids.teacher, {
			...input,
			requestId: crypto.randomUUID(),
			expectedRevision: 1,
			content: { ...input.content, title: 'Reviewed title' }
		});
		expect(changed.revision).toBe(2);
		expect(await saveQuizDraft(db, ids.teacher, input)).toEqual(first);
		expect((await getQuizDraft(db, input.id)).content.title).toBe('Reviewed title');
		await expect(
			saveQuizDraft(db, ids.teacher, {
				...input,
				content: { ...input.content, title: 'Different replay' }
			})
		).rejects.toMatchObject({ status: 409 });
		expect(await db.select().from(t.modulePublications)).toHaveLength(1);
	});

	it('patches only supplied content while retaining code and omitted questions', async () => {
		await saveQuizDraft(db, ids.teacher, input);
		await patchQuizDraft(db, ids.teacher, {
			requestId: crypto.randomUUID(),
			id: input.id,
			expectedRevision: 1,
			patch: { questions: [{ id: input.content.questions[0].id, prompt: 'Revised wording' }] }
		});
		expect((await getQuizDraft(db, input.id)).content.questions[0]).toEqual({
			...input.content.questions[0],
			prompt: 'Revised wording'
		});
	});

	it('rejects stale edits, cross-module lessons, foreign scoring lines and mismatched maxima atomically', async () => {
		await saveQuizDraft(db, ids.teacher, input);
		await expect(saveQuizDraft(db, ids.teacher, { ...input, requestId: crypto.randomUUID() })).rejects.toMatchObject({
			status: 409
		});
		for (const changed of [{ contextId: ids.secondContext }, { lineId: ids.firstLine }, { lineId: otherLineId }])
			await expect(
				saveQuizDraft(db, ids.teacher, {
					...input,
					...changed,
					requestId: crypto.randomUUID(),
					expectedRevision: 1
				})
			).rejects.toMatchObject({ status: 422 });
		expect((await getQuizDraft(db, input.id)).revision).toBe(1);
	});

	it('keeps content after annual student removal and refuses archived writes', async () => {
		await saveQuizDraft(db, ids.teacher, input);
		await db
			.update(t.teachingContexts)
			.set({ archivedAt: new Date() })
			.where(eq(t.teachingContexts.id, ids.currentContext));
		await expect(
			saveQuizDraft(db, ids.teacher, {
				...input,
				requestId: crypto.randomUUID(),
				expectedRevision: 1
			})
		).rejects.toMatchObject({ status: 409 });
		await db.delete(t.classes).where(eq(t.classes.id, ids.currentClass));
		expect((await getQuizDraft(db, input.id)).content).toEqual(input.content);
	});

	it('freezes content as soon as a room exists, including an unopened lobby', async () => {
		const receipt = await saveQuizDraft(db, ids.teacher, input);
		const runId = await run();
		await db.update(t.quizRuns).set({ status: 'lobby' }).where(eq(t.quizRuns.id, runId));
		await expect(
			patchQuizDraft(db, ids.teacher, {
				id: input.id,
				requestId: crypto.randomUUID(),
				expectedRevision: 1,
				patch: { title: 'Changed after room creation' }
			})
		).rejects.toMatchObject({ status: 409 });
		expect(await saveQuizDraft(db, ids.teacher, input)).toEqual(receipt);
		expect((await getQuizDraft(db, input.id)).content).toEqual(input.content);
	});
});

describe('native quiz grade reports', () => {
	beforeEach(async () => {
		await saveQuizDraft(db, ids.teacher, input);
	});

	it('reports one quiz total without changing another quiz or another assessment', async () => {
		const projectBefore = await db.select().from(t.scores).where(eq(t.scores.correctionId, ids.correction));
		const command = grade(await run());
		const receipt = await applyQuizGrade(db, ids.teacher, command);
		expect(receipt.correctionRevision).toBe(2);
		expect(await db.select().from(t.scores).where(eq(t.scores.correctionId, correctionId))).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ lineId: otherLineId, points: 7 }),
				expect.objectContaining({ lineId: input.lineId, points: 1 })
			])
		);
		expect((await db.select().from(t.corrections).where(eq(t.corrections.id, correctionId)))[0].status).toBe('graded');
		expect(await db.select().from(t.scores).where(eq(t.scores.correctionId, ids.correction))).toEqual(projectBefore);
		expect(await applyQuizGrade(db, ids.teacher, command)).toEqual(receipt);
	});

	it('rejects replacement of a manually entered target, including a real zero', async () => {
		await db.insert(t.scores).values({ correctionId, assessmentId: ids.quiz, lineId: input.lineId, points: 0 });
		await expect(applyQuizGrade(db, ids.teacher, grade(await run()))).rejects.toMatchObject({
			status: 409
		});
		expect(await db.select().from(t.quizGradeReports)).toHaveLength(0);
	});

	it('never uses another assessment receipt to cover a manual correction revision', async () => {
		const assessmentId = crypto.randomUUID();
		const groupId = crypto.randomUUID();
		const lineId = crypto.randomUUID();
		await db
			.insert(t.assessments)
			.values({ id: assessmentId, moduleId: ids.module, title: 'Separate quizzes', kind: 'quiz' });
		await db.insert(t.rubricGroups).values({ id: groupId, assessmentId, title: 'Separate group' });
		await db.insert(t.rubricLines).values({ id: lineId, assessmentId, groupId, label: 'Separate quiz', maxPoints: 1 });
		const otherQuiz = { ...input, id: crypto.randomUUID(), requestId: crypto.randomUUID(), assessmentId, lineId };
		await saveQuizDraft(db, ids.teacher, otherQuiz);
		const runId = crypto.randomUUID();
		await db.insert(t.quizRuns).values({
			id: runId,
			quizId: otherQuiz.id,
			contextId: ids.currentContext,
			teacherId: ids.teacher,
			status: 'closed'
		});
		const otherReceipt = await applyQuizGrade(
			db,
			ids.teacher,
			grade(runId, { quizId: otherQuiz.id, expectedCorrectionRevision: 0 })
		);
		expect(otherReceipt.correctionRevision).toBe(1);
		await expect(
			applyQuizGrade(db, ids.teacher, grade(await run(), { expectedCorrectionRevision: 0 }))
		).rejects.toMatchObject({ status: 409 });
		expect(await db.select().from(t.quizGradeReceipts)).toHaveLength(1);
		expect((await db.select().from(t.corrections).where(eq(t.corrections.id, correctionId)))[0].revision).toBe(1);
		expect(await db.select().from(t.scores).where(eq(t.scores.lineId, input.lineId))).toHaveLength(0);
	});

	it('replaces only an unchanged recorded absence zero in an explicitly linked retake', async () => {
		const originalRunId = await run();
		const absent = grade(originalRunId, { source: 'absence', points: 0 });
		const firstReceipt = await applyQuizGrade(db, ids.teacher, absent);
		const retake = grade(await run(originalRunId), { expectedCorrectionRevision: 2 });
		await applyQuizGrade(db, ids.teacher, retake);
		expect(await applyQuizGrade(db, ids.teacher, absent)).toEqual(firstReceipt);
		expect((await db.select().from(t.scores).where(eq(t.scores.lineId, input.lineId)))[0].points).toBe(1);
		expect((await db.select().from(t.quizGradeReports))[0].source).toBe('attempt');
	});

	it('carries repeated absences forward so the next linked retake can replace the untouched zero', async () => {
		const originalRunId = await run();
		const absent = grade(originalRunId, { source: 'absence', points: 0 });
		const originalReceipt = await applyQuizGrade(db, ids.teacher, absent);
		const retakeRunId = await run(originalRunId);
		const absentAgain = grade(retakeRunId, {
			expectedCorrectionRevision: originalReceipt.correctionRevision,
			source: 'absence',
			points: 0
		});
		const retakeReceipt = await applyQuizGrade(db, ids.teacher, absentAgain);
		expect((await db.select().from(t.quizGradeReports))[0]).toMatchObject({
			runId: retakeRunId,
			source: 'absence',
			points: 0,
			correctionRevision: retakeReceipt.correctionRevision
		});
		const nextRetake = grade(await run(retakeRunId), {
			expectedCorrectionRevision: retakeReceipt.correctionRevision
		});
		await applyQuizGrade(db, ids.teacher, nextRetake);
		expect(await applyQuizGrade(db, ids.teacher, absent)).toEqual(originalReceipt);
		expect(await applyQuizGrade(db, ids.teacher, absentAgain)).toEqual(retakeReceipt);
		expect((await db.select().from(t.quizGradeReports))[0]).toMatchObject({
			runId: nextRetake.runId,
			source: 'attempt',
			points: 1
		});
	});

	it.each(['attempt', 'absence', 'stopped'] as const)(
		'protects a manual correction after an absence from a %s transfer, even when it keeps the same zero',
		async (source) => {
			const originalRunId = await run();
			await applyQuizGrade(db, ids.teacher, grade(originalRunId, { source: 'absence', points: 0 }));
			await db.update(t.corrections).set({ revision: 3 }).where(eq(t.corrections.id, correctionId));
			await expect(
				applyQuizGrade(
					db,
					ids.teacher,
					grade(await run(originalRunId), { expectedCorrectionRevision: 3, source, points: 0 })
				)
			).rejects.toMatchObject({ status: 409 });
			expect((await db.select().from(t.scores).where(eq(t.scores.lineId, input.lineId)))[0].points).toBe(0);
		}
	);

	it('makes a stopped retake zero definitive instead of retaining its replaceable absence', async () => {
		const originalRunId = await run();
		await applyQuizGrade(db, ids.teacher, grade(originalRunId, { source: 'absence', points: 0 }));
		const retakeId = await run(originalRunId);
		await applyQuizGrade(
			db,
			ids.teacher,
			grade(retakeId, {
				expectedCorrectionRevision: 2,
				source: 'stopped',
				points: 0
			})
		);
		expect((await db.select().from(t.quizGradeReports))[0].source).toBe('stopped');
		await expect(
			applyQuizGrade(
				db,
				ids.teacher,
				grade(await run(retakeId), {
					expectedCorrectionRevision: 3
				})
			)
		).rejects.toMatchObject({ status: 409 });
	});

	it('allows a linked absence retake after another native quiz updates the same section', async () => {
		const originalRunId = await run();
		await applyQuizGrade(db, ids.teacher, grade(originalRunId, { source: 'absence', points: 0 }));
		const secondQuiz = {
			...input,
			id: crypto.randomUUID(),
			requestId: crypto.randomUUID(),
			lineId: otherLineId
		};
		await db.update(t.rubricLines).set({ maxPoints: 1 }).where(eq(t.rubricLines.id, otherLineId));
		await db.delete(t.scores).where(eq(t.scores.lineId, otherLineId));
		await saveQuizDraft(db, ids.teacher, secondQuiz);
		const secondRunId = crypto.randomUUID();
		await db.insert(t.quizRuns).values({
			id: secondRunId,
			quizId: secondQuiz.id,
			contextId: ids.currentContext,
			teacherId: ids.teacher,
			status: 'closed'
		});
		await applyQuizGrade(db, ids.teacher, grade(secondRunId, { quizId: secondQuiz.id, expectedCorrectionRevision: 2 }));
		await applyQuizGrade(db, ids.teacher, grade(await run(originalRunId), { expectedCorrectionRevision: 3 }));
		expect((await db.select().from(t.scores).where(eq(t.scores.lineId, input.lineId)))[0].points).toBe(1);
		expect((await db.select().from(t.scores).where(eq(t.scores.lineId, otherLineId)))[0].points).toBe(1);
	});

	it('does not turn an attempted or stopped zero into a replaceable absence', async () => {
		for (const [index, source] of ['attempt', 'stopped'].entries()) {
			const studentId = ids.students[index];
			const originalRunId = await run();
			const expectedCorrectionRevision = index === 0 ? 1 : 0;
			const first = await applyQuizGrade(
				db,
				ids.teacher,
				grade(originalRunId, {
					studentId,
					source: source as 'attempt' | 'stopped',
					points: 0,
					expectedCorrectionRevision
				})
			);
			await expect(
				applyQuizGrade(
					db,
					ids.teacher,
					grade(await run(originalRunId), {
						studentId,
						expectedCorrectionRevision: first.correctionRevision
					})
				)
			).rejects.toMatchObject({ status: 409 });
		}
	});

	it('keeps other pending quiz lines blank and retains rubric review flags', async () => {
		await db.delete(t.scores).where(eq(t.scores.lineId, otherLineId));
		await db.update(t.corrections).set({ needsReview: true }).where(eq(t.corrections.id, correctionId));
		await applyQuizGrade(db, ids.teacher, grade(await run()));
		const [saved] = await db.select().from(t.corrections).where(eq(t.corrections.id, correctionId));
		expect(saved).toMatchObject({ status: 'to_evaluate', needsReview: true });
		expect(await db.select().from(t.scores).where(eq(t.scores.lineId, otherLineId))).toHaveLength(0);
	});

	it('rejects foreign roster members, changed maxima, stale revisions and impossible points', async () => {
		const runId = await run();
		await expect(applyQuizGrade(db, ids.teacher, grade(runId, { studentId: ids.oldStudent }))).rejects.toMatchObject({
			status: 404
		});
		await expect(
			applyQuizGrade(db, ids.teacher, grade(runId, { expectedCorrectionRevision: 0 }))
		).rejects.toMatchObject({ status: 409 });
		await expect(applyQuizGrade(db, ids.teacher, grade(runId, { points: 2 }))).rejects.toMatchObject({ status: 422 });
		await db.update(t.rubricLines).set({ maxPoints: 2 }).where(eq(t.rubricLines.id, input.lineId));
		await expect(applyQuizGrade(db, ids.teacher, grade(runId))).rejects.toMatchObject({
			status: 409
		});
		expect(await db.select().from(t.quizGradeReports)).toHaveLength(0);
	});
});
