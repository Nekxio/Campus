import { DurableObject } from 'cloudflare:workers';
import { error, isHttpError } from '@sveltejs/kit';
import {
	applyQuizSessionCommand,
	createQuizRetakeSession,
	createQuizSession,
	expireQuizSession,
	getQuizSessionDeadline,
	projectQuizSessionForParticipant,
	projectQuizSessionForTeacher,
	quizSessionActorSchema,
	quizSessionCommandSchema,
	QuizSessionError,
	type QuizRetakeCreate,
	type QuizSessionActor,
	type QuizSessionCommand,
	type QuizSessionState,
	type QuizTeacherProjection
} from '#lib/domain/quiz-session.js';
import { idSchema } from '#lib/domain/contracts.js';
import {
	quizRoomErrorCodeSchema,
	quizRoomRpcErrorSchema,
	quizRoomRpcInputSchema,
	quizGradeTransferSchema,
	type QuizRoomRpcResult
} from './rpc.js';
import { z } from 'zod';
import { quizTeacherIdentitySchema } from './rpc.js';
import type { QuizAuthorization } from './authorization-worker.js';
import { createDatabase, createTursoClient } from '../db/index.js';
import { isQuizTeacherAuthorized } from './teacher-authorization.js';
import { reportQuizRoomGrade } from '../teaching/quiz-rooms.js';
import { privateFailureReason } from '../auth/failure-reason.js';

type QuizRoomInput = Parameters<typeof createQuizSession>[0];
type ParticipantActor = Extract<QuizSessionActor, { kind: 'participant' }>;
const quizRoomConnectionSchema = z
	.strictObject({
		actor: quizSessionActorSchema,
		expiresAt: z.int().nonnegative(),
		teacher: quizTeacherIdentitySchema.optional()
	})
	.refine((connection) => (connection.actor.kind === 'teacher') === Boolean(connection.teacher));
type QuizRoomConnection = z.infer<typeof quizRoomConnectionSchema>;
type QuizRoomRecord = {
	storageVersion: 1;
	state: Omit<QuizSessionState, 'content' | 'participants' | 'excludedParticipants'>;
	participantIds: string[];
	excludedParticipantIds: string[];
};

const stateKey = 'quiz-session';
const contentKey = 'quiz-content';
const participantKeyPrefix = 'quiz-participant:';
const initializationKey = 'quiz-initialization';
const purgedKey = 'quiz-purged';
const maxMessageBytes = 256 * 1024;
const maxConnectionLifetime = 8 * 60 * 60 * 1000;
const participantSocketCommands = new Set<QuizSessionCommand['type']>([
	'save_answers',
	'submit',
	'report_incident',
	'consume_review'
]);
const projectForActor = (state: QuizSessionState, actor: QuizSessionActor, now: number) =>
	actor.kind === 'teacher'
		? projectQuizSessionForTeacher(state, now)
		: projectQuizSessionForParticipant(state, actor, now);

const initializationSnapshot = (state: QuizSessionState) =>
	JSON.stringify({
		id: state.id,
		sourceSessionId: state.sourceSessionId,
		createdAt: state.createdAt,
		content: state.content,
		roster: state.participants.map(({ id, name, questionOrder, optionOrder }) => ({
			id,
			name,
			questionOrder,
			optionOrder
		}))
	});

const connectionFromRequest = (request: Request, now: number): QuizRoomConnection | null => {
	try {
		const rawActor = request.headers.get('x-campus-quiz-actor');
		if (!rawActor || rawActor.length > 1024) return null;
		const rawTeacher = request.headers.get('x-campus-quiz-teacher');
		if (rawTeacher && rawTeacher.length > 1024) return null;
		const expiresAt = Number(request.headers.get('x-campus-quiz-expires-at'));
		if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + maxConnectionLifetime) return null;
		const connection = quizRoomConnectionSchema.safeParse({
			actor: JSON.parse(rawActor),
			expiresAt,
			...(rawTeacher ? { teacher: JSON.parse(rawTeacher) } : {})
		});
		return connection.success ? connection.data : null;
	} catch {
		return null;
	}
};

