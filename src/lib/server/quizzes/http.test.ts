import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error, isHttpError, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import type { Database } from '../db/index.js';
const { namespace } = vi.hoisted(() => ({ namespace: { idFromName: vi.fn(), get: vi.fn() } }));
vi.mock('$app/env', () => ({ dev: false }));
vi.mock('cloudflare:workers', () => ({ env: { QUIZ_ROOMS: namespace } }));
vi.mock('../teaching/database.js', () => ({ withTeacherDatabase: vi.fn() }));
vi.mock('../teaching/public-database.js', () => ({ withPublicDatabase: vi.fn() }));
import { withTeacherDatabase } from '../teaching/database.js';
import { withPublicDatabase } from '../teaching/public-database.js';
import { POST as createQuiz } from '../../../routes/api/teaching/quizzes/+server.js';
import { POST as openRoom } from '../../../routes/api/teaching/quizzes/[quizId]/rooms/+server.js';
import { POST as teacherCommand } from '../../../routes/api/teaching/quiz-rooms/[runId]/+server.js';
import { GET as teacherRead } from '../../../routes/api/teaching/quiz-rooms/[runId]/+server.js';
import {
	GET as publicRead,
	PUT as studentPrepare,
	POST as studentJoin
} from '../../../routes/api/quizzes/[contextId]/rooms/[runId]/+server.js';
import { issueQuizCredential } from './credentials.js';
import { quizRoomStub, quizTeacherWrite } from './http.js';
import type { QuizRoomRpcInput, QuizRoomRpcValues } from './rpc.js';

const origin = 'https://campus.example';
type MutableEvent = { -readonly [K in keyof RequestEvent]: RequestEvent[K] };
const event = (authenticated = false, requestOrigin = origin): MutableEvent =>
	({
		url: new URL(origin + '/api/quizzes/example'),
		request: new Request(origin + '/api/quizzes/example', {
			method: 'POST',
			headers: { origin: requestOrigin, 'content-type': 'application/json' },
			body: 'invalid json'
		}),
		params: {},
		locals: authenticated
			? {
					user: { id: 'teacher', role: 'teacher' },
					session: { userId: 'teacher', expiresAt: new Date(Date.now() + 60000) }
				}
			: { user: null, session: null }
	}) as unknown as MutableEvent;

beforeEach(() => vi.clearAllMocks());
describe('quiz HTTP authorization boundaries', () => {
	it.each([403, 409, 422, 503])('retains controlled HTTP %s failures from an internal room call', async (status) => {
		namespace.get.mockReturnValue({
			rpc: async () => ({ ok: false, error: { kind: 'http', status, message: 'Controlled quiz failure.' } })
		});
		await expect(quizRoomStub(event(true), crypto.randomUUID()).teacherState()).rejects.toMatchObject({
			status,
			body: { message: 'Controlled quiz failure.' }
		});
	});
	it('binds grade transfers to the authenticated teacher identity rather than request JSON', async () => {
		const current = event(true);
		current.locals.session!.id = 'fictional-current-session';
		const input = {
			requestId: crypto.randomUUID(),
			quizId: crypto.randomUUID(),
			runId: crypto.randomUUID(),
			studentId: crypto.randomUUID(),
			expectedCorrectionRevision: 0,
			points: 0,
			source: 'absence' as const
		};
		const receipt = {
			requestId: input.requestId,
			quizId: input.quizId,
			runId: input.runId,
			studentId: input.studentId,
			reportId: crypto.randomUUID(),
			correctionRevision: 1
		};
		const rpc = vi.fn(async () => ({ ok: true, method: 'reportGrade', value: receipt }));
		namespace.get.mockReturnValue({ rpc });
		expect(await quizRoomStub(current, input.runId).reportGrade(input)).toEqual(receipt);
		expect(rpc).toHaveBeenCalledExactlyOnceWith({
			method: 'reportGrade',
			teacher: { teacherId: 'teacher', sessionId: 'fictional-current-session' },
			input
		});
		expect(() => quizRoomStub(event(), input.runId).reportGrade(input)).toThrow();
		expect(rpc).toHaveBeenCalledTimes(1);
		expect(withTeacherDatabase).not.toHaveBeenCalled();
	});
	it.each([createQuiz, openRoom, teacherCommand, teacherRead])(
		'authenticates teacher endpoints before JSON or database access',
		async (handler) => {
			const response = await handler(event());
			expect(response.status).toBe(401);
			expect(response.headers.get('cache-control')).toContain('no-store');
			expect(withTeacherDatabase).not.toHaveBeenCalled();
		}
	);
	it.each([createQuiz, openRoom, teacherCommand])(
		'refuses foreign teacher writes before decoding JSON',
		async (handler) => {
			expect((await handler(event(true, 'https://foreign.example'))).status).toBe(403);
			expect(withTeacherDatabase).not.toHaveBeenCalled();
		}
	);
	it.each([studentPrepare, studentJoin])(
		'refuses cross-origin student admission before decoding or reading the roster',
		async (handler) => {
			expect((await handler(event(false, 'https://foreign.example'))).status).toBe(403);
			expect(withPublicDatabase).not.toHaveBeenCalled();
		}
	);
	it('refuses a cross-origin WebSocket upgrade before looking up the room', async () => {
		const requestEvent = event(false, 'https://foreign.example');
		requestEvent.request = new Request(requestEvent.url, {
			headers: {
				origin: 'https://foreign.example',
				Upgrade: 'websocket',
				'x-campus-quiz-actor': '{"kind":"teacher"}'
			}
		});
		expect((await publicRead(requestEvent)).status).toBe(403);
		expect(withPublicDatabase).not.toHaveBeenCalled();
	});
});

