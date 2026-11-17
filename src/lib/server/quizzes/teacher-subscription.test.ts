import { afterEach, expect, it, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { makeSignature } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import type { QuizTeacherProjection } from '#lib/domain/quiz-session.js';
import type { RequestEvent } from '@sveltejs/kit';

const { binding } = vi.hoisted(() => ({ binding: { idFromName: vi.fn(), get: vi.fn() } }));
vi.mock('$app/env', () => ({ dev: false }));
vi.mock('cloudflare:workers', () => ({
	env: { QUIZ_ROOMS: binding },
	DurableObject: class {
		ctx: unknown;
		env: unknown;
		constructor(ctx: unknown, env: unknown) {
			this.ctx = ctx;
			this.env = env;
		}
	}
}));
vi.mock('../teaching/database.js', () => ({ withTeacherDatabase: vi.fn() }));
vi.mock('../teaching/public-database.js', () => ({ withPublicDatabase: vi.fn() }));
import { createAuth } from '../auth.js';
import { revokeAccount } from '../auth/revoke.js';
import { createDatabase } from '../db/index.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import * as t from '../db/schema.js';
import { withTeacherDatabase } from '../teaching/database.js';
import { withPublicDatabase } from '../teaching/public-database.js';
import { saveQuizDraft } from '../teaching/quizzes.js';
import { openQuizRoom } from '../teaching/quiz-rooms.js';
import { decidePublication, getPublicationReview } from '../teaching/publications.js';
import { QuizRoom } from './room.js';
import { isQuizTeacherAuthorized } from './teacher-authorization.js';
import { prepareStudentQuiz, joinStudentQuiz, readStudentQuizRoom } from './http.js';
import { GET as teacherRead, POST as teacherWrite } from '../../../routes/api/teaching/quiz-rooms/[runId]/+server.js';

const origin = 'https://campus.example.test';
const NativeResponse = globalThis.Response;

class MemorySocket {
	attachment: unknown;
	messages: { type: string; code?: string; view?: QuizTeacherProjection }[] = [];
	closed = false;
	peer?: MemorySocket;
	serializeAttachment(value: unknown) {
		this.attachment = structuredClone(value);
	}
	deserializeAttachment() {
		return structuredClone(this.attachment);
	}
	send(message: string) {
		this.messages.push(JSON.parse(message));
	}
	close() {
		this.closed = true;
	}
}

class MemoryWebSocketPair {
	0: MemorySocket;
	1: MemorySocket;
	constructor() {
		this[0] = new MemorySocket();
		this[1] = new MemorySocket();
		this[0].peer = this[1];
		this[1].peer = this[0];
	}
}

const responseSockets = new WeakMap<Response, MemorySocket>();

class MemoryUpgradeResponse extends NativeResponse {
	private upgrade: boolean;
	constructor(body?: BodyInit | null, init: Omit<ResponseInit, 'webSocket'> & { webSocket?: MemorySocket } = {}) {
		super(body, {
			headers: init.headers,
			statusText: init.statusText,
			status: init.status === 101 ? 200 : init.status
		});
		this.upgrade = init.status === 101;
		if (init.webSocket) responseSockets.set(this, init.webSocket);
	}
	override get status() {
		return this.upgrade ? 101 : super.status;
	}
}

const memoryContext = () => {
	const entries = new Map<string, unknown>();
	const sockets: MemorySocket[] = [];
	let alarm: number | null = null;
	let commits = 0;
	return {
		sockets,
		get commits() {
			return commits;
		},
		setWebSocketAutoResponse: () => {},
		blockConcurrencyWhile: <T>(callback: () => Promise<T>) => callback(),
		acceptWebSocket: (socket: MemorySocket) => sockets.push(socket),
		getWebSockets: () => sockets.filter((socket) => !socket.closed),
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
			sync: async () => {
				commits++;
			}
		}
	};
};

const event = (
	path: string,
	params: Record<string, string>,
	locals: unknown,
	cookieValues = new Map<string, string>(),
	command?: unknown
) => {
	const url = new URL(origin + path);
	return {
		url,
		params,
		locals,
		request: new Request(url, {
			method: command ? 'POST' : 'GET',
			headers: { origin, ...(command ? { 'content-type': 'application/json' } : { Upgrade: 'websocket' }) },
			...(command ? { body: JSON.stringify(command) } : {})
		}),
		cookies: {
			get: (name: string) => cookieValues.get(name),
			set: (name: string, value: string) => cookieValues.set(name, value)
		}
	} as unknown as RequestEvent;
};

