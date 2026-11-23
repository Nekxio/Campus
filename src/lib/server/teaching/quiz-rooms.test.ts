import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import * as t from '../db/schema.js';
import { applyQuizGrade, saveQuizDraft } from './quizzes.js';
import { getDetailedCorrection, saveCorrection } from './grading.js';
import type { CorrectionWrite } from '../../domain/grading.js';
import type { QuizGradeWrite } from '../../domain/quiz-content.js';
import { decidePublication, getPublicationReview } from './publications.js';
import { requirePublicQuizRun } from './quiz-public.js';
import {
	applyQuizSessionCommand,
	createQuizRetakeSession,
	createQuizSession,
	projectQuizSessionForTeacher,
	type QuizSessionState
} from '../../domain/quiz-session.js';
import {
	openQuizRoom,
	commandQuizRoom,
	synchronizeQuizGrades,
	getQuizRoomCandidates,
	type QuizRoomResolver
} from './quiz-rooms.js';

let client: Client;
let db: Database;
let ids: Awaited<ReturnType<typeof seedFoundationFixtures>>;
let quizId: string;
let states: Map<string, QuizSessionState>;
const now = 1_800_000_000_000;
const roomFor: QuizRoomResolver = (id) => ({
	initialize: async (input) => {
		if (!states.has(id)) states.set(id, createQuizSession(input));
		return projectQuizSessionForTeacher(states.get(id)!, now);
	},
	teacherState: async () => {
		const state = states.get(id);
		if (!state) throw new Error('quiz_room_not_initialized');
		return projectQuizSessionForTeacher(state, now);
	},
	command: async (actor, command) => {
		const result = applyQuizSessionCommand(states.get(id)!, actor, command, now);
		states.set(id, result.state);
		return { receipt: result.receipt, view: projectQuizSessionForTeacher(result.state, now) };
	},
	createRetake: async (input) => {
		const state = createQuizRetakeSession(states.get(id)!, input);
		if (!states.has(state.id)) states.set(state.id, state);
		return projectQuizSessionForTeacher(states.get(state.id)!, now);
	},
	reportGrade: (input: QuizGradeWrite) => applyQuizGrade(db, ids.teacher, input)
});

const simulateSqlRequestBudget = (databaseClient: Client) => {
	let operations = 0;
	const wrap = <Driver extends object>(driver: Driver): Driver =>
		new Proxy(driver, {
			get: (target, property) => {
				const value = Reflect.get(target, property, target);
				if (typeof value !== 'function') return value;
				if (property === 'transaction')
					return async (...args: unknown[]) => wrap(await Reflect.apply(value, target, args));
				return (...args: unknown[]) => {
					// Simulated external SQL requests; SQLite itself has no Worker invocation limit.
					if (property === 'execute' || property === 'commit') {
						operations++;
						if (operations > 50) throw new Error('Simulated SQL request budget exceeded');
					}
					return Reflect.apply(value, target, args);
				};
			}
		});
	return { database: createDatabase(wrap(databaseClient)), operations: () => operations };
};

beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedFoundationFixtures(db);
	states = new Map();
	quizId = crypto.randomUUID();
	const lessonId = crypto.randomUUID();
	const groupId = crypto.randomUUID();
	const lineId = crypto.randomUUID();
	const correctId = crypto.randomUUID();
	await db.insert(t.lessons).values({
		id: lessonId,
		contextId: ids.currentContext,
		title: 'Fictional room lesson',
		startsAt: new Date(now),
		endsAt: new Date(now + 3600000)
	});
	await db.insert(t.rubricGroups).values({ id: groupId, assessmentId: ids.quiz, title: 'Quizzes' });
	await db.insert(t.rubricLines).values({
		id: lineId,
		assessmentId: ids.quiz,
		groupId,
		label: 'Room quiz',
		maxPoints: 1
	});
	await saveQuizDraft(db, ids.teacher, {
		id: quizId,
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
					prompt: 'Which value?',
					code: '',
					codeLanguage: '',
					options: [
						{ id: correctId, text: 'Correct' },
						{ id: crypto.randomUUID(), text: 'Other' }
					],
					correctOptionIds: [correctId]
				}
			]
		}
	});
	const { selected } = await getPublicationReview(db, ids.module, ids.currentContext);
	await decidePublication(db, ids.teacher, ids.module, {
		requestId: crypto.randomUUID(),
		contextId: ids.currentContext,
		action: 'publish',
		expectedRevision: selected!.publicationRevision,
		moduleRevision: selected!.moduleRevision,
		contextRevision: selected!.contextRevision,
		classRevision: selected!.classRevision,
		confirm: true
	});
});
afterEach(() => {
	vi.restoreAllMocks();
	client.close();
});
const opening = () => ({ id: crypto.randomUUID(), quizId, expectedQuizRevision: 1 });
const close = (id: string) =>
	commandQuizRoom(db, roomFor, ids.teacher, id, {
		type: 'close',
		requestId: crypto.randomUUID()
	});

it('keeps archived quizzes out of new sittings and retakes while preserving the closed teacher room', async () => {
	await db.update(t.quizDrafts).set({ archived: true }).where(eq(t.quizDrafts.id, quizId));
	await expect(openQuizRoom(db, roomFor, ids.teacher, opening(), now)).rejects.toMatchObject({ status: 409 });
	await db.update(t.quizDrafts).set({ archived: false }).where(eq(t.quizDrafts.id, quizId));
	const source = await finishFirstRoom();
	await db.update(t.quizDrafts).set({ archived: true }).where(eq(t.quizDrafts.id, quizId));
	expect(await getQuizRoomCandidates(db, source.id, ids.teacher)).toEqual([]);
	await expect(
		openQuizRoom(
			db,
			roomFor,
			ids.teacher,
			{
				...opening(),
				sourceRunId: source.id,
				participantIds: [ids.students[0]]
			},
			now
		)
	).rejects.toMatchObject({ status: 409 });
	expect((await roomFor(source.id).teacherState()).status).toBe('closed');
});

