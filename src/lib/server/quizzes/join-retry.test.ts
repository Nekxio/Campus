import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type { QuizRoomRpcInput } from './rpc.js';
const { namespace } = vi.hoisted(() => ({ namespace: { idFromName: vi.fn(), get: vi.fn() } }));
vi.mock('$app/env', () => ({ dev: false }));
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
vi.mock('../teaching/database.js', () => ({ withTeacherDatabase: vi.fn() }));
vi.mock('../teaching/public-database.js', () => ({ withPublicDatabase: vi.fn() }));
import { withPublicDatabase } from '../teaching/public-database.js';
import { QuizRoom } from './room.js';
import { issueQuizCredential } from './credentials.js';
import { prepareStudentQuiz, joinStudentQuiz, readStudentQuizRoom } from './http.js';

const origin = 'https://campus.example';
const fixture = async () => {
	vi.stubGlobal('WebSocketRequestResponsePair', class {});
	vi.mocked(withPublicDatabase).mockResolvedValue(undefined);
	const runId = crypto.randomUUID();
	const contextId = crypto.randomUUID();
	const roster = [
		{ id: crypto.randomUUID(), name: 'Fictional First' },
		{ id: crypto.randomUUID(), name: 'Fictional Second' }
	];
	const entries = new Map<string, unknown>();
	let alarm: number | null = null;
	const context = {
		setWebSocketAutoResponse: () => {},
		getWebSockets: () => [],
		storage: {
			kv: {
				get: (key: string) => entries.get(key),
				put: (key: string, value: unknown) => entries.set(key, value),
				delete: (key: string) => entries.delete(key)
			},
			transactionSync: <T>(operation: () => T) => operation(),
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
	const room = new QuizRoom(context as unknown as DurableObjectState, {} as Cloudflare.Env);
	const correctId = crypto.randomUUID();
	await room.initialize({
		id: runId,
		shuffleSeed: 'retry-test',
		createdAt: Date.now(),
		roster,
		content: {
			version: 1,
			title: 'Fictional retry quiz',
			durationSeconds: 600,
			questions: [
				{
					id: crypto.randomUUID(),
					type: 'single',
					prompt: 'Which value?',
					code: '',
					codeLanguage: '',
					options: [
						{ id: correctId, text: 'First' },
						{ id: crypto.randomUUID(), text: 'Second' }
					],
					correctOptionIds: [correctId]
				}
			]
		}
	});
	let loseRpcResponse = false;
	const actors: string[] = [];
	namespace.get.mockReturnValue({
		rpc: async (input: QuizRoomRpcInput) => {
			const result = await room.rpc(input);
			if (input.method === 'command' && input.actor.kind === 'participant') {
				actors.push(input.actor.credentialHash);
				if (loseRpcResponse) {
					loseRpcResponse = false;
					throw new Error('Lost RPC response after durable commit');
				}
			}
			return result;
		}
	});
	const jar = new Map<string, string>();
	const path = `/api/quizzes/${contextId}/rooms/${runId}`;
	const dispatch = async (
		handler: (event: RequestEvent) => Promise<Response>,
		participantId = roster[0].id,
		deliverCookies = true,
		cookieJar = jar
	) => {
		const staged = new Map<string, string>();
		const set = vi.fn((name: string, value: string) => staged.set(name, value));
		const url = new URL(origin + path);
		const response = await handler({
			url,
			params: { contextId, runId },
			locals: { user: null, session: null },
			request: new Request(url, {
				method: handler === readStudentQuizRoom ? 'GET' : 'POST',
				headers: { origin, 'content-type': 'application/json' },
				...(handler === readStudentQuizRoom
					? {}
					: { body: JSON.stringify({ participantId, fullscreenConfirmed: true }) })
			}),
			cookies: { get: (name: string) => cookieJar.get(name), set }
		} as unknown as RequestEvent);
		if (deliverCookies) for (const [name, value] of staged) cookieJar.set(name, value);
		expect(response.headers.get('cache-control')).toContain('no-store');
		return { response, set };
	};
	return {
		room,
		roster,
		jar,
		path,
		dispatch,
		actors,
		loseRpc: () => {
			loseRpcResponse = true;
		}
	};
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('first quiz claim response loss', () => {
	it.each(['lobby', 'running'] as const)(
		'recovers the same durable claim in a %s room after losing its RPC response',
		async (status) => {
			const f = await fixture();
			expect((await f.dispatch(prepareStudentQuiz)).response.status).toBe(200);
			if (status === 'running')
				await f.room.command({ kind: 'teacher' }, { type: 'start', requestId: crypto.randomUUID() });
			const credential = f.jar.get('coursely_quiz');
			f.loseRpc();
			expect((await f.dispatch(joinStudentQuiz)).response.status).toBe(503);
			const committed = (await f.room.teacherState()).participants[0];
			expect(committed.status).toBe(status === 'lobby' ? 'lobby' : 'awaiting_admission');
			expect((await f.dispatch(prepareStudentQuiz)).response.status).toBe(200);
			expect((await f.dispatch(joinStudentQuiz)).response.status).toBe(200);
			expect(f.jar.get('coursely_quiz')).toBe(credential);
			expect(f.actors).toHaveLength(2);
			expect(f.actors[0]).toBe(f.actors[1]);
			expect((await f.room.teacherState()).participants[1].status).toBe('not_joined');
		}
	);

	it('recovers after losing the entire first claim HTTP response and starting the quiz', async () => {
		const f = await fixture();
		await f.dispatch(prepareStudentQuiz);
		expect((await f.dispatch(joinStudentQuiz, f.roster[0].id, false)).response.status).toBe(200);
		await f.room.command({ kind: 'teacher' }, { type: 'start', requestId: crypto.randomUUID() });
		const before = (await f.room.teacherState()).participants[0];
		expect(before.status).toBe('active');
		const read = await (await f.dispatch(readStudentQuizRoom)).response.json();
		expect(read).toMatchObject({ joined: true, preparedParticipantId: null });
		expect((await f.dispatch(joinStudentQuiz)).response.status).toBe(200);
		const after = (await f.room.teacherState()).participants[0];
		expect(after.startedAt).toBe(before.startedAt);
		expect(after.deadlineAt).toBe(before.deadlineAt);
		expect(f.actors[0]).toBe(f.actors[1]);
	});

	it.each(['lobby', 'running'] as const)('corrects a prepared name before claiming it in a %s room', async (status) => {
		const f = await fixture();
		await f.dispatch(prepareStudentQuiz);
		const credential = f.jar.get('coursely_quiz');
		if (status === 'running')
			await f.room.command({ kind: 'teacher' }, { type: 'start', requestId: crypto.randomUUID() });
		expect((await f.dispatch(prepareStudentQuiz, f.roster[1].id)).response.status).toBe(200);
		f.loseRpc();
		expect((await f.dispatch(joinStudentQuiz, f.roster[1].id)).response.status).toBe(503);
		expect(await (await f.dispatch(readStudentQuizRoom)).response.json()).toMatchObject({ joined: true });
		expect((await f.dispatch(joinStudentQuiz, f.roster[1].id)).response.status).toBe(200);
		expect((await f.dispatch(joinStudentQuiz, f.roster[0].id)).response.status).toBe(409);
		expect(f.jar.get('coursely_quiz')).toBe(credential);
		const view = await f.room.teacherState();
		expect(view.participants[0].status).toBe('not_joined');
		expect(view.participants[1].status).toBe(status === 'lobby' ? 'lobby' : 'awaiting_admission');
	});

	it('keeps an unclaimed preparation usable after another browser claims its original name', async () => {
		const f = await fixture();
		await f.dispatch(prepareStudentQuiz);
		const other = new Map<string, string>();
		await f.dispatch(prepareStudentQuiz, f.roster[0].id, true, other);
		await f.dispatch(joinStudentQuiz, f.roster[0].id, true, other);
		const read = await (await f.dispatch(readStudentQuizRoom)).response.json();
		expect(read).toMatchObject({ joined: false, preparedParticipantId: null, roster: [f.roster[1]] });
		expect((await f.dispatch(prepareStudentQuiz, f.roster[0].id)).response.status).toBe(409);
		expect((await f.dispatch(prepareStudentQuiz, f.roster[1].id)).response.status).toBe(200);
		expect((await f.dispatch(joinStudentQuiz, f.roster[1].id)).response.status).toBe(200);
	});

	it('claims only one student when two requests race with the same prepared cookie', async () => {
		const f = await fixture();
		await f.dispatch(prepareStudentQuiz);
		const responses = await Promise.all(f.roster.map((student) => f.dispatch(joinStudentQuiz, student.id)));
		expect(responses.map(({ response }) => response.status).sort()).toEqual([200, 409]);
		const view = await f.room.teacherState();
		expect(view.participants.filter((student) => student.status !== 'not_joined')).toHaveLength(1);
	});

	it.each([true, false])(
		'loses only bootstrap response with cookie delivery %s without claiming any student',
		async (deliverCookies) => {
			const f = await fixture();
			await f.dispatch(prepareStudentQuiz, f.roster[0].id, deliverCookies);
			expect((await f.room.teacherState()).participants.every((entry) => entry.status === 'not_joined')).toBe(true);
			const retry = await f.dispatch(prepareStudentQuiz);
			expect(retry.response.status).toBe(200);
			expect(retry.set).toHaveBeenCalledTimes(deliverCookies ? 0 : 1);
			const read = await (await f.dispatch(readStudentQuizRoom)).response.json();
			expect(read).toEqual({
				id: expect.any(String),
				title: 'Fictional retry quiz',
				status: 'lobby',
				joined: false,
				preparedParticipantId: f.roster[0].id,
				roster: f.roster
			});
			expect((await f.dispatch(joinStudentQuiz)).response.status).toBe(200);
		}
	);

	it('keeps cookie security and refuses another identity, another hash and revoked access', async () => {
		const f = await fixture();
		const prepared = await f.dispatch(prepareStudentQuiz);
		expect(prepared.set).toHaveBeenCalledWith('coursely_quiz', expect.any(String), {
			path: f.path,
			httpOnly: true,
			secure: true,
			sameSite: 'strict',
			maxAge: 8 * 3600
		});
		await f.dispatch(joinStudentQuiz);
		for (const handler of [prepareStudentQuiz, joinStudentQuiz])
			expect((await f.dispatch(handler, f.roster[1].id)).response.status).toBe(409);
		const wrong = new Map([['coursely_quiz', issueQuizCredential(f.roster[0].id)]]);
		for (const handler of [prepareStudentQuiz, joinStudentQuiz])
			expect((await f.dispatch(handler, f.roster[0].id, true, wrong)).response.status).toBe(409);
		const publicRead = await f.dispatch(readStudentQuizRoom, f.roster[0].id, true, wrong);
		expect(publicRead.response.status).toBe(200);
		expect(await publicRead.response.json()).toEqual({
			id: expect.any(String),
			title: 'Fictional retry quiz',
			status: 'lobby',
			roster: [f.roster[1]],
			joined: false,
			preparedParticipantId: null
		});
		await f.room.command(
			{ kind: 'teacher' },
			{ type: 'remove_lobby', participantId: f.roster[0].id, requestId: crypto.randomUUID() }
		);
		expect((await f.dispatch(joinStudentQuiz)).response.status).toBe(409);
		expect((await f.dispatch(prepareStudentQuiz, f.roster[1].id)).response.status).toBe(409);
		expect((await f.dispatch(joinStudentQuiz, f.roster[1].id)).response.status).toBe(409);
		expect((await f.dispatch(readStudentQuizRoom)).response.status).toBe(409);
		expect((await f.room.teacherState()).participants[1].status).toBe('not_joined');
	});
});