describe('quiz RPC error boundaries', () => {
	it('preserves a serialized business conflict before the private database failure wrapper', async () => {
		const current = event(true);
		current.request = new Request(current.url, {
			method: 'POST',
			headers: { origin, 'content-type': 'application/json' },
			body: '{}'
		});
		const runId = crypto.randomUUID();
		namespace.get.mockReturnValue({
			rpc: async () => ({
				ok: false,
				error: { kind: 'domain', code: 'version_conflict', message: 'Le temps a changé.' }
			})
		});
		vi.mocked(withTeacherDatabase).mockImplementation(async (_locals, operation) => {
			try {
				return await operation({} as Database);
			} catch (cause) {
				if (isHttpError(cause)) throw cause;
				error(503, 'Private database unavailable.');
			}
		});
		const handler = quizTeacherWrite(z.strictObject({}), async (_db, request) =>
			quizRoomStub(request, runId).command({ kind: 'teacher' }, { type: 'start', requestId: crypto.randomUUID() })
		);
		const response = await handler(current);
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ message: 'Le temps a changé.' });
	});
	it('preserves only the explicit not-initialized sentinel for first room creation', async () => {
		namespace.get.mockReturnValue({
			rpc: async () => ({
				ok: false,
				error: {
					kind: 'room',
					code: 'quiz_room_not_initialized',
					message: 'Room not initialized.'
				}
			})
		});
		await expect(quizRoomStub(event(), crypto.randomUUID()).teacherState()).rejects.toThrow(
			'quiz_room_not_initialized'
		);
	});
	it.each([
		{ ok: false, error: { kind: 'domain', code: 'invented', message: 'Internal details' } },
		{ ok: true, method: 'purge', value: null }
	])('refuses malformed or mismatched RPC responses', async (result) => {
		namespace.get.mockReturnValue({ rpc: async () => result });
		await expect(quizRoomStub(event(), crypto.randomUUID()).teacherState()).rejects.toThrow();
	});
});

const studentEvent = (credential?: string) => {
	const current = event();
	current.params = { contextId: crypto.randomUUID(), runId: crypto.randomUUID() };
	current.cookies = { get: () => credential, set: vi.fn() } as unknown as RequestEvent['cookies'];
	return current;
};

const mockRoom = (methods: {
	teacherState?: () => Promise<unknown>;
	command?: (...args: unknown[]) => Promise<unknown>;
	admissionState?: (
		actor: Extract<QuizRoomRpcInput, { method: 'admissionState' }>['actor']
	) => Promise<QuizRoomRpcValues['admissionState']>;
	fetch?: (request: Request) => Promise<Response>;
}) => {
	namespace.get.mockReturnValue({
		fetch: methods.fetch,
		rpc: async (input: Extract<QuizRoomRpcInput, { method: 'teacherState' | 'command' | 'admissionState' }>) => ({
			ok: true,
			method: input.method,
			value:
				input.method === 'teacherState'
					? await methods.teacherState!()
					: input.method === 'admissionState'
						? await (methods.admissionState?.(input.actor) ?? {
								joined: true,
								participantId: input.actor.participantId,
								available: true
							})
						: await methods.command!(input.actor, input.command)
		})
	});
};