const addStudent = async (name: string) => {
	const id = crypto.randomUUID();
	await db.insert(t.students).values({ id, classId: ids.currentClass, name, position: 20 });
	return id;
};

const finishFirstRoom = async () => {
	const input = opening();
	await openQuizRoom(db, roomFor, ids.teacher, input, now);
	await commandQuizRoom(db, roomFor, ids.teacher, input.id, { type: 'start', requestId: crypto.randomUUID() });
	await close(input.id);
	return input;
};

const addQuiz = async () => {
	const [quiz] = await db.select().from(t.quizDrafts).where(eq(t.quizDrafts.id, quizId));
	const [line] = await db.select().from(t.rubricLines).where(eq(t.rubricLines.id, quiz.lineId));
	const id = crypto.randomUUID();
	const lineId = crypto.randomUUID();
	await db.insert(t.rubricLines).values({
		id: lineId,
		assessmentId: ids.quiz,
		groupId: line.groupId,
		label: 'Independent quiz',
		maxPoints: 1
	});
	await saveQuizDraft(db, ids.teacher, {
		id,
		requestId: crypto.randomUUID(),
		moduleId: ids.module,
		contextId: ids.currentContext,
		lessonId: quiz.lessonId!,
		assessmentId: ids.quiz,
		lineId,
		expectedRevision: 0,
		content: quiz.content
	});
	return id;
};

const startRoom = async (input: Parameters<typeof openQuizRoom>[3]) => {
	await openQuizRoom(db, roomFor, ids.teacher, input, now);
	await commandQuizRoom(db, roomFor, ids.teacher, input.id, { type: 'start', requestId: crypto.randomUUID() });
	return input;
};

const saveManualCorrection = async (points: number | null, status: CorrectionWrite['status'] = 'to_evaluate') => {
	const { rubric, students } = await getDetailedCorrection(db, ids.currentContext, ids.students[0]);
	const correction = students
		.find((student) => student.id === ids.students[0])!
		.corrections.find((entry) => entry.assessmentId === ids.quiz);
	const assessment = rubric.assessments.find((entry) => entry.id === ids.quiz)!;
	const [quiz] = await db.select().from(t.quizDrafts).where(eq(t.quizDrafts.id, quizId));
	return saveCorrection(db, ids.currentContext, ids.students[0], ids.quiz, {
		expectedRevision: correction?.revision ?? 0,
		rubricRevision: rubric.module.revision,
		status,
		submissionUrl: 'https://example.com/fictional-submission',
		submittedAt: '2026-11-03T08:00:00Z',
		latenessDecision: 'automatic',
		scores: assessment.lines.map((line) => ({
			lineId: line.id,
			points:
				line.id === quiz.lineId
					? points
					: (correction?.scores.find((score) => score.lineId === line.id)?.points ?? null)
		}))
	});
};