const serverSocket = (response: Response) => responseSockets.get(response)!.peer!;
const lastState = (socket: MemorySocket) => socket.messages.filter((message) => message.type === 'state').at(-1)!.view!;

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

it.each([
	'account',
	'session',
	'run',
	'archive',
	'unavailable',
	'legacy',
	'other session owner',
	'expired session'
] as const)(
	'stops private broadcasts after %s revocation while preserving participant acknowledgements',
	async (revocation) => {
		vi.stubGlobal('WebSocketPair', MemoryWebSocketPair);
		vi.stubGlobal('WebSocketRequestResponsePair', class {});
		vi.stubGlobal('Response', MemoryUpgradeResponse);
		const client = createClient({ url: ':memory:' });
		try {
			const db = createDatabase(client);
			await migrate(db, { migrationsFolder: './drizzle' });
			await client.execute('PRAGMA foreign_keys = ON');
			const ids = await seedFoundationFixtures(db);
			vi.mocked(withTeacherDatabase).mockImplementation(async (_locals, operation) => operation(db));
			vi.mocked(withPublicDatabase).mockImplementation(async (operation) => operation(db));
			const authorize = vi.fn((input: unknown) => isQuizTeacherAuthorized(db, input));
			const context = Object.assign(memoryContext(), { exports: { QuizAuthorization: { canReadTeacher: authorize } } });
			const room = new QuizRoom(context as unknown as DurableObjectState, {} as Cloudflare.Env);
			binding.idFromName.mockImplementation((id) => id);
			binding.get.mockReturnValue({
				rpc: (input: unknown) => room.rpc(input),
				fetch: (request: Request) => room.fetch(request)
			});
			const quizId = crypto.randomUUID();
			const lessonId = crypto.randomUUID();
			const groupId = crypto.randomUUID();
			const lineId = crypto.randomUUID();
			const questionId = crypto.randomUUID();
			const correctId = crypto.randomUUID();
			await db.insert(t.lessons).values({
				id: lessonId,
				contextId: ids.currentContext,
				title: 'Fictional audit lesson',
				startsAt: new Date(),
				endsAt: new Date(Date.now() + 3600000)
			});
			await db.insert(t.rubricGroups).values({ id: groupId, assessmentId: ids.quiz, title: 'Fictional audit quizzes' });
			await db
				.insert(t.rubricLines)
				.values({ id: lineId, assessmentId: ids.quiz, groupId, label: 'Fictional audit quiz', maxPoints: 1 });
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
					title: 'Fictional subscription audit',
					durationSeconds: 1200,
					questions: [
						{
							id: questionId,
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
			const review = (await getPublicationReview(db, ids.module, ids.currentContext)).selected!;
			await decidePublication(db, ids.teacher, ids.module, {
				requestId: crypto.randomUUID(),
				contextId: ids.currentContext,
				action: 'publish',
				expectedRevision: review.publicationRevision,
				moduleRevision: review.moduleRevision,
				contextRevision: review.contextRevision,
				classRevision: review.classRevision,
				confirm: true
			});
			const runId = crypto.randomUUID();
			await openQuizRoom(db, () => room, ids.teacher, { id: runId, quizId, expectedQuizRevision: 1 });
			const settings = { ORIGIN: origin, BETTER_AUTH_SECRET: 'fictional-quiz-subscription-audit-only-123456' };
			const auth = await createAuth(settings, client);
			const session = await (await auth.$context).internalAdapter.createSession(ids.teacher);
			const signature = await makeSignature(session.token, settings.BETTER_AUTH_SECRET);
			const cookie = '__Secure-coursely.session_token=' + encodeURIComponent(session.token + '.' + signature);
			const sessionHeaders = new Headers({ cookie });
			const principal = await auth.api.getSession({ headers: sessionHeaders });
			expect(principal?.user.id).toBe(ids.teacher);
			const teacherPath = '/api/teaching/quiz-rooms/' + runId;
			const teacherParams = { runId };
			const teacherResponse = await teacherRead(event(teacherPath, teacherParams, principal));
			expect(teacherResponse.status).toBe(101);
			const teacher = serverSocket(teacherResponse);
			expect(teacher.attachment).toMatchObject({
				actor: { kind: 'teacher' },
				expiresAt: principal!.session.expiresAt.getTime()
			});
			const contextId = (await db.select().from(t.publicModuleLinks))[0]?.id ?? ids.currentContext;
			const studentPath = '/api/quizzes/' + contextId + '/rooms/' + runId;
			const studentParams = { contextId, runId };
			const cookies = new Map<string, string>();
			const noPrincipal = { user: null, session: null };
			await prepareStudentQuiz(
				event(studentPath, studentParams, noPrincipal, cookies, {
					participantId: ids.students[0],
					fullscreenConfirmed: true
				})
			);
			expect(
				(
					await joinStudentQuiz(
						event(studentPath, studentParams, noPrincipal, cookies, {
							participantId: ids.students[0],
							fullscreenConfirmed: true
						})
					)
				).status
			).toBe(200);
			const studentResponse = await readStudentQuizRoom(event(studentPath, studentParams, noPrincipal, cookies));
			expect(studentResponse.status).toBe(101);
			const student = serverSocket(studentResponse);
			expect(
				(
					await teacherWrite(
						event(teacherPath, teacherParams, principal, new Map(), { type: 'start', requestId: crypto.randomUUID() })
					)
				).status
			).toBe(200);
			await room.webSocketMessage(
				teacher as unknown as WebSocket,
				JSON.stringify({ type: 'close', requestId: crypto.randomUUID() })
			);
			expect(teacher.messages.at(-1)?.code).toBe('forbidden');
			expect(lastState(teacher).status).toBe('running');
			const before = lastState(teacher).participants.find(
				(participant: { id: string }) => participant.id === ids.students[0]
			);
			expect(before?.points).toBeNull();
			teacher.messages = [];
			if (revocation === 'account') await revokeAccount(client, 'teacher@example.test');
			if (revocation === 'session') await db.delete(t.session).where(eq(t.session.id, session.id));
			if (revocation === 'run') await db.delete(t.quizRuns).where(eq(t.quizRuns.id, runId));
			if (revocation === 'archive')
				await db
					.update(t.teachingContexts)
					.set({ archivedAt: new Date() })
					.where(eq(t.teachingContexts.id, ids.currentContext));
			if (revocation === 'expired session')
				await db
					.update(t.session)
					.set({ expiresAt: new Date(0) })
					.where(eq(t.session.id, session.id));
			if (revocation === 'unavailable') authorize.mockRejectedValue(new Error('Fictional storage failure'));
			if (revocation === 'legacy')
				teacher.serializeAttachment({ actor: { kind: 'teacher' }, expiresAt: session.expiresAt.getTime() });
			if (revocation === 'other session owner') {
				const other = crypto.randomUUID();
				await db.insert(t.user).values({ id: other, name: 'Fictional other teacher', email: 'other@example.test' });
				await db.update(t.session).set({ userId: other }).where(eq(t.session.id, session.id));
			}
			// Reconstruct the object from persisted state and socket attachments.
			const resumedRoom = new QuizRoom(context as unknown as DurableObjectState, {} as Cloudflare.Env);
			const commitsBefore = context.commits;
			await resumedRoom.webSocketMessage(
				student as unknown as WebSocket,
				JSON.stringify({
					type: 'save_answers',
					requestId: crypto.randomUUID(),
					version: 1,
					answers: [{ questionId, optionIds: [correctId] }]
				})
			);
			await resumedRoom.webSocketMessage(
				student as unknown as WebSocket,
				JSON.stringify({ type: 'submit', requestId: crypto.randomUUID(), answerVersion: 1 })
			);
			expect(teacher.closed).toBe(true);
			expect(teacher.messages.filter((message) => message.type === 'state')).toEqual([]);
			expect(student.closed).toBe(false);
			expect(student.messages.filter((message) => message.type === 'ack')).toHaveLength(2);
			expect(context.commits).toBeGreaterThan(commitsBefore);
			expect(
				(await room.teacherState()).participants.find((participant) => participant.id === ids.students[0])
			).toMatchObject({ points: 1, status: 'submitted' });
			const rejected = await resumedRoom.fetch(
				new Request('https://quiz-room.internal/socket', {
					headers: {
						Upgrade: 'websocket',
						'x-campus-quiz-actor': '{"kind":"teacher"}',
						'x-campus-quiz-teacher': JSON.stringify({ teacherId: ids.teacher, sessionId: session.id }),
						'x-campus-quiz-issued-at': String(Date.now()),
						'x-campus-quiz-expires-at': String(session.expiresAt.getTime())
					}
				})
			);
			if (revocation !== 'legacy') expect(rejected.status).toBe(403);
		} finally {
			client.close();
		}
	}
);
