import { z } from 'zod';
import { quizAnswersSchema, quizQuestionSchema, type QuizAnswers } from '#lib/domain/quiz-content.js';
import {
	quizParticipantStatusSchema,
	type QuizParticipantProjection,
	type QuizSessionCommand,
	type QuizSessionReceipt,
	type QuizSessionReview
} from '#lib/domain/quiz-session.js';

type SaveAnswers = Extract<QuizSessionCommand, { type: 'save_answers' }>;
export type QuizAnswerDraft = {
	answers: QuizAnswers;
	acknowledgedAnswers: QuizAnswers;
	acknowledgedVersion: number;
	pending: SaveAnswers | null;
	conflict: boolean;
};
const sameAnswers = (first: QuizAnswers, second: QuizAnswers) => {
	const normalized = (answers: QuizAnswers) =>
		answers
			.filter((answer) => answer.optionIds.length)
			.map((answer) => ({ questionId: answer.questionId, optionIds: [...answer.optionIds].sort() }))
			.sort((a, b) => a.questionId.localeCompare(b.questionId));
	return JSON.stringify(normalized(first)) === JSON.stringify(normalized(second));
};
export const createQuizAnswerDraft = (answers: QuizAnswers = [], version = 0): QuizAnswerDraft => ({
	answers: structuredClone(answers),
	acknowledgedAnswers: structuredClone(answers),
	acknowledgedVersion: version,
	pending: null,
	conflict: false
});
export const quizAnswersAreSaved = (draft: QuizAnswerDraft) =>
	!draft.pending && !draft.conflict && sameAnswers(draft.answers, draft.acknowledgedAnswers);

export const setQuizAnswer = (draft: QuizAnswerDraft, questionId: string, optionIds: string[]): QuizAnswerDraft => ({
	...draft,
	answers: [
		...draft.answers.filter((answer) => answer.questionId !== questionId),
		...(optionIds.length ? [{ questionId, optionIds: [...optionIds] }] : [])
	]
});

export const prepareQuizAnswerSave = (draft: QuizAnswerDraft, requestId: string): QuizAnswerDraft => {
	if (draft.pending || draft.conflict || quizAnswersAreSaved(draft)) return draft;
	return {
		...draft,
		pending: {
			type: 'save_answers',
			requestId,
			version: draft.acknowledgedVersion + 1,
			answers: structuredClone(draft.answers)
		}
	};
};

export const reconcileQuizAnswers = (
	draft: QuizAnswerDraft,
	version: number,
	answers: QuizAnswers
): QuizAnswerDraft => {
	if (version < draft.acknowledgedVersion) return draft;
	if (draft.pending) {
		if (version < draft.pending.version) return draft;
		if (version !== draft.pending.version || !sameAnswers(answers, draft.pending.answers))
			return { ...draft, conflict: true };
		return {
			...draft,
			acknowledgedVersion: version,
			acknowledgedAnswers: structuredClone(answers),
			pending: null
		};
	}
	if (quizAnswersAreSaved(draft)) return createQuizAnswerDraft(answers, version);
	if (version > draft.acknowledgedVersion && !sameAnswers(answers, draft.acknowledgedAnswers))
		return { ...draft, conflict: true };
	return draft;
};

export const remainingQuizSeconds = (
	deadlineAt: number | null,
	serverNow: number,
	receivedAt: number,
	localNow: number
) =>
	deadlineAt === null
		? null
		: Math.max(0, Math.ceil((deadlineAt - serverNow - Math.max(0, localNow - receivedAt)) / 1000));

const quizStatusSchema = z.enum(['lobby', 'running', 'closed']);
export const publicQuizListSchema = z.array(
	z.object({
		id: z.uuid(),
		title: z.string(),
		lessonId: z.uuid(),
		durationSeconds: z.int().positive(),
		status: z.enum(['locked', 'lobby', 'running', 'closed']),
		runId: z.uuid().nullable()
	})
);
export type PublicQuizList = z.infer<typeof publicQuizListSchema>;
const roomSchema = z.object({
	id: z.uuid(),
	title: z.string(),
	status: quizStatusSchema,
	roster: z.array(z.object({ id: z.uuid(), name: z.string() })),
	joined: z.boolean(),
	preparedParticipantId: z.uuid().nullable().default(null)
});
export type StudentQuizRoom = z.infer<typeof roomSchema>;