describe('student quiz admission and projection', () => {
	it('never claims a roster identity before the browser has acknowledged its room credential', async () => {
		const current = studentEvent();
		current.request = new Request(current.url, {
			method: 'POST',
			headers: { origin, 'content-type': 'application/json' },
			body: JSON.stringify({ participantId: crypto.randomUUID(), fullscreenConfirmed: true })
		});
		vi.mocked(withPublicDatabase).mockResolvedValue(undefined);
		const command = vi.fn(async () => ({}));
		mockRoom({ command });
		expect((await studentJoin(current)).status).toBe(428);
		expect(command).not.toHaveBeenCalled();
		expect(current.cookies.set).not.toHaveBeenCalled();
	});

	it.each([true, false])('admits a student with fullscreen reported as %s', async (fullscreenConfirmed) => {
		const id = crypto.randomUUID();
		const current = studentEvent(issueQuizCredential(id));
		current.request = new Request(current.url, {
			method: 'POST',
			headers: { origin, 'content-type': 'application/json' },
			body: JSON.stringify({ participantId: id, fullscreenConfirmed })
		});
		vi.mocked(withPublicDatabase).mockResolvedValue(undefined);
		const command = vi.fn(async () => ({}));
		mockRoom({ command, admissionState: async () => ({ joined: false, participantId: null, available: true }) });
		const response = await studentJoin(current);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ joined: true });
		expect(withPublicDatabase).toHaveBeenCalledOnce();
		expect(command).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'participant', participantId: id }),
			expect.objectContaining({ type: 'join' })
		);
		expect(current.cookies.set).not.toHaveBeenCalled();
	});
	it.each([undefined, 'false', null])(
		'rejects a missing or malformed fullscreen report: %s',
		async (fullscreenConfirmed) => {
			const current = studentEvent();
			current.request = new Request(current.url, {
				method: 'POST',
				headers: { origin, 'content-type': 'application/json' },
				body: JSON.stringify({ participantId: crypto.randomUUID(), fullscreenConfirmed })
			});
			expect((await studentJoin(current)).status).toBe(422);
			expect(withPublicDatabase).not.toHaveBeenCalled();
			expect(namespace.get).not.toHaveBeenCalled();
		}
	);
	it('offers unclaimed roster names for a late arrival without exposing answers or marks', async () => {
		const current = studentEvent();
		const id = crypto.randomUUID();
		vi.mocked(withPublicDatabase).mockResolvedValue(undefined);
		mockRoom({
			teacherState: async () => ({
				id: current.params.runId,
				title: 'Fictional quiz',
				status: 'running',
				participants: [
					{ id, name: 'Unclaimed name', status: 'not_joined', points: 0, incidents: [] },
					{ id: crypto.randomUUID(), name: 'Already claimed', status: 'active', points: 1 }
				]
			})
		});
		const response = await publicRead(current);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			id: current.params.runId,
			title: 'Fictional quiz',
			status: 'running',
			roster: [{ id, name: 'Unclaimed name' }],
			joined: false,
			preparedParticipantId: null
		});
	});
	it('reuses an existing room credential for a retry without reclaiming another identity', async () => {
		const id = crypto.randomUUID();
		const current = studentEvent(issueQuizCredential(id));
		current.request = new Request(current.url, {
			method: 'POST',
			headers: { origin, 'content-type': 'application/json' },
			body: JSON.stringify({ participantId: id, fullscreenConfirmed: true })
		});
		vi.mocked(withPublicDatabase).mockResolvedValue(undefined);
		const command = vi.fn(async () => ({}));
		mockRoom({ command });
		expect((await studentJoin(current)).status).toBe(200);
		expect(command).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'participant', participantId: id }),
			expect.objectContaining({ type: 'reconnect' })
		);
		expect(current.cookies.set).not.toHaveBeenCalled();
	});
	it.each(['initial', 'corrected'] as const)(
		'rebuilds trusted WebSocket actor headers for the %s name, ignoring forged teacher headers',
		async (name) => {
			const id = crypto.randomUUID();
			const current = studentEvent(issueQuizCredential(name === 'initial' ? id : crypto.randomUUID()));
			current.request = new Request(current.url, {
				headers: {
					origin,
					Upgrade: 'websocket',
					'x-campus-quiz-actor': '{"kind":"teacher"}',
					'x-campus-quiz-expires-at': '9999999999999999'
				}
			});
			vi.mocked(withPublicDatabase).mockResolvedValue(undefined);
			const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response('Fictional socket bridge'));
			mockRoom({
				command: vi.fn(async () => ({})),
				fetch,
				admissionState: async () => ({ joined: true, participantId: id, available: name === 'initial' })
			});
			expect((await publicRead(current)).status).toBe(200);
			const internal = fetch.mock.calls[0][0] as Request;
			expect(JSON.parse(internal.headers.get('x-campus-quiz-actor')!)).toMatchObject({
				kind: 'participant',
				participantId: id
			});
			expect(Number(internal.headers.get('x-campus-quiz-expires-at'))).toBeLessThanOrEqual(Date.now() + 8 * 3600000);
		}
	);
	it('refuses a WebSocket before a prepared credential has claimed a student', async () => {
		const current = studentEvent(issueQuizCredential(crypto.randomUUID()));
		current.request = new Request(current.url, { headers: { origin, Upgrade: 'websocket' } });
		vi.mocked(withPublicDatabase).mockResolvedValue(undefined);
		const command = vi.fn(async () => ({}));
		const fetch = vi.fn(async () => new Response('Fictional socket bridge'));
		mockRoom({
			command,
			fetch,
			admissionState: async () => ({ joined: false, participantId: null, available: true })
		});
		expect((await publicRead(current)).status).toBe(401);
		expect(command).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});
});
