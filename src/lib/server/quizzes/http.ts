import { error, isHttpError, json, type RequestEvent } from '@sveltejs/kit';
import { dev } from '$app/env';
import { z } from 'zod';
import { quizGradeReceiptSchema, type QuizGradeWrite } from '../../domain/quiz-content.js';
import type { Database } from '../db/index.js';
import { requireTeacher } from '../auth/access.js';
import { withTeacherDatabase } from '../teaching/database.js';
import { readTeachingJson, teachingId } from '../teaching/http.js';
import { withPublicDatabase } from '../teaching/public-database.js';
import { requirePublicQuizRun } from '../teaching/quiz-public.js';
import { reportQuizRoomGrade } from '../teaching/quiz-rooms.js';
import { hashQuizCredential, issueQuizCredential, readQuizCredential } from './credentials.js';
import {
	QuizSessionError,
	type QuizRetakeCreate,
	type QuizSessionActor,
	type QuizSessionCommand,
	type QuizSessionCreate
} from '../../domain/quiz-session.js';
import type { QuizRoom } from './room.js';
import { env } from 'cloudflare:workers';
import { quizRoomRpcErrorSchema, type QuizRoomRpcInput, type QuizRoomRpcValues } from './rpc.js';
import { isQuizTeacherAuthorized } from './teacher-authorization.js';

const headers = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' };
export const quizJson = (value: unknown, status = 200) => json(value, { status, headers });
export const requireQuizOrigin = (event: RequestEvent) => {
	if (
		event.request.headers.get('origin') !== event.url.origin ||
		event.request.headers.get('sec-fetch-site') === 'cross-site'
	)
		error(403, 'Origine de la requête refusée.');
};

export const quizEndpoint =
	(operation: (event: RequestEvent) => Promise<Response>) =>
	async (event: RequestEvent): Promise<Response> => {
		try {
			return await operation(event);
		} catch (cause) {
			if (isHttpError(cause)) return quizJson({ message: cause.body.message }, cause.status);
			if (cause instanceof QuizSessionError) return quizJson({ message: cause.message, code: cause.code }, 409);
			return quizJson({ message: 'Quiz indisponible. Conservez cet écran et réessayez.' }, 503);
		}
	};

export const quizTeacherRead = (operation: (db: Database, event: RequestEvent) => Promise<unknown>) =>
	quizEndpoint(async (event) => {
		requireTeacher(event.locals);
		return quizJson(await withTeacherDatabase(event.locals, (db) => operation(db, event)));
	});

export const quizTeacherWrite = <S extends z.ZodType>(
	schema: S,
	operation: (db: Database, event: RequestEvent, input: z.output<S>) => Promise<unknown>
) =>
	quizEndpoint(async (event) => {
		requireTeacher(event.locals);
		requireQuizOrigin(event);
		const checked = schema.safeParse(await readTeachingJson(event.request));
		if (!checked.success) error(422, 'Vérifiez les champs et références du quiz.');
		return quizJson(await withTeacherDatabase(event.locals, (db) => operation(db, event, checked.data)));
	});

export const quizRoomStub = (event: RequestEvent, runId: string) => {
	const binding = env.QUIZ_ROOMS as DurableObjectNamespace<QuizRoom> | undefined;
	if (!binding) error(503, 'Le service de quiz en direct est indisponible.');
	const stub = binding.get(binding.idFromName(teachingId(runId)));
	const rpc = async <Method extends keyof QuizRoomRpcValues>(
		input: Extract<QuizRoomRpcInput, { method: Method }>
	): Promise<QuizRoomRpcValues[Method]> => {
		const result = await stub.rpc(input);
		if (result.ok !== true) {
			if (result.ok !== false) throw new Error('Invalid quiz RPC result.');
			const failure = quizRoomRpcErrorSchema.parse(result.error);
			if (failure.kind === 'http') error(failure.status, failure.message);
			if (failure.kind === 'domain' || failure.kind === 'invalid_input') error(409, failure.message);
			throw new Error(failure.code);
		}
		if (result.method !== input.method) throw new Error('Mismatched quiz RPC result.');
		return result.value as QuizRoomRpcValues[Method];
	};
	return {
		initialize: (input: QuizSessionCreate) => rpc({ method: 'initialize', input }),
		teacherState: () => rpc({ method: 'teacherState' }),
		reportGrade: (input: QuizGradeWrite) => {
			const teacher = requireTeacher(event.locals);
			const identity = { teacherId: teacher.id, sessionId: event.locals.session!.id };
			if (dev)
				return withTeacherDatabase(event.locals, async (db) => {
					if (!(await isQuizTeacherAuthorized(db, { ...identity, runId }))) error(403, 'Accès refusé.');
					return reportQuizRoomGrade(db, teacher.id, await rpc({ method: 'teacherState' }), input);
				});
			return rpc({ method: 'reportGrade', teacher: identity, input }).then((value) =>
				quizGradeReceiptSchema.parse(value)
			);
		},
		command: (actor: QuizSessionActor, command: QuizSessionCommand) => rpc({ method: 'command', actor, command }),
		createRetake: (input: QuizRetakeCreate) => rpc({ method: 'createRetake', input }),
		admissionState: (actor: Extract<QuizSessionActor, { kind: 'participant' }>) =>
			rpc({ method: 'admissionState', actor }),
		participantState: (actor: Extract<QuizSessionActor, { kind: 'participant' }>) =>
			rpc({ method: 'participantState', actor }),
		purge: () => rpc({ method: 'purge' }),
		fetch: (request: Request) => stub.fetch(request)
	};
};

