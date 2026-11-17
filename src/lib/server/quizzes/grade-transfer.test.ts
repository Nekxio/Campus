import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import type { QuizGradeWrite } from '../../domain/quiz-content.js';

const { namespace } = vi.hoisted(() => ({ namespace: { idFromName: vi.fn(), get: vi.fn() } }));
vi.mock('$app/env', () => ({ dev: true }));
vi.mock('../teaching/database.js', () => ({ withTeacherDatabase: vi.fn() }));
vi.mock('../teaching/public-database.js', () => ({ withPublicDatabase: vi.fn() }));
vi.mock('cloudflare:workers', () => ({
	env: { QUIZ_ROOMS: namespace },
	DurableObject: class {
		ctx: unknown;
		env: unknown;
		constructor(ctx: unknown, env: unknown) {
			this.ctx = ctx;
			this.env = env;
		}
	}
}));

import * as database from '../db/index.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import * as t from '../db/schema.js';
import { getQuizGradeBaselines, saveQuizDraft } from '../teaching/quizzes.js';
import { reportQuizRoomGrade } from '../teaching/quiz-rooms.js';
import { withTeacherDatabase } from '../teaching/database.js';
import { QuizRoom } from './room.js';
import { quizRoomStub } from './http.js';

const clients: Client[] = [];
const durableId = (name: string) => ({
	toString: () => name,
	equals: (other: { toString: () => string }) => other.toString() === name
});

const memoryContext = (runId: string) => {
	const entries = new Map<string, unknown>();
	let alarm: number | null = null;
	return {
		id: durableId(runId),
		setWebSocketAutoResponse: () => {},
		getWebSockets: () => [],
		storage: {
			kv: {
				get: (key: string) => entries.get(key),
				put: (key: string, value: unknown) => entries.set(key, value),
				delete: (key: string) => entries.delete(key),
				list: () => new Map(entries)
			},
			transactionSync: <T>(operation: () => T): T => operation(),
			getAlarm: async () => alarm,
			setAlarm: async (value: number) => {
				alarm = value;
			},
			deleteAlarm: async () => {
				alarm = null;
			},
			sync: async () => {}
		}
	};
};