describe('quiz room orchestration', () => {
	it.each([-7, 0, 7])('opens and starts a quiz with its lesson scheduled %i days from today', async (days) => {
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const [quiz] = await db.select().from(t.quizDrafts).where(eq(t.quizDrafts.id, quizId));
		const startsAt = new Date(now + days * 24 * 3600000);
		await db
			.update(t.lessons)
			.set({ startsAt, endsAt: new Date(startsAt.getTime() + 3600000) })
			.where(eq(t.lessons.id, quiz.lessonId!));
		const { selected } = await getPublicationReview(db, ids.module, ids.currentContext);
		await decidePublication(db, ids.teacher, ids.module, {
			requestId: crypto.randomUUID(),
			contextId: ids.currentContext,
			action: 'publish',
			expectedRevision: selected!.publicationRevision,
			moduleRevision: selected!.moduleRevision,
			contextRevision: selected!.contextRevision,
			classRevision: selected!.classRevision,
			confirm: true
		});
		const input = opening();
		expect((await openQuizRoom(db, roomFor, ids.teacher, input, now)).status).toBe('lobby');
		const started = await commandQuizRoom(db, roomFor, ids.teacher, input.id, {
			type: 'start',
			requestId: crypto.randomUUID()
		});
		expect(started.view.status).toBe('running');
		expect((await requirePublicQuizRun(db, ids.currentContext, input.id)).status).toBe('running');
		const [lesson] = await db.select().from(t.lessons).where(eq(t.lessons.id, quiz.lessonId!));
		expect(lesson.startsAt).toEqual(startsAt);
	});

	it('transfers a twelve-student room within separate simulated fifty-request invocation budgets', async () => {
		const input = await startRoom(opening());
		const parent = simulateSqlRequestBudget(client);
		const childOperations: number[] = [];
		const budgetedRoomFor: QuizRoomResolver = (id) => ({
			...roomFor(id),
			reportGrade: async (write: QuizGradeWrite) => {
				const child = simulateSqlRequestBudget(client);
				try {
					return await applyQuizGrade(child.database, ids.teacher, write);
				} finally {
					childOperations.push(child.operations());
				}
			}
		});
		const result = await commandQuizRoom(parent.database, budgetedRoomFor, ids.teacher, input.id, {
			type: 'close',
			requestId: crypto.randomUUID()
		});
		expect(result.grades).toEqual({ reported: 12, conflicts: [] });
		expect(parent.operations()).toBeGreaterThan(0);
		expect(parent.operations()).toBeLessThanOrEqual(50);
		expect(childOperations).toHaveLength(12);
		expect(childOperations.every((operations) => operations > 0 && operations <= 50)).toBe(true);
		expect(await db.select().from(t.quizGradeReports)).toHaveLength(12);
		expect(await db.select().from(t.quizGradeReceipts)).toHaveLength(12);
	});

	it('retries the same close after committed grade responses are lost without revising marks twice', async () => {
		const input = await startRoom(opening());
		const [run] = await db.select().from(t.quizRuns).where(eq(t.quizRuns.id, input.id));
		const [quiz] = await db.select().from(t.quizDrafts).where(eq(t.quizDrafts.id, quizId));
		const readTransfers = async () => ({
			reports: await db.select().from(t.quizGradeReports),
			receipts: await db.select().from(t.quizGradeReceipts),
			corrections: await db.select().from(t.corrections).where(eq(t.corrections.assessmentId, ids.quiz)),
			scores: await db.select().from(t.scores).where(eq(t.scores.lineId, quiz.lineId))
		});
		let committed = 0;
		let loseResponse = true;
		const interruptedRoomFor: QuizRoomResolver = (id) => ({
			...roomFor(id),
			reportGrade: async (write: QuizGradeWrite) => {
				const receipt = await applyQuizGrade(db, ids.teacher, write);
				committed++;
				if (loseResponse && committed === 4) {
					loseResponse = false;
					throw new Error('Fictional lost response after committed grade transfer');
				}
				return receipt;
			}
		});
		const command = { type: 'close' as const, requestId: crypto.randomUUID() };
		await expect(commandQuizRoom(db, interruptedRoomFor, ids.teacher, input.id, command)).rejects.toThrow(
			'lost response after committed grade transfer'
		);
		expect(states.get(input.id)?.status).toBe('closed');
		const partial = await readTransfers();
		expect(partial.reports).toHaveLength(4);
		expect(partial.receipts).toHaveLength(4);
		expect(partial.scores).toHaveLength(4);
		const recovered = await commandQuizRoom(db, interruptedRoomFor, ids.teacher, input.id, command);
		expect(recovered.grades).toEqual({ reported: 12, conflicts: [] });
		const complete = await readTransfers();
		expect(complete.reports).toHaveLength(12);
		expect(complete.receipts).toHaveLength(12);
		expect(complete.corrections).toHaveLength(12);
		expect(complete.scores).toHaveLength(12);
		expect(complete.reports).toEqual(expect.arrayContaining(partial.reports));
		expect(complete.receipts).toEqual(expect.arrayContaining(partial.receipts));
		expect(complete.corrections).toEqual(expect.arrayContaining(partial.corrections));
		expect(complete.scores).toEqual(expect.arrayContaining(partial.scores));
		expect(complete.reports.map((report) => report.studentId).sort()).toEqual(ids.students.toSorted());
		expect(complete.reports.every((report) => report.points === 0 && report.source === 'absence')).toBe(true);
		expect(complete.scores.every((score) => score.points === 0)).toBe(true);
		expect(complete.receipts.map((receipt) => receipt.requestId).sort()).toEqual(
			run.gradeBaselines.map((baseline) => baseline.requestId).sort()
		);
		for (const correction of complete.corrections)
			expect(correction.revision).toBe(
				run.gradeBaselines.find((baseline) => baseline.studentId === correction.studentId)!.correctionRevision + 1
			);
		const replayed = await commandQuizRoom(db, interruptedRoomFor, ids.teacher, input.id, command);
		expect(replayed.receipt).toEqual(recovered.receipt);
		expect(replayed.grades).toEqual(recovered.grades);
		expect(await readTransfers()).toEqual(complete);
	});

	it.each([false, true])(
		'transfers independent rooms from the same baseline in either close order (reverse: %s)',
		async (reverse) => {
			const rooms = [opening(), { ...opening(), quizId: await addQuiz() }];
			for (const room of rooms) {
				await openQuizRoom(db, roomFor, ids.teacher, room, now);
				const actor = {
					kind: 'participant' as const,
					participantId: ids.students[0],
					credentialHash: 'a'.repeat(64),
					connectionId: crypto.randomUUID()
				};
				await roomFor(room.id).command(actor, { type: 'join', requestId: crypto.randomUUID() });
				await commandQuizRoom(db, roomFor, ids.teacher, room.id, { type: 'start', requestId: crypto.randomUUID() });
				const question = states.get(room.id)!.content.questions[0];
				await roomFor(room.id).command(actor, {
					type: 'save_answers',
					requestId: crypto.randomUUID(),
					version: 1,
					answers: [{ questionId: question.id, optionIds: question.correctOptionIds }]
				});
				await roomFor(room.id).command(actor, { type: 'submit', requestId: crypto.randomUUID(), answerVersion: 1 });
			}
			const baselines = (await db.select().from(t.quizRuns)).map((run) => run.gradeBaselines);
			expect(baselines.every((entries) => entries.every((entry) => entry.correctionRevision === 0))).toBe(true);
			for (const room of reverse ? rooms.toReversed() : rooms)
				expect((await close(room.id)).grades).toEqual({ reported: 12, conflicts: [] });
			const reports = await db.select().from(t.quizGradeReports);
			expect(reports).toHaveLength(24);
			expect(reports.filter((report) => report.studentId === ids.students[0])).toEqual([
				expect.objectContaining({ points: 1, source: 'attempt' }),
				expect.objectContaining({ points: 1, source: 'attempt' })
			]);
			const receipts = await db.select().from(t.quizGradeReceipts);
			for (const room of rooms)
				expect(await synchronizeQuizGrades(db, roomFor, ids.teacher, room.id)).toEqual({ reported: 12, conflicts: [] });
			expect(await db.select().from(t.quizGradeReports)).toEqual(reports);
			expect(await db.select().from(t.quizGradeReceipts)).toEqual(receipts);
			expect((await db.select().from(t.quizRuns)).map((run) => run.gradeBaselines)).toEqual(baselines);
		}
	);

	it('preserves absence provenance through several unrelated transfers and linked retakes', async () => {
		const second = { ...opening(), quizId: await addQuiz() };
		const third = { ...opening(), quizId: await addQuiz() };
		await saveManualCorrection(null);
		const first = await startRoom(opening());
		await startRoom(second);
		await startRoom(third);
		expect((await close(first.id)).grades).toEqual({ reported: 12, conflicts: [] });
		const retake = await startRoom({ ...opening(), sourceRunId: first.id, participantIds: [ids.students[0]] });
		expect((await close(second.id)).grades).toEqual({ reported: 12, conflicts: [] });
		expect((await close(retake.id)).grades).toEqual({ reported: 1, conflicts: [] });
		expect((await close(third.id)).grades).toEqual({ reported: 12, conflicts: [] });
		const nextRetake = await startRoom({ ...opening(), sourceRunId: retake.id, participantIds: [ids.students[0]] });
		expect((await close(nextRetake.id)).grades).toEqual({ reported: 1, conflicts: [] });
		const reports = await db.select().from(t.quizGradeReports).where(eq(t.quizGradeReports.studentId, ids.students[0]));
		expect(reports).toHaveLength(3);
		expect(
			reports.every((report) => report.source === 'absence' && report.points === 0 && report.correctionRevision === 6)
		).toBe(true);
		const [correction] = await db.select().from(t.corrections).where(eq(t.corrections.id, reports[0].correctionId));
		expect(correction).toMatchObject({
			revision: 6,
			submissionUrl: 'https://example.com/fictional-submission',
			submittedAt: new Date('2026-11-03T08:00:00Z'),
			latenessDecision: 'automatic'
		});
		for (const room of [first, second, third, retake, nextRetake])
			expect((await synchronizeQuizGrades(db, roomFor, ids.teacher, room.id)).conflicts).toEqual([]);
		expect(await db.select().from(t.quizGradeReports).where(eq(t.quizGradeReports.studentId, ids.students[0]))).toEqual(
			reports
		);
	});

	it.each([false, true])(
		'protects a manual save even after another quiz transfers (change and restore: %s)',
		async (restore) => {
			const second = { ...opening(), quizId: await addQuiz() };
			await saveManualCorrection(null);
			const first = await startRoom(opening());
			if (restore) await saveManualCorrection(0);
			await saveManualCorrection(null);
			await startRoom(second);
			expect((await close(second.id)).grades).toEqual({ reported: 12, conflicts: [] });
			const before = await getDetailedCorrection(db, ids.currentContext, ids.students[0]);
			expect((await close(first.id)).grades).toEqual({ reported: 11, conflicts: [ids.students[0]] });
			const after = await getDetailedCorrection(db, ids.currentContext, ids.students[0]);
			expect(after.students.find((student) => student.id === ids.students[0])).toEqual(
				before.students.find((student) => student.id === ids.students[0])
			);
			const receipts = await db.select().from(t.quizGradeReceipts);
			await saveManualCorrection(1);
			const manual = await getDetailedCorrection(db, ids.currentContext, ids.students[0]);
			expect(await synchronizeQuizGrades(db, roomFor, ids.teacher, second.id)).toEqual({ reported: 12, conflicts: [] });
			expect(await getDetailedCorrection(db, ids.currentContext, ids.students[0])).toEqual(manual);
			expect(await db.select().from(t.quizGradeReceipts)).toEqual(receipts);
		}
	);

	it.each(['absent_justified', 'absent_unjustified'] as const)(
		'preserves whole-assessment %s after an unrelated transfer',
		async (status) => {
			const second = { ...opening(), quizId: await addQuiz() };
			const first = await startRoom(opening());
			await startRoom(second);
			await close(second.id);
			await saveManualCorrection(null, status);
			expect((await close(first.id)).grades).toEqual({ reported: 11, conflicts: [ids.students[0]] });
			const { students } = await getDetailedCorrection(db, ids.currentContext, ids.students[0]);
			expect(
				students
					.find((student) => student.id === ids.students[0])!
					.corrections.find((entry) => entry.assessmentId === ids.quiz)?.status
			).toBe(status);
		}
	);

	it('fails closed when an intervening transfer receipt is malformed', async () => {
		const second = { ...opening(), quizId: await addQuiz() };
		const first = await startRoom(opening());
		await startRoom(second);
		await close(second.id);
		const [record] = await db
			.select()
			.from(t.quizGradeReceipts)
			.where(eq(t.quizGradeReceipts.studentId, ids.students[0]));
		await db
			.update(t.quizGradeReceipts)
			.set({ receipt: { ...record.receipt, correctionRevision: 0 } })
			.where(eq(t.quizGradeReceipts.id, record.id));
		expect((await close(first.id)).grades).toEqual({ reported: 11, conflicts: [ids.students[0]] });
	});

	it('opens a selected room for newcomers and an absentee without changing the previous cohort', async () => {
		const source = await finishFirstRoom();
		const original = structuredClone(states.get(source.id));
		const first = await addStudent('First newcomer');
		const second = await addStudent('Second newcomer');
		const unselected = await addStudent('Unselected newcomer');
		const candidates = await getQuizRoomCandidates(db, source.id, ids.teacher);
		expect(candidates.filter((entry) => entry.kind === 'ungraded').map((entry) => entry.id)).toEqual([
			first,
			second,
			unselected
		]);
		expect(candidates.find((entry) => entry.id === ids.students[0])?.kind).toBe('absence');
		const input = { ...opening(), sourceRunId: source.id, participantIds: [first, second, ids.students[0]] };
		const room = await openQuizRoom(db, roomFor, ids.teacher, input, now + 1);
		expect(room.participants.map((entry) => entry.id)).toEqual(input.participantIds);
		expect(await openQuizRoom(db, roomFor, ids.teacher, input, now + 2)).toEqual(room);
		expect(states.get(source.id)).toEqual(original);
		await addStudent('Arriving after selection');
		await commandQuizRoom(db, roomFor, ids.teacher, room.id, { type: 'start', requestId: crypto.randomUUID() });
		expect(states.get(room.id)?.participants.map((entry) => entry.id)).toEqual(input.participantIds);
		expect((await close(room.id)).grades).toEqual({ reported: 3, conflicts: [] });
		expect((await db.select().from(t.quizGradeReports)).some((report) => report.studentId === unselected)).toBe(false);
	});

	it.each([0, 1])('excludes a newcomer with an existing manual mark of %i', async (points) => {
		const source = await finishFirstRoom();
		const studentId = await addStudent('Manually graded newcomer');
		const [quiz] = await db.select().from(t.quizDrafts).where(eq(t.quizDrafts.id, quizId));
		const correctionId = crypto.randomUUID();
		await db.insert(t.corrections).values({
			id: correctionId,
			moduleId: ids.module,
			contextId: ids.currentContext,
			studentId,
			assessmentId: ids.quiz
		});
		await db.insert(t.scores).values({ correctionId, assessmentId: ids.quiz, lineId: quiz.lineId, points });
		expect((await getQuizRoomCandidates(db, source.id, ids.teacher)).some((entry) => entry.id === studentId)).toBe(
			false
		);
		await expect(
			openQuizRoom(
				db,
				roomFor,
				ids.teacher,
				{ ...opening(), sourceRunId: source.id, participantIds: [studentId] },
				now + 1
			)
		).rejects.toMatchObject({ status: 409 });
	});

	it('allows a first sitting when only another quiz line has a mark and preserves that mark', async () => {
		const source = await finishFirstRoom();
		const studentId = await addStudent('Newcomer with another quiz mark');
		const [quiz] = await db.select().from(t.quizDrafts).where(eq(t.quizDrafts.id, quizId));
		const [line] = await db.select().from(t.rubricLines).where(eq(t.rubricLines.id, quiz.lineId));
		const otherLineId = crypto.randomUUID();
		await db.insert(t.rubricLines).values({
			id: otherLineId,
			assessmentId: ids.quiz,
			groupId: line.groupId,
			label: 'Another quiz',
			maxPoints: 5
		});
		const correctionId = crypto.randomUUID();
		await db.insert(t.corrections).values({
			id: correctionId,
			moduleId: ids.module,
			contextId: ids.currentContext,
			studentId,
			assessmentId: ids.quiz
		});
		await db.insert(t.scores).values({
			correctionId,
			assessmentId: ids.quiz,
			lineId: otherLineId,
			points: 4
		});
		expect(await getQuizRoomCandidates(db, source.id, ids.teacher)).toContainEqual({
			id: studentId,
			name: 'Newcomer with another quiz mark',
			kind: 'ungraded'
		});
		const room = await openQuizRoom(
			db,
			roomFor,
			ids.teacher,
			{
				...opening(),
				sourceRunId: source.id,
				participantIds: [studentId]
			},
			now + 1
		);
		await commandQuizRoom(db, roomFor, ids.teacher, room.id, { type: 'start', requestId: crypto.randomUUID() });
		expect((await close(room.id)).grades).toEqual({ reported: 1, conflicts: [] });
		const marks = await db.select().from(t.scores).where(eq(t.scores.correctionId, correctionId));
		expect(marks.find((entry) => entry.lineId === otherLineId)?.points).toBe(4);
		expect(marks.find((entry) => entry.lineId === quiz.lineId)?.points).toBe(0);
	});

	it('keeps candidate identities private and rejects students from another class', async () => {
		const source = await finishFirstRoom();
		await expect(getQuizRoomCandidates(db, source.id, crypto.randomUUID())).rejects.toMatchObject({ status: 404 });
		expect((await getQuizRoomCandidates(db, source.id, ids.teacher)).some((entry) => entry.id === ids.oldStudent)).toBe(
			false
		);
		await expect(
			openQuizRoom(
				db,
				roomFor,
				ids.teacher,
				{
					...opening(),
					sourceRunId: source.id,
					participantIds: [ids.oldStudent]
				},
				now + 1
			)
		).rejects.toMatchObject({ status: 409 });
	});

	it('does not treat an untransferred earlier cohort as new students without marks', async () => {
		const source = await finishFirstRoom();
		await db.delete(t.quizGradeReports).where(eq(t.quizGradeReports.quizId, quizId));
		await db.delete(t.scores);
		expect(await getQuizRoomCandidates(db, source.id, ids.teacher)).toEqual([]);
	});

	it('rechecks a newcomer mark at first start and preserves the waiting room on conflict', async () => {
		const source = await finishFirstRoom();
		const studentId = await addStudent('Newcomer graded before start');
		const room = await openQuizRoom(
			db,
			roomFor,
			ids.teacher,
			{ ...opening(), sourceRunId: source.id, participantIds: [studentId] },
			now + 1
		);
		const [quiz] = await db.select().from(t.quizDrafts).where(eq(t.quizDrafts.id, quizId));
		const correctionId = crypto.randomUUID();
		await db.insert(t.corrections).values({
			id: correctionId,
			moduleId: ids.module,
			contextId: ids.currentContext,
			studentId,
			assessmentId: ids.quiz
		});
		await db.insert(t.scores).values({ correctionId, assessmentId: ids.quiz, lineId: quiz.lineId, points: 0 });
		await expect(
			commandQuizRoom(db, roomFor, ids.teacher, room.id, { type: 'start', requestId: crypto.randomUUID() })
		).rejects.toMatchObject({ status: 409 });
		expect(states.get(room.id)?.status).toBe('lobby');
	});

	it('refuses an unpublished course before creating or freezing a room', async () => {
		await db.update(t.modulePublications).set({ unpublishedAt: new Date(now) });
		await expect(openQuizRoom(db, roomFor, ids.teacher, opening(), now)).rejects.toMatchObject({
			status: 422,
			body: { message: 'Publiez ce module pour cette classe avant de lancer le quiz.' }
		});
		expect(await db.select().from(t.quizRuns)).toEqual([]);
		expect(states.size).toBe(0);
	});
	it('refuses a malformed publication snapshot before initializing a room', async () => {
		await client.execute({
			sql: 'UPDATE module_publication SET snapshot = ? WHERE context_id = ?',
			args: ['{"version":1}', ids.currentContext]
		});
		await expect(openQuizRoom(db, roomFor, ids.teacher, opening(), now)).rejects.toMatchObject({
			status: 422
		});
		expect(states.size).toBe(0);
		expect(await db.select().from(t.quizRuns)).toEqual([]);
	});
	it('refuses a public link still pointing at the previous annual context', async () => {
		await db.update(t.publicModuleLinks).set({ publishedContextId: ids.oldContext });
		await expect(openQuizRoom(db, roomFor, ids.teacher, opening(), now)).rejects.toMatchObject({
			status: 422
		});
		expect(states.size).toBe(0);
		expect(await db.select().from(t.quizRuns)).toEqual([]);
	});
	it('refuses a disabled public link before initializing a room', async () => {
		await db.update(t.publicModuleLinks).set({ enabled: false });
		await expect(openQuizRoom(db, roomFor, ids.teacher, opening(), now)).rejects.toMatchObject({
			status: 422
		});
		expect(states.size).toBe(0);
		expect(await db.select().from(t.quizRuns)).toEqual([]);
	});
	it('opens an accessible room using a stable public identity distinct from its context', async () => {
		const publicId = crypto.randomUUID();
		await db.update(t.publicModuleLinks).set({ id: publicId });
		const input = opening();
		await openQuizRoom(db, roomFor, ids.teacher, input, now);
		expect(await requirePublicQuizRun(db, publicId, input.id)).toMatchObject({
			id: input.id,
			contextId: ids.currentContext
		});
	});
	it('preserves identical opening retries after a later unpublication', async () => {
		const input = opening();
		const first = await openQuizRoom(db, roomFor, ids.teacher, input, now);
		await db.update(t.modulePublications).set({ unpublishedAt: new Date(now) });
		expect(await openQuizRoom(db, roomFor, ids.teacher, input, now + 1)).toEqual(first);
		expect(await db.select().from(t.quizRuns)).toHaveLength(1);
	});
	it('blocks starting an open lobby until its course is published again', async () => {
		const input = opening();
		await openQuizRoom(db, roomFor, ids.teacher, input, now);
		const [before] = await db.select().from(t.quizRuns);
		await db.update(t.modulePublications).set({ unpublishedAt: new Date(now) });
		const start = { type: 'start' as const, requestId: crypto.randomUUID() };
		await expect(commandQuizRoom(db, roomFor, ids.teacher, input.id, start)).rejects.toMatchObject({
			status: 422,
			body: { message: 'Publiez ce module pour cette classe avant de lancer le quiz.' }
		});
		expect(await db.select().from(t.quizRuns)).toEqual([before]);
		expect(states.get(input.id)?.status).toBe('lobby');
		await db.update(t.modulePublications).set({ unpublishedAt: null });
		expect((await commandQuizRoom(db, roomFor, ids.teacher, input.id, start)).view.status).toBe('running');
	});
	it('rechecks publication when retrying a reserved start that has not reached the room', async () => {
		const input = opening();
		await openQuizRoom(db, roomFor, ids.teacher, input, now);
		const start = { type: 'start' as const, requestId: crypto.randomUUID() };
		const interruptedRoomFor: QuizRoomResolver = (id) => ({
			...roomFor(id),
			command: async () => {
				throw new Error('Fictional interruption before durable start');
			}
		});
		await expect(commandQuizRoom(db, interruptedRoomFor, ids.teacher, input.id, start)).rejects.toThrow(
			'before durable start'
		);
		expect((await db.select().from(t.quizRuns))[0].status).toBe('running');
		expect(states.get(input.id)?.status).toBe('lobby');
		await db.update(t.modulePublications).set({ unpublishedAt: new Date(now) });
		await expect(commandQuizRoom(db, roomFor, ids.teacher, input.id, start)).rejects.toMatchObject({
			status: 422
		});
		expect(states.get(input.id)?.status).toBe('lobby');
	});
	it('can retry a completed start and close a running quiz after unpublication', async () => {
		const input = opening();
		await openQuizRoom(db, roomFor, ids.teacher, input, now);
		const start = { type: 'start' as const, requestId: crypto.randomUUID() };
		const first = await commandQuizRoom(db, roomFor, ids.teacher, input.id, start);
		await db.update(t.modulePublications).set({ unpublishedAt: new Date(now) });
		expect((await commandQuizRoom(db, roomFor, ids.teacher, input.id, start)).receipt).toEqual(first.receipt);
		expect((await close(input.id)).view.status).toBe('closed');
		expect(await db.select().from(t.quizGradeReports)).toHaveLength(12);
	});
	it('opens once with a persisted roster and replay-safe grade baselines', async () => {
		const input = opening();
		const first = await openQuizRoom(db, roomFor, ids.teacher, input, now);
		expect(first.participants).toHaveLength(12);
		await db.update(t.students).set({ name: 'Later name' }).where(eq(t.students.id, ids.students[0]));
		expect(await openQuizRoom(db, roomFor, ids.teacher, input, now + 1)).toEqual(first);
		expect(await db.select().from(t.quizRuns)).toHaveLength(1);
		await expect(openQuizRoom(db, roomFor, ids.teacher, opening(), now)).rejects.toMatchObject({
			status: 409
		});
	});
	it('refreshes and freezes the expected cohort and grade baselines at first start', async () => {
		const input = opening();
		await openQuizRoom(db, roomFor, ids.teacher, input, now);
		const newStudent = crypto.randomUUID();
		await db.insert(t.students).values({
			id: newStudent,
			classId: ids.currentClass,
			name: 'Arriving before start',
			position: 20
		});
		await db.update(t.students).set({ classId: ids.oldClass }).where(eq(t.students.id, ids.students[11]));
		await db.update(t.students).set({ name: 'Updated before start' }).where(eq(t.students.id, ids.students[0]));
		const result = await commandQuizRoom(db, roomFor, ids.teacher, input.id, {
			type: 'start',
			requestId: crypto.randomUUID()
		});
		expect(result.view.participants).toHaveLength(12);
		expect(result.view.participants.find((participant) => participant.id === newStudent)?.name).toBe(
			'Arriving before start'
		);
		expect(result.view.participants.some((participant) => participant.id === ids.students[11])).toBe(false);
		expect(result.view.participants.find((participant) => participant.id === ids.students[0])?.name).toBe(
			'Updated before start'
		);
		const [run] = await db.select().from(t.quizRuns).where(eq(t.quizRuns.id, input.id));
		expect(run.gradeBaselines.map((baseline) => baseline.studentId)).toEqual(
			result.view.participants.map((participant) => participant.id)
		);
		await close(input.id);
		expect((await db.select().from(t.quizGradeReports)).map((report) => report.studentId).sort()).toEqual(
			result.view.participants.map((participant) => participant.id).sort()
		);
		expect((await openQuizRoom(db, roomFor, ids.teacher, input, now + 1)).status).toBe('closed');
	});

	it('keeps a started cohort frozen through a lost start response and never adds later arrivals on retry', async () => {
		const input = opening();
		await openQuizRoom(db, roomFor, ids.teacher, input, now);
		const start = { type: 'start' as const, requestId: crypto.randomUUID() };
		let loseResponse = true;
		const interruptedRoomFor: QuizRoomResolver = (id) => ({
			...roomFor(id),
			command: async (actor, command) => {
				const result = await roomFor(id).command(actor, command);
				if (command.type === 'start' && loseResponse) {
					loseResponse = false;
					throw new Error('Fictional lost response after durable start');
				}
				return result;
			}
		});
		await expect(commandQuizRoom(db, interruptedRoomFor, ids.teacher, input.id, start)).rejects.toThrow(
			'lost response'
		);
		expect((await db.select().from(t.quizRuns))[0].status).toBe('running');
		const lateStudent = crypto.randomUUID();
		await db.insert(t.students).values({
			id: lateStudent,
			classId: ids.currentClass,
			name: 'Arriving after start',
			position: 20
		});
		const retried = await commandQuizRoom(db, interruptedRoomFor, ids.teacher, input.id, start);
		expect(retried.view.participants).toHaveLength(12);
		expect(retried.view.participants.some((participant) => participant.id === lateStudent)).toBe(false);
		expect((await openQuizRoom(db, roomFor, ids.teacher, input, now + 1)).participants).toEqual(
			retried.view.participants
		);
	});

	it('reports missing grade baselines as explicit conflicts instead of silently dropping expected students', async () => {
		const input = opening();
		await openQuizRoom(db, roomFor, ids.teacher, input, now);
		await commandQuizRoom(db, roomFor, ids.teacher, input.id, {
			type: 'start',
			requestId: crypto.randomUUID()
		});
		await db.update(t.quizRuns).set({ gradeBaselines: [] }).where(eq(t.quizRuns.id, input.id));
		const result = await close(input.id);
		expect(result.grades).toEqual({ reported: 0, conflicts: expect.arrayContaining(ids.students) });
		expect(result.grades!.conflicts).toHaveLength(12);
	});

	it('rejects a creation replay if its frozen quiz revision has been changed outside the launch contract', async () => {
		const input = opening();
		await openQuizRoom(db, roomFor, ids.teacher, input, now);
		await db.update(t.quizDrafts).set({ revision: 2 }).where(eq(t.quizDrafts.id, quizId));
		await expect(openQuizRoom(db, roomFor, ids.teacher, input, now + 1)).rejects.toMatchObject({
			status: 409
		});
		expect(await db.select().from(t.quizRuns)).toHaveLength(1);
	});
	it('rejects stale, unreviewed and archived content before initializing a room', async () => {
		await expect(
			openQuizRoom(db, roomFor, ids.teacher, { ...opening(), expectedQuizRevision: 2 }, now)
		).rejects.toMatchObject({ status: 409 });
		await db.update(t.quizDrafts).set({ needsReview: true }).where(eq(t.quizDrafts.id, quizId));
		await expect(openQuizRoom(db, roomFor, ids.teacher, opening(), now)).rejects.toMatchObject({
			status: 409
		});
		expect(states.size).toBe(0);
	});
	it('closes, transfers absence zeros and safely repeats an interrupted transfer', async () => {
		const input = opening();
		await openQuizRoom(db, roomFor, ids.teacher, input, now);
		await commandQuizRoom(db, roomFor, ids.teacher, input.id, {
			type: 'start',
			requestId: crypto.randomUUID()
		});
		await close(input.id);
		expect(await db.select().from(t.quizGradeReports)).toHaveLength(12);
		await close(input.id);
		expect((await synchronizeQuizGrades(db, roomFor, ids.teacher, input.id)).reported).toBe(12);
		expect(await db.select().from(t.quizGradeReports)).toHaveLength(12);
		expect(await db.select().from(t.quizGradeReceipts)).toHaveLength(12);
	});
	it('protects a manually changed mark and reports the conflict without overwriting it', async () => {
		const input = opening();
		await openQuizRoom(db, roomFor, ids.teacher, input, now);
		await commandQuizRoom(db, roomFor, ids.teacher, input.id, {
			type: 'start',
			requestId: crypto.randomUUID()
		});
		await close(input.id);
		const [record] = await db
			.select()
			.from(t.quizGradeReports)
			.where(eq(t.quizGradeReports.studentId, ids.students[0]));
		await db
			.update(t.corrections)
			.set({ revision: record.correctionRevision + 1 })
			.where(eq(t.corrections.id, record.correctionId));
		const retake = { ...opening(), sourceRunId: input.id, participantIds: [ids.students[0]] };
		await expect(openQuizRoom(db, roomFor, ids.teacher, retake, now + 1)).rejects.toMatchObject({
			status: 409
		});
		expect(await db.select().from(t.quizRuns)).toHaveLength(1);
	});
	it('opens a retake for selected absent students without enrolling the other students', async () => {
		const input = opening();
		await openQuizRoom(db, roomFor, ids.teacher, input, now);
		await commandQuizRoom(db, roomFor, ids.teacher, input.id, {
			type: 'start',
			requestId: crypto.randomUUID()
		});
		await close(input.id);
		const retake = await openQuizRoom(
			db,
			roomFor,
			ids.teacher,
			{
				...opening(),
				sourceRunId: input.id,
				participantIds: [ids.students[0]]
			},
			now + 1
		);
		expect(retake.participants.map((entry) => entry.id)).toEqual([ids.students[0]]);
	});
	it('rechecks absence provenance at retake start and never enrolls other class arrivals', async () => {
		const input = opening();
		await openQuizRoom(db, roomFor, ids.teacher, input, now);
		await commandQuizRoom(db, roomFor, ids.teacher, input.id, {
			type: 'start',
			requestId: crypto.randomUUID()
		});
		await close(input.id);
		const retake = await openQuizRoom(
			db,
			roomFor,
			ids.teacher,
			{
				...opening(),
				sourceRunId: input.id,
				participantIds: [ids.students[0]]
			},
			now + 1
		);
		const [record] = await db
			.select()
			.from(t.quizGradeReports)
			.where(eq(t.quizGradeReports.studentId, ids.students[0]));
		await db
			.update(t.corrections)
			.set({ revision: record.correctionRevision + 1 })
			.where(eq(t.corrections.id, record.correctionId));
		await expect(
			commandQuizRoom(db, roomFor, ids.teacher, retake.id, {
				type: 'start',
				requestId: crypto.randomUUID()
			})
		).rejects.toMatchObject({ status: 409 });
		expect(states.get(retake.id)?.status).toBe('lobby');
		expect((await db.select().from(t.quizRuns).where(eq(t.quizRuns.id, retake.id)))[0].status).toBe('lobby');
	});
	it('synchronizes a missed retake and allows the next retake from that room', async () => {
		const input = opening();
		await openQuizRoom(db, roomFor, ids.teacher, input, now);
		await commandQuizRoom(db, roomFor, ids.teacher, input.id, {
			type: 'start',
			requestId: crypto.randomUUID()
		});
		await close(input.id);
		const otherReports = (await db.select().from(t.quizGradeReports)).filter(
			(report) => report.studentId !== ids.students[0]
		);
		const retake = await openQuizRoom(
			db,
			roomFor,
			ids.teacher,
			{
				...opening(),
				sourceRunId: input.id,
				participantIds: [ids.students[0]]
			},
			now + 1
		);
		await commandQuizRoom(db, roomFor, ids.teacher, retake.id, {
			type: 'start',
			requestId: crypto.randomUUID()
		});
		expect((await close(retake.id)).grades).toEqual({ reported: 1, conflicts: [] });
		expect(await synchronizeQuizGrades(db, roomFor, ids.teacher, retake.id)).toEqual({
			reported: 1,
			conflicts: []
		});
		const nextRetake = await openQuizRoom(
			db,
			roomFor,
			ids.teacher,
			{
				...opening(),
				sourceRunId: retake.id,
				participantIds: [ids.students[0]]
			},
			now + 2
		);
		expect(nextRetake.participants.map((participant) => participant.id)).toEqual([ids.students[0]]);
		expect(
			(
				await commandQuizRoom(db, roomFor, ids.teacher, nextRetake.id, {
					type: 'start',
					requestId: crypto.randomUUID()
				})
			).view.status
		).toBe('running');
		expect(
			(await db.select().from(t.quizGradeReports)).filter((report) => report.studentId !== ids.students[0])
		).toEqual(otherReports);
	});
	it('never allows another teacher identity to operate the indexed room', async () => {
		const input = opening();
		await openQuizRoom(db, roomFor, ids.teacher, input, now);
		await expect(
			commandQuizRoom(db, roomFor, crypto.randomUUID(), input.id, {
				type: 'start',
				requestId: crypto.randomUUID()
			})
		).rejects.toMatchObject({ status: 404 });
	});
});