const cookieName = 'coursely_quiz';
const roomCookiePath = (contextId: string, runId: string) => `/api/quizzes/${contextId}/rooms/${runId}`;

const admissionSchema = z.strictObject({ participantId: z.uuid(), fullscreenConfirmed: z.boolean() });
const readAdmission = async (event: RequestEvent) => {
	requireQuizOrigin(event);
	const input = admissionSchema.safeParse(await readTeachingJson(event.request));
	if (!input.success) error(422, 'Choisissez votre nom et rejoignez la salle depuis le formulaire.');
	const contextId = teachingId(event.params.contextId);
	const runId = teachingId(event.params.runId);
	await withPublicDatabase((db) => requirePublicQuizRun(db, contextId, runId));
	const credential = event.cookies.get(cookieName);
	const parsed = readQuizCredential(credential);
	return { contextId, runId, participantId: input.data.participantId, credential, parsed };
};
const studentActor = async (runId: string, credential: string, participantId: string) => ({
	kind: 'participant' as const,
	participantId,
	credentialHash: await hashQuizCredential(runId, credential),
	connectionId: crypto.randomUUID()
});
const requireAdmission = async (
	stub: ReturnType<typeof quizRoomStub>,
	actor: Extract<QuizSessionActor, { kind: 'participant' }>
) => {
	const admission = await stub.admissionState(actor);
	if (!admission.available) error(409, 'Cet étudiant est déjà lié à un autre accès.');
	if (admission.participantId !== null && admission.participantId !== actor.participantId)
		error(409, 'Cet accès est déjà associé à un étudiant. Prévenez l’enseignant.');
	return admission;
};

export const prepareStudentQuiz = quizEndpoint(async (event) => {
	const { contextId, runId, participantId, credential: existing, parsed } = await readAdmission(event);
	const credential = parsed ? existing! : issueQuizCredential(participantId);
	await requireAdmission(quizRoomStub(event, runId), await studentActor(runId, credential, participantId));
	if (!parsed)
		event.cookies.set(cookieName, credential, {
			path: roomCookiePath(contextId, runId),
			httpOnly: true,
			secure: event.url.protocol === 'https:',
			sameSite: 'strict',
			maxAge: 8 * 3600
		});
	return quizJson({ prepared: true });
});

export const joinStudentQuiz = quizEndpoint(async (event) => {
	const { runId, participantId, credential, parsed } = await readAdmission(event);
	if (!parsed || !credential) error(428, 'Préparez votre accès depuis le formulaire, puis réessayez.');
	const actor = await studentActor(runId, credential, participantId);
	const stub = quizRoomStub(event, runId);
	const { joined } = await requireAdmission(stub, actor);
	await stub.command(actor, { type: joined ? 'reconnect' : 'join', requestId: crypto.randomUUID() });
	return quizJson({ joined: true });
});

export const readStudentQuizRoom = quizEndpoint(async (event) => {
	const upgrade = event.request.headers.get('upgrade')?.toLowerCase() === 'websocket';
	if (upgrade) requireQuizOrigin(event);
	const contextId = teachingId(event.params.contextId);
	const runId = teachingId(event.params.runId);
	await withPublicDatabase((db) => requirePublicQuizRun(db, contextId, runId));
	const stub = quizRoomStub(event, runId);
	if (!upgrade) {
		const view = await stub.teacherState();
		const credential = event.cookies.get(cookieName);
		const parsed = readQuizCredential(credential);
		const admission =
			parsed && credential
				? await stub.admissionState(await studentActor(runId, credential, parsed.participantId))
				: null;
		return quizJson({
			id: view.id,
			title: view.title,
			status: view.status,
			roster:
				view.status === 'lobby' || view.status === 'running'
					? view.participants
							.filter((entry) => entry.status === 'not_joined')
							.map((entry) => ({ id: entry.id, name: entry.name }))
					: [],
			joined: admission?.joined ?? false,
			preparedParticipantId: parsed && !admission?.joined && admission?.available ? parsed.participantId : null
		});
	}
	const credential = event.cookies.get(cookieName);
	const parsed = readQuizCredential(credential);
	if (!parsed || !credential) error(401, 'Rejoignez la salle avec votre nom.');
	const preparedActor = await studentActor(runId, credential, parsed.participantId);
	const admission = await stub.admissionState(preparedActor);
	if (!admission.participantId) error(401, 'Rejoignez la salle avec votre nom.');
	const actor = { ...preparedActor, participantId: admission.participantId };
	const issuedAt = Date.now();
	// Reconnect only inside the room after the WebSocket request has been validated.
	// Reconstruct the entire internal request: client-supplied actor headers never cross this boundary.
	return stub.fetch(
		new Request('https://quiz-room.internal/socket', {
			headers: {
				Upgrade: 'websocket',
				'x-campus-quiz-actor': JSON.stringify(actor),
				'x-campus-quiz-issued-at': String(issuedAt),
				'x-campus-quiz-expires-at': String(issuedAt + 8 * 3600000)
			}
		})
	);
});