const fixture = async (closed = true) => {
	vi.stubGlobal('WebSocketRequestResponsePair', class {});
	const client = createClient({ url: ':memory:' });
	clients.push(client);
	const db = database.createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	await client.execute('PRAGMA foreign_keys = ON');
	const ids = await seedFoundationFixtures(db);
	const quizId = crypto.randomUUID();
	const runId = crypto.randomUUID();
	const sessionId = crypto.randomUUID();
	const lessonId = crypto.randomUUID();
	const groupId = crypto.randomUUID();
	const lineId = crypto.randomUUID();
	const correctId = crypto.randomUUID();
	const content = {
		version: 1 as const,
		title: 'Fictional grade transfer quiz',
		durationSeconds: 1200,
		questions: [
			{
				id: crypto.randomUUID(),
				type: 'single' as const,
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
	};
	await db.insert(t.lessons).values({
		id: lessonId,
		contextId: ids.currentContext,
		title: 'Fictional transfer lesson',
		startsAt: new Date(),
		endsAt: new Date(Date.now() + 3600000)
	});
	await db.insert(t.rubricGroups).values({ id: groupId, assessmentId: ids.quiz, title: 'Fictional quizzes' });
	await db.insert(t.rubricLines).values({
		id: lineId,
		assessmentId: ids.quiz,
		groupId,
		label: 'Fictional transfer quiz',
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
		content
	});
	const baselines = (await getQuizGradeBaselines(db, quizId)).map((entry) => ({
		studentId: entry.studentId,
		name: entry.name,
		correctionRevision: entry.correctionRevision,
		requestId: crypto.randomUUID()
	}));
	await db.insert(t.quizRuns).values({
		id: runId,
		quizId,
		contextId: ids.currentContext,
		teacherId: ids.teacher,
		status: closed ? 'running' : 'lobby',
		gradeBaselines: baselines
	});
	await db.insert(t.session).values({
		id: sessionId,
		userId: ids.teacher,
		token: 'fictional-transfer-session-' + crypto.randomUUID(),
		expiresAt: new Date(Date.now() + 3600000),
		updatedAt: new Date()
	});
	namespace.idFromName.mockImplementation(durableId);
	const context = memoryContext(runId);
	const environment = {
		QUIZ_ROOMS: namespace,
		TURSO_DATABASE_URL: 'https://fictional-transfer.invalid',
		TURSO_AUTH_TOKEN: 'fictional-transfer-test-only'
	} as unknown as Cloudflare.Env;
	const room = new QuizRoom(context as unknown as DurableObjectState, environment);
	await room.initialize({
		id: runId,
		content,
		shuffleSeed: 'fictional-grade-transfer',
		createdAt: Date.now(),
		roster: baselines.map(({ studentId, name }) => ({ id: studentId, name }))
	});
	if (closed) {
		const actor = {
			kind: 'participant' as const,
			participantId: ids.students[0],
			credentialHash: 'a'.repeat(64),
			connectionId: crypto.randomUUID()
		};
		await room.command(actor, { type: 'join', requestId: crypto.randomUUID() });
		await room.command({ kind: 'teacher' }, { type: 'start', requestId: crypto.randomUUID() });
		await room.command(actor, {
			type: 'save_answers',
			requestId: crypto.randomUUID(),
			version: 1,
			answers: [{ questionId: content.questions[0].id, optionIds: [correctId] }]
		});
		await room.command(actor, { type: 'submit', requestId: crypto.randomUUID(), answerVersion: 1 });
		await room.command({ kind: 'teacher' }, { type: 'close', requestId: crypto.randomUUID() });
	}
	const view = await room.teacherState();
	const inputFor = (studentId = ids.students[0]): QuizGradeWrite => {
		const baseline = baselines.find((entry) => entry.studentId === studentId)!;
		const participant = view.participants.find((entry) => entry.id === studentId)!;
		return {
			requestId: baseline.requestId,
			quizId,
			runId,
			studentId,
			expectedCorrectionRevision: baseline.correctionRevision,
			points: participant.points ?? 0,
			source: participant.status === 'absent' ? 'absence' : participant.status === 'interrupted' ? 'stopped' : 'attempt'
		};
	};
	const close = vi.fn();
	const proxy = new Proxy(client, {
		get(target, property) {
			if (property === 'close') return close;
			const value: unknown = Reflect.get(target, property, target);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
	const createTursoClient = vi.spyOn(database, 'createTursoClient').mockReturnValue(proxy);
	const teacher = { teacherId: ids.teacher, sessionId };
	const report = (input = inputFor(), identity = teacher) =>
		room.rpc({ method: 'reportGrade', teacher: identity, input });
	const expectNoGrade = async () => {
		expect(await db.select().from(t.quizGradeReports)).toEqual([]);
		expect(await db.select().from(t.quizGradeReceipts)).toEqual([]);
		expect(await db.select().from(t.scores).where(eq(t.scores.lineId, lineId))).toEqual([]);
		expect(await db.select().from(t.corrections).where(eq(t.corrections.assessmentId, ids.quiz))).toEqual([]);
		expect(close).toHaveBeenCalledTimes(createTursoClient.mock.calls.length);
	};
	return {
		client,
		db,
		ids,
		room,
		view,
		context,
		teacher,
		runId,
		quizId,
		lineId,
		inputFor,
		report,
		close,
		createTursoClient,
		expectNoGrade
	};
};

afterEach(() => {
	for (const client of clients.splice(0)) client.close();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe('quiz grade transfer RPC authorization', () => {
	it.each(['revoked', 'expired', 'another session owner', 'another run owner'] as const)(
		'refuses a %s session without writing a grade',
		async (reason) => {
			const f = await fixture();
			if (reason === 'revoked') await f.db.delete(t.session).where(eq(t.session.id, f.teacher.sessionId));
			if (reason === 'expired')
				await f.db
					.update(t.session)
					.set({ expiresAt: new Date(Date.now() - 1000) })
					.where(eq(t.session.id, f.teacher.sessionId));
			let teacher = f.teacher;
			if (reason === 'another session owner') teacher = { ...teacher, teacherId: crypto.randomUUID() };
			if (reason === 'another run owner') {
				const teacherId = crypto.randomUUID();
				await f.db
					.insert(t.user)
					.values({ id: teacherId, name: 'Other fictional teacher', email: 'other@example.test' });
				await f.db.update(t.session).set({ userId: teacherId }).where(eq(t.session.id, teacher.sessionId));
				teacher = { ...teacher, teacherId };
			}
			expect(await f.report(f.inputFor(), teacher)).toMatchObject({ ok: false, error: { kind: 'http', status: 403 } });
			await f.expectNoGrade();
		}
	);

	it.each(['lobby', 'purged', 'wrong namespace', 'archived', 'missing run'] as const)(
		'refuses a %s room without writing a grade',
		async (reason) => {
			const f = await fixture(reason !== 'lobby');
			if (reason === 'purged') await f.room.purge();
			if (reason === 'wrong namespace') f.context.id = durableId(crypto.randomUUID());
			if (reason === 'archived')
				await f.db
					.update(t.teachingContexts)
					.set({ archivedAt: new Date() })
					.where(eq(t.teachingContexts.id, f.ids.currentContext));
			if (reason === 'missing run') await f.db.delete(t.quizRuns).where(eq(t.quizRuns.id, f.runId));
			expect(await f.report()).toMatchObject({ ok: false });
			await f.expectNoGrade();
		}
	);

	it('rejects malformed direct RPC input before creating a database client', async () => {
		const f = await fixture();
		expect(
			await f.room.rpc({ method: 'reportGrade', teacher: f.teacher, input: { ...f.inputFor(), extra: true } })
		).toMatchObject({
			ok: false,
			error: { kind: 'invalid_input' }
		});
		expect(f.createTursoClient).not.toHaveBeenCalled();
		await f.expectNoGrade();
	});

	it('validates the direct transfer method before opening a database client', async () => {
		const f = await fixture();
		await expect(f.room.reportGrade({ teacher: f.teacher, input: f.inputFor(), extra: true })).rejects.toMatchObject({
			status: 422
		});
		expect(f.createTursoClient).not.toHaveBeenCalled();
		await f.expectNoGrade();
	});

	it('returns a redacted SQL failure and still closes its client', async () => {
		const f = await fixture();
		const privateDetail = 'fictional SQL connection detail must remain private';
		const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(f.client, 'execute').mockRejectedValueOnce(new Error(privateDetail));
		const result = await f.report();
		expect(result).toMatchObject({
			ok: false,
			error: { kind: 'http', status: 503 }
		});
		expect(JSON.stringify(result)).not.toContain(privateDetail);
		expect(JSON.stringify(logger.mock.calls)).not.toContain(privateDetail);
		expect(f.createTursoClient).toHaveBeenCalledTimes(1);
		expect(f.close).toHaveBeenCalledTimes(1);
		await f.expectNoGrade();
	});

	it.each(['archive', 'purge'] as const)(
		'rechecks a concurrent %s inside the grade transaction after authorization',
		async (change) => {
			const f = await fixture();
			const begin = f.client.transaction.bind(f.client);
			const transaction = vi.spyOn(f.client, 'transaction').mockImplementation(async (...args) => {
				if (change === 'archive')
					await f.db
						.update(t.teachingContexts)
						.set({ archivedAt: new Date() })
						.where(eq(t.teachingContexts.id, f.ids.currentContext));
				else await f.db.delete(t.quizRuns).where(eq(t.quizRuns.id, f.runId));
				return begin(...args);
			});
			expect(await f.report()).toMatchObject({
				ok: false,
				error: { kind: 'http', status: change === 'archive' ? 409 : 422 }
			});
			expect(transaction).toHaveBeenCalledTimes(1);
			await f.expectNoGrade();
		}
	);
});

describe('quiz grade transfer provenance', () => {
	it.each(['student', 'run', 'points', 'source', 'request', 'quiz', 'revision'] as const)(
		'refuses forged %s data before any grade is committed',
		async (field) => {
			const f = await fixture();
			const input = field === 'source' ? f.inputFor(f.ids.students[1]) : f.inputFor();
			if (field === 'student') input.studentId = f.ids.oldStudent;
			if (field === 'run') input.runId = crypto.randomUUID();
			if (field === 'points') input.points = 0;
			if (field === 'source') input.source = 'attempt';
			if (field === 'request') input.requestId = crypto.randomUUID();
			if (field === 'quiz') input.quizId = crypto.randomUUID();
			if (field === 'revision') input.expectedCorrectionRevision += 1;
			expect(await f.report(input)).toMatchObject({ ok: false });
			await f.expectNoGrade();
		}
	);

	it.each(['request', 'quiz', 'revision'] as const)(
		'the shared helper rejects a different baseline %s',
		async (field) => {
			const f = await fixture();
			const input = f.inputFor();
			if (field === 'request') input.requestId = crypto.randomUUID();
			if (field === 'quiz') input.quizId = crypto.randomUUID();
			if (field === 'revision') input.expectedCorrectionRevision += 1;
			await expect(reportQuizRoomGrade(f.db, f.ids.teacher, f.view, input)).rejects.toMatchObject({ status: 409 });
			await f.expectNoGrade();
		}
	);

	it('writes the closed durable result and replays the exact receipt without changing the grade', async () => {
		const f = await fixture();
		const input = f.inputFor();
		expect(input).toMatchObject({ points: 1, source: 'attempt', expectedCorrectionRevision: 0 });
		const first = await f.report(input);
		expect(first).toMatchObject({
			ok: true,
			method: 'reportGrade',
			value: { requestId: input.requestId, studentId: input.studentId, correctionRevision: 1 }
		});
		if (!first.ok) throw new Error('The valid grade transfer must succeed.');
		expect(await f.room.reportGrade({ teacher: f.teacher, input })).toEqual(first.value);
		expect(await f.db.select().from(t.quizGradeReports)).toHaveLength(1);
		expect(await f.db.select().from(t.quizGradeReceipts)).toHaveLength(1);
		expect(await f.db.select().from(t.scores).where(eq(t.scores.lineId, f.lineId))).toMatchObject([{ points: 1 }]);
		expect(await f.db.select().from(t.corrections).where(eq(t.corrections.assessmentId, f.ids.quiz))).toMatchObject([
			{ revision: 1 }
		]);
		expect(f.close).toHaveBeenCalledTimes(2);
	});

	it('the shared helper preserves the same receipt on an identical retry', async () => {
		const f = await fixture();
		const input = f.inputFor();
		const first = await reportQuizRoomGrade(f.db, f.ids.teacher, f.view, input);
		expect(await reportQuizRoomGrade(f.db, f.ids.teacher, f.view, input)).toEqual(first);
		expect(await f.db.select().from(t.quizGradeReceipts)).toHaveLength(1);
		expect(await f.db.select().from(t.quizGradeReports)).toHaveLength(1);
	});

	it('uses the guarded Node transfer in development without sending grades or credentials to the room RPC', async () => {
		const f = await fixture();
		const [user] = await f.db.select().from(t.user).where(eq(t.user.id, f.ids.teacher));
		const [session] = await f.db.select().from(t.session).where(eq(t.session.id, f.teacher.sessionId));
		const event = { locals: { user, session } } as unknown as RequestEvent;
		vi.mocked(withTeacherDatabase).mockImplementation(async (_locals, operation) => operation(f.db));
		const rpc = vi.fn((input: unknown) => f.room.rpc(input));
		namespace.get.mockReturnValue({ rpc });
		const input = f.inputFor();
		expect(await quizRoomStub(event, f.runId).reportGrade(input)).toMatchObject({
			requestId: input.requestId,
			studentId: input.studentId,
			correctionRevision: 1
		});
		expect(await f.db.select().from(t.quizGradeReports)).toHaveLength(1);
		expect(await f.db.select().from(t.quizGradeReceipts)).toHaveLength(1);
		expect(await f.db.select().from(t.scores).where(eq(t.scores.lineId, f.lineId))).toMatchObject([{ points: 1 }]);
		expect(withTeacherDatabase).toHaveBeenCalledExactlyOnceWith(event.locals, expect.any(Function));
		expect(rpc).toHaveBeenCalledExactlyOnceWith({ method: 'teacherState' });
		expect(f.createTursoClient).not.toHaveBeenCalled();
		expect(f.close).not.toHaveBeenCalled();
	});
});