const readQuizResponse = async <T>(response: Response, schema: z.ZodType<T>) => {
	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const error = z.object({ message: z.string() }).safeParse(payload);
		throw new Error(error.success ? error.data.message : 'La salle est indisponible. Réessayez.');
	}
	const parsed = schema.safeParse(payload);
	if (!parsed.success) throw new Error('La réponse du serveur est indisponible. Réessayez.');
	return parsed.data;
};
export const readPublicQuizzes = async (path: string, request: typeof fetch = fetch) =>
	readQuizResponse(await request(path, { credentials: 'same-origin', cache: 'no-store' }), publicQuizListSchema);
export const readQuizRoom = async (path: string, request: typeof fetch = fetch) =>
	readQuizResponse(await request(path, { credentials: 'same-origin', cache: 'no-store' }), roomSchema);
export const joinQuizRoom = async (
	path: string,
	participantId: string,
	fullscreenConfirmed: boolean,
	request: typeof fetch = fetch,
	locks: Pick<LockManager, 'request'> | null | undefined = globalThis.navigator?.locks
) => {
	if (!locks) throw new Error('Ce navigateur ne permet pas de sécuriser votre accès. Utilisez un navigateur récent.');
	// Keep the first cookie response and claim ordered across tabs sharing this room cookie.
	return locks.request(`campus-quiz-admission:${path}`, async () => {
		const send = (method: 'PUT' | 'POST') =>
			request(path, {
				method,
				credentials: 'same-origin',
				cache: 'no-store',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ participantId, fullscreenConfirmed })
			});
		await readQuizResponse(await send('PUT'), z.object({ prepared: z.literal(true) }));
		return readQuizResponse(await send('POST'), z.object({ joined: z.literal(true) }));
	});
};

const projectionSchema = z.object({
	id: z.uuid(),
	title: z.string(),
	status: quizStatusSchema,
	revision: z.int().nonnegative(),
	serverNow: z.int().nonnegative(),
	reviewAvailable: z.boolean(),
	participant: z.object({
		id: z.uuid(),
		name: z.string(),
		status: quizParticipantStatusSchema,
		connected: z.boolean(),
		answerVersion: z.int().nonnegative(),
		startedAt: z.int().nullable(),
		deadlineAt: z.int().nullable(),
		extraSeconds: z.int().nonnegative(),
		points: z.null(),
		incidents: z.object({ focus: z.int(), fullscreen: z.int() }),
		answers: quizAnswersSchema
	}),
	questions: z.array(
		z.object({
			id: quizQuestionSchema.shape.id,
			type: quizQuestionSchema.shape.type,
			prompt: quizQuestionSchema.shape.prompt,
			code: quizQuestionSchema.shape.code,
			codeLanguage: quizQuestionSchema.shape.codeLanguage,
			options: quizQuestionSchema.shape.options
		})
	)
});
const reviewSchema = z.object({
	sessionId: z.uuid(),
	title: z.string(),
	participant: z.object({ id: z.uuid(), name: z.string() }),
	status: quizParticipantStatusSchema,
	points: z.int().nonnegative(),
	maxPoints: z.int().positive(),
	questions: z.array(quizQuestionSchema.safeExtend({ selectedOptionIds: z.array(z.uuid()), points: z.int() }))
});
const receiptSchema = z.object({
	requestId: z.uuid(),
	type: z.enum(['save_answers', 'submit', 'report_incident', 'consume_review']),
	sessionRevision: z.int(),
	receivedAt: z.int(),
	participantId: z.uuid().nullable(),
	answerVersion: z.int().optional()
});
const messageSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('state'), view: projectionSchema }),
	z.object({
		type: z.literal('ack'),
		receipt: receiptSchema,
		view: projectionSchema,
		review: reviewSchema.optional()
	}),
	z.object({ type: z.literal('error'), code: z.string(), requestId: z.uuid().optional() })
]);
export type QuizSocketMessage =
	| { type: 'state'; view: QuizParticipantProjection }
	| {
			type: 'ack';
			receipt: QuizSessionReceipt;
			view: QuizParticipantProjection;
			review?: QuizSessionReview;
	  }
	| { type: 'error'; code: string; requestId?: string };
export const readQuizSocketMessage = (raw: string): QuizSocketMessage | null => {
	try {
		const parsed = messageSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
};