export class QuizRoom extends DurableObject<Cloudflare.Env> {
	// Wrangler cannot infer loopback exports before SvelteKit builds the worker entry point.
	declare protected ctx: DurableObject<Cloudflare.Env>['ctx'] & {
		readonly exports: { QuizAuthorization: Service<QuizAuthorization> };
	};

	constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
		super(ctx, env);
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
	}

	async rpc(value: unknown): Promise<QuizRoomRpcResult> {
		const checked = quizRoomRpcInputSchema.safeParse(value);
		if (!checked.success)
			return {
				ok: false,
				error: {
					kind: 'invalid_input',
					code: 'invalid_input',
					message: 'La commande de quiz est invalide.'
				}
			};
		const input = checked.data;
		try {
			switch (input.method) {
				case 'initialize':
					return { ok: true, method: input.method, value: await this.initialize(input.input) };
				case 'teacherState':
					return { ok: true, method: input.method, value: await this.teacherState() };
				case 'reportGrade':
					return {
						ok: true,
						method: input.method,
						value: await this.reportGrade({ teacher: input.teacher, input: input.input })
					};
				case 'command':
					return {
						ok: true,
						method: input.method,
						value: await this.command(input.actor, input.command)
					};
				case 'createRetake':
					return { ok: true, method: input.method, value: await this.createRetake(input.input) };
				case 'participantState':
					return {
						ok: true,
						method: input.method,
						value: await this.participantState(input.actor)
					};
				case 'admissionState':
					return { ok: true, method: input.method, value: this.admissionState(input.actor) };
				case 'purge':
					await this.purge();
					return { ok: true, method: input.method, value: null };
			}
		} catch (cause) {
			if (isHttpError(cause)) {
				const failure = quizRoomRpcErrorSchema.safeParse({
					kind: 'http',
					status: cause.status,
					message: cause.body.message
				});
				return {
					ok: false,
					error: failure.success
						? failure.data
						: { kind: 'http', status: 503, message: 'Le transfert des notes est temporairement indisponible.' }
				};
			}
			if (cause instanceof QuizSessionError)
				return {
					ok: false,
					error: { kind: 'domain', code: cause.code, message: cause.message }
				};
			if (cause instanceof Error) {
				const code = quizRoomErrorCodeSchema.safeParse(cause.message);
				if (code.success) return { ok: false, error: { kind: 'room', code: code.data, message: code.data } };
			}
			throw cause;
		}
	}

	async initialize(input: QuizRoomInput, sourceSessionId: string | null = null): Promise<QuizTeacherProjection> {
		const candidate = createQuizSession(input);
		candidate.sourceSessionId = idSchema.nullable().parse(sourceSessionId);
		if (candidate.sourceSessionId === candidate.id) throw new Error('quiz_room_identity_conflict');
		const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(initializationSnapshot(candidate)));
		const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
		this.ctx.storage.transactionSync(() => {
			if (this.ctx.storage.kv.get<boolean>(purgedKey)) throw new Error('quiz_room_purged');
			const existing = this.ctx.storage.kv.get<string>(stateKey);
			if (existing && this.ctx.storage.kv.get<string>(initializationKey) !== fingerprint)
				throw new Error('quiz_room_identity_conflict');
			if (!existing) {
				this.#writeState(candidate);
				this.ctx.storage.kv.put(initializationKey, fingerprint);
			}
		});
		await this.#settle();
		return projectQuizSessionForTeacher(this.#load(), Date.now());
	}

	async createRetake(input: QuizRetakeCreate): Promise<QuizTeacherProjection> {
		const retake = createQuizRetakeSession(this.#load(), input);
		// Adapter 8 cannot discover this custom RPC class during a clean type generation.
		const rooms = this.env.QUIZ_ROOMS as DurableObjectNamespace<QuizRoom>;
		return rooms.getByName(retake.id).initialize(
			{
				id: retake.id,
				content: retake.content,
				roster: retake.participants.map(({ id, name }) => ({ id, name })),
				shuffleSeed: input.shuffleSeed,
				createdAt: retake.createdAt
			},
			retake.sourceSessionId
		);
	}

	async purge() {
		if (!this.ctx.storage.kv.get<boolean>(purgedKey)) {
			if (this.#load().status !== 'closed')
				throw new QuizSessionError('invalid_state', 'Clôturez la salle avant de la supprimer.');
			for (const socket of this.ctx.getWebSockets()) socket.close(1001, 'Session removed');
			this.ctx.storage.transactionSync(() => {
				const keys = Array.from(this.ctx.storage.kv.list(), ([key]) => key);
				for (const key of keys) this.ctx.storage.kv.delete(key);
				// A retried SQL opening must never recreate an annually purged room.
				this.ctx.storage.kv.put(purgedKey, true);
			});
		}
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.sync();
	}

	async command(actor: QuizSessionActor, command: QuizSessionCommand) {
		const response = await this.#execute(actor, command);
		await this.#broadcast(actor.kind === 'participant' ? actor.participantId : undefined);
		return response;
	}

	async teacherState() {
		await this.#expire();
		return projectQuizSessionForTeacher(this.#load(), Date.now());
	}

	async reportGrade(value: unknown) {
		const checked = quizGradeTransferSchema.safeParse(value);
		if (!checked.success) error(422, 'Le transfert de note est invalide.');
		const { teacher, input } = checked.data;
		const state = this.#load();
		const rooms = this.env.QUIZ_ROOMS as DurableObjectNamespace<QuizRoom>;
		if (state.status !== 'closed' || state.id !== input.runId || !rooms.idFromName(input.runId).equals(this.ctx.id))
			error(409, 'La salle ou les notes ont changé. Actualisez avant de réessayer.');
		const settings = z.object({ TURSO_DATABASE_URL: z.string(), TURSO_AUTH_TOKEN: z.string() }).safeParse(this.env);
		if (!settings.success) error(503, 'Le transfert des notes doit être configuré.');
		let client: ReturnType<typeof createTursoClient> | undefined;
		try {
			client = createTursoClient(settings.data.TURSO_DATABASE_URL, settings.data.TURSO_AUTH_TOKEN);
			const db = createDatabase(client);
			if (!(await isQuizTeacherAuthorized(db, { ...teacher, runId: state.id }))) error(403, 'Accès refusé.');
			return await reportQuizRoomGrade(
				db,
				teacher.teacherId,
				projectQuizSessionForTeacher(this.#load(), Date.now()),
				input
			);
		} catch (cause) {
			if (isHttpError(cause)) throw cause;
			console.error(
				JSON.stringify({ event: 'campus.private.unavailable', phase: 'operation', reason: privateFailureReason(cause) })
			);
			error(503, 'Le transfert des notes est temporairement indisponible.');
		} finally {
			client?.close();
		}
	}

	admissionState(actor: ParticipantActor) {
		const parsed = quizSessionActorSchema.parse(actor);
		if (parsed.kind !== 'participant') throw new Error('quiz_participant_required');
		const state = this.#load();
		if (state.revokedCredentialHashes.includes(parsed.credentialHash))
			throw new QuizSessionError('credentials_conflict', 'Cet étudiant est déjà lié à un autre accès.');
		const bound = state.participants.find((entry) => entry.credentialHash === parsed.credentialHash);
		const participant = state.participants.find((entry) => entry.id === parsed.participantId);
		return {
			joined: bound !== undefined,
			participantId: bound?.id ?? null,
			available:
				participant !== undefined &&
				(participant.credentialHash === null || participant.credentialHash === parsed.credentialHash)
		};
	}

	async participantState(actor: ParticipantActor) {
		const parsedActor = quizSessionActorSchema.parse(actor);
		if (parsedActor.kind !== 'participant') throw new Error('quiz_participant_required');
		await this.#expire();
		return projectQuizSessionForParticipant(this.#load(), parsedActor, Date.now());
	}

	override async fetch(request: Request): Promise<Response> {
		if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
			return new Response(null, { status: 426 });
		// Only the authenticated application gateway may construct these internal headers.
		const connection = connectionFromRequest(request, Date.now());
		if (!connection) return new Response(null, { status: 403 });
		if (!(await this.#authorized(connection))) return new Response(null, { status: 403 });
		await this.#expire();
		let view;
		try {
			view = projectForActor(this.#load(), connection.actor, Date.now());
		} catch (cause) {
			if (cause instanceof QuizSessionError) return new Response(null, { status: 403 });
			throw cause;
		}
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment(connection);
		if (connection.expiresAt <= Date.now()) {
			server.close(1008, 'Participation expired');
			return new Response(null, { status: 403 });
		}
		server.send(JSON.stringify({ type: 'state', view }));
		return new Response(null, {
			status: 101,
			webSocket: client,
			headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }
		});
	}

	override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
		const connection = this.#connection(socket);
		if (!connection) return;
		if (typeof message !== 'string' || new TextEncoder().encode(message).byteLength > maxMessageBytes) {
			socket.close(1009, 'Message too large');
			return;
		}
		let command;
		try {
			const parsed = quizSessionCommandSchema.safeParse(JSON.parse(message));
			if (!parsed.success) {
				socket.send(JSON.stringify({ type: 'error', code: 'invalid_command' }));
				return;
			}
			command = parsed.data;
		} catch {
			socket.send(JSON.stringify({ type: 'error', code: 'invalid_command' }));
			return;
		}
		if (connection.actor.kind === 'teacher' || !participantSocketCommands.has(command.type)) {
			socket.send(JSON.stringify({ type: 'error', code: 'forbidden', requestId: command.requestId }));
			return;
		}
		try {
			const result = await this.#execute(connection.actor, command);
			socket.send(JSON.stringify({ type: 'ack', ...result }));
			await this.#broadcast(connection.actor.kind === 'participant' ? connection.actor.participantId : undefined);
		} catch (cause) {
			if (cause instanceof QuizSessionError) {
				socket.send(JSON.stringify({ type: 'error', code: cause.code, requestId: command.requestId }));
			} else {
				socket.close(1011, 'Answer not confirmed');
			}
		}
	}

	override async webSocketClose(socket: WebSocket) {
		await this.#disconnect(socket);
	}

	override async webSocketError(socket: WebSocket) {
		await this.#disconnect(socket);
	}

	override async alarm() {
		if (this.ctx.storage.kv.get<boolean>(purgedKey)) return;
		await this.#expire();
		await this.#broadcast();
	}

	#load = (): QuizSessionState => {
		if (this.ctx.storage.kv.get<boolean>(purgedKey)) throw new Error('quiz_room_purged');
		const raw = this.ctx.storage.kv.get<string>(stateKey);
		if (!raw) throw new Error('quiz_room_not_initialized');
		const record: QuizRoomRecord = JSON.parse(raw);
		return {
			...record.state,
			content: this.#readRequired<QuizSessionState['content']>(contentKey),
			participants: record.participantIds.map((id) => this.#readRequired(`${participantKeyPrefix}${id}`)),
			excludedParticipants: record.excludedParticipantIds.map((id) =>
				this.#readRequired(`${participantKeyPrefix}${id}`)
			)
		};
	};

	#readRequired = <T>(key: string): T => {
		const raw = this.ctx.storage.kv.get<string>(key);
		if (raw === undefined) throw new Error('quiz_room_storage_incomplete');
		return JSON.parse(raw) as T;
	};

	#writeState = (state: QuizSessionState) => {
		const { content, participants, excludedParticipants, ...metadata } = state;
		const record: QuizRoomRecord = {
			storageVersion: 1,
			state: metadata,
			participantIds: participants.map(({ id }) => id),
			excludedParticipantIds: excludedParticipants.map(({ id }) => id)
		};
		const retained = new Set([...record.participantIds, ...record.excludedParticipantIds]);
		const previous = this.ctx.storage.kv.get<string>(stateKey);
		if (previous) {
			const old: QuizRoomRecord = JSON.parse(previous);
			for (const id of [...old.participantIds, ...old.excludedParticipantIds])
				if (!retained.has(id)) this.ctx.storage.kv.delete(`${participantKeyPrefix}${id}`);
		}
		// Each bounded participant stays below the KV value limit; one answer rewrites only its row.
		this.#writeChanged(contentKey, content);
		for (const participant of [...participants, ...excludedParticipants])
			this.#writeChanged(`${participantKeyPrefix}${participant.id}`, participant);
		this.#writeChanged(stateKey, record);
	};

	#writeChanged = (key: string, value: unknown) => {
		const serialized = JSON.stringify(value);
		if (this.ctx.storage.kv.get<string>(key) !== serialized) this.ctx.storage.kv.put(key, serialized);
	};

	#execute = async (actor: QuizSessionActor, command: QuizSessionCommand) => {
		const parsedActor = quizSessionActorSchema.parse(actor);
		const parsedCommand = quizSessionCommandSchema.parse(command);
		const now = Date.now();
		const result = this.ctx.storage.transactionSync(() => {
			const transition = applyQuizSessionCommand(this.#load(), parsedActor, parsedCommand, now);
			this.#writeState(transition.state);
			return transition;
		});
		await this.#settle();
		return {
			receipt: result.receipt,
			view: projectForActor(this.#load(), parsedActor, Date.now()),
			...(result.review ? { review: result.review } : {})
		};
	};

	#expire = async () => {
		this.ctx.storage.transactionSync(() => {
			const state = this.#load();
			const expired = expireQuizSession(state, Date.now());
			if (expired.revision !== state.revision) this.#writeState(expired);
		});
		await this.#settle();
	};

	#settle = async () => {
		const scheduled = await this.ctx.storage.getAlarm();
		const deadline = getQuizSessionDeadline(this.#load());
		if (deadline !== scheduled) {
			if (deadline === null) await this.ctx.storage.deleteAlarm();
			else await this.ctx.storage.setAlarm(deadline);
		}
		// Confirmation is emitted only after the durable commit, never from memory alone.
		await this.ctx.storage.sync();
	};

	#connection = (socket: WebSocket): QuizRoomConnection | null => {
		const parsed = quizRoomConnectionSchema.safeParse(socket.deserializeAttachment());
		if (!parsed.success || parsed.data.expiresAt <= Date.now()) {
			socket.close(1008, 'Participation expired');
			return null;
		}
		return parsed.data;
	};

	#authorized = async (connection: QuizRoomConnection): Promise<boolean> => {
		if (connection.expiresAt <= Date.now()) return false;
		if (connection.actor.kind !== 'teacher') return true;
		if (!connection.teacher) return false;
		try {
			const allowed = await this.ctx.exports.QuizAuthorization.canReadTeacher({
				...connection.teacher,
				runId: this.#load().id
			});
			return allowed === true && connection.expiresAt > Date.now();
		} catch {
			return false;
		}
	};

	#broadcast = async (participantId?: string) => {
		const state = this.#load();
		const permissions = new Map<string, Promise<boolean>>();
		for (const socket of this.ctx.getWebSockets()) {
			const connection = this.#connection(socket);
			if (!connection) continue;
			if (participantId && connection.actor.kind === 'participant' && connection.actor.participantId !== participantId)
				continue;
			try {
				if (connection.actor.kind === 'teacher') {
					const key = JSON.stringify(connection.teacher);
					let permission = permissions.get(key);
					if (!permission) {
						permission = this.#authorized(connection);
						permissions.set(key, permission);
					}
					if (!(await permission) || connection.expiresAt <= Date.now()) {
						socket.close(1008, 'Access revoked');
						continue;
					}
				}
				const view = projectForActor(state, connection.actor, Date.now());
				socket.send(JSON.stringify({ type: 'state', view }));
			} catch {
				socket.close(1008, 'Connection replaced');
			}
		}
	};

	#disconnect = async (socket: WebSocket) => {
		if (!this.ctx.storage.kv.get(stateKey)) return;
		const parsed = quizRoomConnectionSchema.safeParse(socket.deserializeAttachment());
		if (!parsed.success) return;
		const connection = parsed.data;
		if (connection.actor.kind !== 'participant') return;
		try {
			await this.#execute(connection.actor, { type: 'disconnect', requestId: crypto.randomUUID() });
			await this.#broadcast(connection.actor.participantId);
		} catch (cause) {
			if (!(cause instanceof QuizSessionError)) throw cause;
		}
	};
}
