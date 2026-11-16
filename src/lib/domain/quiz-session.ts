import { z } from 'zod';
import { idSchema } from './contracts.js';
import {
	projectQuizQuestions,
	quizAnswersSchema,
	quizContentSchema,
	scoreQuizAnswers,
	type PublicQuizQuestion,
	type QuizAnswers,
	type QuizContent,
	type QuizQuestion
} from './quiz-content.js';

export const quizRoomOpenSchema = z
	.strictObject({
		id: idSchema,
		quizId: idSchema,
		expectedQuizRevision: z.int().positive(),
		sourceRunId: idSchema.optional(),
		participantIds: z.array(idSchema).min(1).max(200).optional()
	})
	.superRefine((input, context) => {
		if (
			!!input.sourceRunId !== !!input.participantIds ||
			(input.participantIds && new Set(input.participantIds).size !== input.participantIds.length)
		)
			context.addIssue({
				code: 'custom',
				message: 'Sélectionnez les étudiants de la nouvelle salle.'
			});
	});

const instantSchema = z.int().nonnegative();
const credentialHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const rosterEntrySchema = z.strictObject({
	id: idSchema,
	name: z.string().trim().min(1).max(200)
});
const rosterSchema = z
	.array(rosterEntrySchema)
	.min(1)
	.max(200)
	.refine(
		(roster) => new Set(roster.map((entry) => entry.id)).size === roster.length,
		'La liste des étudiants contient un doublon.'
	);

export const quizSessionCreateSchema = z.strictObject({
	id: idSchema,
	content: quizContentSchema,
	roster: rosterSchema,
	shuffleSeed: z.string().min(1).max(256),
	createdAt: instantSchema
});
export type QuizSessionCreate = z.infer<typeof quizSessionCreateSchema>;

export const quizParticipantActorSchema = z.strictObject({
	kind: z.literal('participant'),
	participantId: idSchema,
	credentialHash: credentialHashSchema,
	connectionId: idSchema
});
export const quizSessionActorSchema = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('teacher') }),
	quizParticipantActorSchema
]);
export type QuizSessionActor = z.infer<typeof quizSessionActorSchema>;
type ParticipantActor = Extract<QuizSessionActor, { kind: 'participant' }>;

const commandFields = { requestId: idSchema };
export const quizSessionCommandSchema = z.discriminatedUnion('type', [
	z.strictObject({ ...commandFields, type: z.literal('join') }),
	z.strictObject({ ...commandFields, type: z.literal('reconnect') }),
	z.strictObject({ ...commandFields, type: z.literal('disconnect') }),
	z.strictObject({ ...commandFields, type: z.literal('start') }),
	z.strictObject({ ...commandFields, type: z.literal('remove_lobby'), participantId: idSchema }),
	z.strictObject({
		...commandFields,
		type: z.literal('set_roster'),
		roster: rosterSchema,
		shuffleSeed: z.string().min(1).max(256)
	}),
	z.strictObject({ ...commandFields, type: z.literal('remove_expected'), participantId: idSchema }),
	z.strictObject({ ...commandFields, type: z.literal('admit_late'), participantId: idSchema }),
	z.strictObject({
		...commandFields,
		type: z.literal('save_answers'),
		version: z.int().positive(),
		answers: quizAnswersSchema
	}),
	z.strictObject({
		...commandFields,
		type: z.literal('submit'),
		answerVersion: z.int().nonnegative()
	}),
	z.strictObject({
		...commandFields,
		type: z.literal('add_time'),
		participantId: idSchema,
		seconds: z.int().positive().max(14400),
		expectedExtraSeconds: z.int().nonnegative().max(14400)
	}),
	z.strictObject({ ...commandFields, type: z.literal('interrupt'), participantId: idSchema }),
	z.strictObject({ ...commandFields, type: z.literal('close') }),
	z.strictObject({
		...commandFields,
		type: z.literal('report_incident'),
		incident: z.enum(['focus', 'fullscreen'])
	}),
	z.strictObject({ ...commandFields, type: z.literal('consume_review') })
]);
export type QuizSessionCommand = z.infer<typeof quizSessionCommandSchema>;
export type QuizSessionStatus = 'lobby' | 'running' | 'closed';
export const quizParticipantStatusSchema = z.enum([
	'not_joined',
	'lobby',
	'awaiting_admission',
	'active',
	'submitted',
	'expired',
	'interrupted',
	'absent',
	'closed'
]);
export type QuizParticipantStatus = z.infer<typeof quizParticipantStatusSchema>;
export const canReportQuizIncident = (roomStatus: QuizSessionStatus, participantStatus: QuizParticipantStatus) =>
	(roomStatus === 'lobby' && participantStatus === 'lobby') ||
	(roomStatus === 'running' && ['active', 'awaiting_admission'].includes(participantStatus));
export type QuizSessionReceipt = {
	requestId: string;
	type: QuizSessionCommand['type'];
	sessionRevision: number;
	receivedAt: number;
	participantId: string | null;
	answerVersion?: number;
};
type StoredReceipt = {
	actor: string;
	signature: string;
	receipt: QuizSessionReceipt;
};
export type QuizSessionParticipant = {
	id: string;
	name: string;
	status: QuizParticipantStatus;
	credentialHash: string | null;
	connectionId: string | null;
	connected: boolean;
	startedAt: number | null;
	deadlineAt: number | null;
	extraSeconds: number;
	submittedAt: number | null;
	answerVersion: number;
	answers: QuizAnswers;
	lastAnswerReceipt: QuizSessionReceipt | null;
	lastSubmissionReceipt: QuizSessionReceipt | null;
	points: number | null;
	questionOrder: string[];
	optionOrder: Record<string, string[]>;
	incidents: { focus: number; fullscreen: number };
	review: { connectionId: string; status: 'available' | 'consumed' | 'revoked' } | null;
};
export type QuizSessionState = {
	version: 1;
	id: string;
	sourceSessionId: string | null;
	status: QuizSessionStatus;
	revision: number;
	createdAt: number;
	updatedAt: number;
	startedAt: number | null;
	closedAt: number | null;
	content: QuizContent;
	participants: QuizSessionParticipant[];
	excludedParticipants: QuizSessionParticipant[];
	revokedCredentialHashes: string[];
	receipts: StoredReceipt[];
};
export type QuizSessionReview = {
	sessionId: string;
	title: string;
	participant: { id: string; name: string };
	status: QuizParticipantStatus;
	points: number;
	maxPoints: number;
	questions: (QuizQuestion & { selectedOptionIds: string[]; points: number })[];
};
export type QuizSessionTransition = {
	state: QuizSessionState;
	receipt: QuizSessionReceipt;
	review?: QuizSessionReview;
};
export const quizSessionErrorCodeSchema = z.enum([
	'invalid_input',
	'invalid_state',
	'forbidden',
	'participant_not_found',
	'credentials_conflict',
	'connection_conflict',
	'request_conflict',
	'stale_answers',
	'invalid_answers',
	'version_conflict',
	'review_unavailable',
	'retake_not_allowed'
]);
export type QuizSessionErrorCode = z.infer<typeof quizSessionErrorCodeSchema>;

export class QuizSessionError extends Error {
	constructor(
		public readonly code: QuizSessionErrorCode,
		message: string
	) {
		super(message);
		this.name = 'QuizSessionError';
	}
}

const fail = (code: QuizSessionErrorCode, message: string): never => {
	throw new QuizSessionError(code, message);
};
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
	const parsed = schema.safeParse(value);
	if (!parsed.success) return fail('invalid_input', 'La commande de quiz est invalide.');
	return parsed.data;
};
const serverInstant = (state: QuizSessionState, now: number) => Math.max(parse(instantSchema, now), state.updatedAt);
const requireParticipant = (state: QuizSessionState, id: string) =>
	state.participants.find((participant) => participant.id === id) ??
	fail('participant_not_found', 'Cet étudiant ne fait pas partie de cette session.');
const requireStatus = (state: QuizSessionState, status: QuizSessionStatus) => {
	if (state.status !== status) fail('invalid_state', 'Cette action est indisponible dans cet état.');
};
const teacherCommands = new Set<QuizSessionCommand['type']>([
	'start',
	'remove_lobby',
	'set_roster',
	'remove_expected',
	'admit_late',
	'add_time',
	'interrupt',
	'close'
]);
const authorize = (state: QuizSessionState, actor: QuizSessionActor, command: QuizSessionCommand) => {
	if ((actor.kind === 'teacher') !== teacherCommands.has(command.type))
		fail('forbidden', 'Cette action n’est pas autorisée pour cet accès.');
	if (actor.kind === 'teacher') return;
	if (state.revokedCredentialHashes.includes(actor.credentialHash))
		fail('credentials_conflict', 'Cet accès a été retiré de cette session.');
	const participant = requireParticipant(state, actor.participantId);
	if (command.type === 'join' && participant.credentialHash === null) {
		if (
			state.participants.some(
				(other) => other.credentialHash === actor.credentialHash || other.connectionId === actor.connectionId
			)
		)
			fail('credentials_conflict', 'Cet accès est déjà lié à un autre étudiant.');
		return;
	}
	if (participant.credentialHash !== actor.credentialHash)
		fail('credentials_conflict', 'Cet étudiant est déjà lié à un autre accès.');
	if (command.type !== 'reconnect' && participant.connectionId !== actor.connectionId)
		fail('connection_conflict', 'Cette connexion a été remplacée.');
};

const seedNumber = (seed: string) => {
	let value = 2166136261;
	for (const character of seed) value = Math.imul(value ^ character.codePointAt(0)!, 16777619);
	return value >>> 0;
};
const shuffled = <T>(values: T[], seed: string): T[] => {
	const result = [...values];
	let value = seedNumber(seed);
	for (let index = result.length - 1; index > 0; index--) {
		value += 0x6d2b79f5;
		let random = Math.imul(value ^ (value >>> 15), value | 1);
		random ^= random + Math.imul(random ^ (random >>> 7), random | 61);
		const target = Math.floor((((random ^ (random >>> 14)) >>> 0) / 4294967296) * (index + 1));
		[result[index], result[target]] = [result[target], result[index]];
	}
	return result;
};

const createParticipant = (
	content: QuizContent,
	entry: z.infer<typeof rosterEntrySchema>,
	shuffleSeed: string
): QuizSessionParticipant => ({
	...entry,
	status: 'not_joined',
	credentialHash: null,
	connectionId: null,
	connected: false,
	startedAt: null,
	deadlineAt: null,
	extraSeconds: 0,
	submittedAt: null,
	answerVersion: 0,
	answers: [],
	lastAnswerReceipt: null,
	lastSubmissionReceipt: null,
	points: null,
	questionOrder: shuffled(
		content.questions.map((question) => question.id),
		`${shuffleSeed}:${entry.id}:questions`
	),
	optionOrder: Object.fromEntries(
		content.questions.map((question) => [
			question.id,
			shuffled(
				question.options.map((option) => option.id),
				`${shuffleSeed}:${entry.id}:${question.id}:options`
			)
		])
	),
	incidents: { focus: 0, fullscreen: 0 },
	review: null
});

export const createQuizSession = (value: QuizSessionCreate): QuizSessionState => {
	const input = parse(quizSessionCreateSchema, value);
	return {
		version: 1,
		id: input.id,
		sourceSessionId: null,
		status: 'lobby',
		revision: 0,
		createdAt: input.createdAt,
		updatedAt: input.createdAt,
		startedAt: null,
		closedAt: null,
		content: input.content,
		participants: input.roster.map((entry) => createParticipant(input.content, entry, input.shuffleSeed)),
		excludedParticipants: [],
		revokedCredentialHashes: [],
		receipts: []
	};
};

const finishParticipant = (
	state: QuizSessionState,
	participant: QuizSessionParticipant,
	status: 'submitted' | 'expired' | 'closed',
	now: number
) => {
	participant.status = status;
	participant.submittedAt = now;
	participant.points = scoreQuizAnswers(state.content, participant.answers).points;
};
const startParticipant = (state: QuizSessionState, participant: QuizSessionParticipant, now: number) => {
	const deadlineAt = (state.startedAt ?? now) + (state.content.durationSeconds + participant.extraSeconds) * 1000;
	if (deadlineAt <= now)
		fail('invalid_state', 'Le temps prévu est écoulé. Ajoutez du temps individuel avant cette admission.');
	participant.status = 'active';
	participant.startedAt = now;
	participant.deadlineAt = deadlineAt;
};

export const expireQuizSession = (state: QuizSessionState, now: number): QuizSessionState => {
	const at = serverInstant(state, now);
	if (
		state.status !== 'running' ||
		!state.participants.some(
			(participant) =>
				participant.status === 'active' && participant.deadlineAt !== null && participant.deadlineAt <= at
		)
	)
		return state;
	const expired = structuredClone(state);
	for (const participant of expired.participants)
		if (participant.status === 'active' && participant.deadlineAt !== null && participant.deadlineAt <= at)
			finishParticipant(expired, participant, 'expired', participant.deadlineAt);
	expired.revision++;
	expired.updatedAt = at;
	return expired;
};

export const getQuizSessionDeadline = (state: QuizSessionState): number | null => {
	if (state.status !== 'running') return null;
	const deadlines = state.participants.flatMap((participant) =>
		participant.status === 'active' && participant.deadlineAt !== null ? [participant.deadlineAt] : []
	);
	return deadlines.length ? Math.min(...deadlines) : null;
};

const orderedQuestions = (state: QuizSessionState, participant: QuizSessionParticipant): PublicQuizQuestion[] => {
	const questions = new Map(projectQuizQuestions(state.content).map((question) => [question.id, question]));
	return participant.questionOrder.map((id) => {
		const question = questions.get(id)!;
		const options = new Map(question.options.map((option) => [option.id, option]));
		return { ...question, options: participant.optionOrder[id].map((id) => options.get(id)!) };
	});
};
const personalReview = (state: QuizSessionState, participant: QuizSessionParticipant): QuizSessionReview => {
	const originals = new Map(state.content.questions.map((question) => [question.id, question]));
	const selections = new Map(participant.answers.map((answer) => [answer.questionId, answer.optionIds]));
	const scores = new Map(
		scoreQuizAnswers(state.content, participant.answers).questions.map((question) => [
			question.questionId,
			question.points
		])
	);
	return {
		sessionId: state.id,
		title: state.content.title,
		participant: { id: participant.id, name: participant.name },
		status: participant.status,
		points: participant.points ?? 0,
		maxPoints: state.content.questions.length,
		questions: orderedQuestions(state, participant).map((question) => ({
			...question,
			correctOptionIds: [...originals.get(question.id)!.correctOptionIds],
			selectedOptionIds: [...(selections.get(question.id) ?? [])],
			points: scores.get(question.id) ?? 0
		}))
	};
};
const validateAnswers = (state: QuizSessionState, answers: QuizAnswers) => {
	const questions = new Map(state.content.questions.map((question) => [question.id, question]));
	for (const answer of answers) {
		const question = questions.get(answer.questionId);
		if (
			!question ||
			answer.optionIds.some((id) => !question.options.some((option) => option.id === id)) ||
			(question.type !== 'multiple' && answer.optionIds.length > 1)
		)
			fail('invalid_answers', 'Les réponses ne correspondent pas à cette version du quiz.');
	}
};
const canonicalAnswers = (answers: QuizAnswers) =>
	JSON.stringify(
		answers
			.map((answer) => ({
				questionId: answer.questionId,
				optionIds: [...answer.optionIds].sort()
			}))
			.sort((first, second) => first.questionId.localeCompare(second.questionId))
	);
const actorKey = (actor: QuizSessionActor, command: QuizSessionCommand) => {
	if (actor.kind === 'teacher') return 'teacher';
	const binding = ['join', 'reconnect', 'disconnect', 'consume_review'].includes(command.type)
		? actor.connectionId
		: actor.credentialHash;
	return `${actor.participantId}:${binding}`;
};
const cacheReceipt = (
	state: QuizSessionState,
	actor: QuizSessionActor,
	command: QuizSessionCommand,
	receipt: QuizSessionReceipt
) => {
	state.receipts.push({
		actor: actorKey(actor, command),
		signature: JSON.stringify(command),
		receipt
	});
	let size = state.receipts.reduce((sum, entry) => sum + entry.signature.length, 0);
	while (state.receipts.length > 128 || size > 64000) size -= state.receipts.shift()!.signature.length;
};
const revokeReview = (participant: QuizSessionParticipant) => {
	if (participant.review) participant.review.status = 'revoked';
};
const revokeCredential = (state: QuizSessionState, participant: QuizSessionParticipant) => {
	const credentialHash = participant.credentialHash;
	if (credentialHash !== null && !state.revokedCredentialHashes.includes(credentialHash)) {
		if (state.revokedCredentialHashes.length >= 2000)
			fail('invalid_state', 'Le nombre maximal de retraits d’accès a été atteint pour cette session.');
		state.revokedCredentialHashes.push(credentialHash);
	}
	participant.connected = false;
	revokeReview(participant);
};

const joinParticipant = (state: QuizSessionState, actor: ParticipantActor, reconnect: boolean) => {
	const participant = requireParticipant(state, actor.participantId);
	if (!reconnect) {
		if (state.status === 'closed') fail('invalid_state', 'Cette session est clôturée.');
		if (
			participant.status !== 'not_joined' &&
			participant.status !== 'lobby' &&
			participant.status !== 'awaiting_admission'
		)
			fail('invalid_state', 'Cet accès doit reprendre la tentative existante.');
		participant.credentialHash = actor.credentialHash;
		participant.status = state.status === 'lobby' ? 'lobby' : 'awaiting_admission';
	}
	if (state.participants.some((other) => other.id !== participant.id && other.connectionId === actor.connectionId))
		fail('connection_conflict', 'Cette connexion est déjà liée à un autre étudiant.');
	participant.connectionId = actor.connectionId;
	participant.connected = true;
	if (state.status === 'closed') revokeReview(participant);
};

const applyTeacherCommand = (state: QuizSessionState, command: QuizSessionCommand, now: number) => {
	switch (command.type) {
		case 'remove_lobby': {
			if (state.status === 'closed') fail('invalid_state', 'Cette session est clôturée.');
			const participant = requireParticipant(state, command.participantId);
			if (!['lobby', 'awaiting_admission'].includes(participant.status) || participant.credentialHash === null)
				fail('invalid_state', 'Seul un accès en attente peut être retiré du salon.');
			revokeCredential(state, participant);
			participant.status = 'not_joined';
			participant.credentialHash = null;
			participant.connectionId = null;
			return;
		}
		case 'set_roster': {
			requireStatus(state, 'lobby');
			const retainedIds = new Set(command.roster.map((entry) => entry.id));
			for (const participant of state.participants)
				if (!retainedIds.has(participant.id)) revokeCredential(state, participant);
			const existing = new Map(state.participants.map((participant) => [participant.id, participant]));
			state.participants = command.roster.map((entry) => {
				const participant = existing.get(entry.id);
				return participant
					? { ...participant, name: entry.name }
					: createParticipant(state.content, entry, command.shuffleSeed);
			});
			return;
		}
		case 'remove_expected': {
			requireStatus(state, 'running');
			const participant = requireParticipant(state, command.participantId);
			revokeCredential(state, participant);
			state.excludedParticipants.push(participant);
			state.participants = state.participants.filter((entry) => entry.id !== participant.id);
			return;
		}
		case 'start':
			requireStatus(state, 'lobby');
			state.status = 'running';
			state.startedAt = now;
			for (const participant of state.participants)
				if (participant.status === 'lobby') startParticipant(state, participant, now);
			return;
		case 'admit_late': {
			requireStatus(state, 'running');
			const participant = requireParticipant(state, command.participantId);
			if (participant.status !== 'awaiting_admission')
				fail('invalid_state', 'Cet étudiant n’attend pas une admission.');
			startParticipant(state, participant, now);
			return;
		}
		case 'add_time': {
			if (state.status === 'closed') fail('invalid_state', 'Cette session est clôturée.');
			const participant = requireParticipant(state, command.participantId);
			if (!['not_joined', 'lobby', 'awaiting_admission', 'active'].includes(participant.status))
				fail('invalid_state', 'Cette tentative est déjà terminée.');
			if (participant.extraSeconds !== command.expectedExtraSeconds)
				fail('version_conflict', 'Le temps supplémentaire a changé. Actualisez la session.');
			if (participant.extraSeconds + command.seconds > 14400)
				fail('invalid_input', 'Le temps supplémentaire ne peut pas dépasser quatre heures.');
			participant.extraSeconds += command.seconds;
			if (participant.startedAt !== null)
				participant.deadlineAt =
					(state.startedAt ?? participant.startedAt) +
					(state.content.durationSeconds + participant.extraSeconds) * 1000;
			return;
		}
		case 'interrupt': {
			requireStatus(state, 'running');
			const participant = requireParticipant(state, command.participantId);
			if (participant.startedAt === null) fail('invalid_state', 'Cet étudiant n’a pas commencé cette tentative.');
			participant.status = 'interrupted';
			participant.submittedAt ??= now;
			participant.points = 0;
			return;
		}
		case 'close':
			if (state.status === 'closed') return;
			requireStatus(state, 'running');
			state.status = 'closed';
			state.closedAt = now;
			for (const participant of state.participants) {
				if (participant.status === 'active') finishParticipant(state, participant, 'closed', now);
				if (participant.startedAt === null) {
					participant.status = 'absent';
					participant.points = 0;
				}
				if (participant.startedAt !== null && participant.connected && participant.connectionId !== null)
					participant.review = { connectionId: participant.connectionId, status: 'available' };
			}
			return;
	}
};

const applyParticipantCommand = (
	state: QuizSessionState,
	actor: ParticipantActor,
	command: QuizSessionCommand,
	now: number
): QuizSessionReview | undefined => {
	const participant = requireParticipant(state, actor.participantId);
	switch (command.type) {
		case 'join':
			joinParticipant(state, actor, false);
			return;
		case 'reconnect':
			joinParticipant(state, actor, true);
			return;
		case 'disconnect':
			participant.connected = false;
			revokeReview(participant);
			return;
		case 'save_answers':
			requireStatus(state, 'running');
			if (participant.status !== 'active') fail('invalid_state', 'Cette tentative est déjà terminée.');
			validateAnswers(state, command.answers);
			if (command.version <= participant.answerVersion)
				fail('stale_answers', 'Une version plus récente des réponses est déjà enregistrée.');
			participant.answers = command.answers;
			participant.answerVersion = command.version;
			return;
		case 'submit':
			requireStatus(state, 'running');
			if (participant.status !== 'active') fail('invalid_state', 'Cette tentative est déjà terminée.');
			if (command.answerVersion !== participant.answerVersion)
				fail('stale_answers', 'Attendez la confirmation d’enregistrement des dernières réponses.');
			finishParticipant(state, participant, 'submitted', now);
			return;
		case 'report_incident':
			if (!canReportQuizIncident(state.status, participant.status))
				fail('invalid_state', 'Les signalements sont indisponibles pour cette participation.');
			participant.incidents[command.incident] = Math.min(999, participant.incidents[command.incident] + 1);
			return;
		case 'consume_review':
			requireStatus(state, 'closed');
			if (
				!participant.connected ||
				participant.review?.status !== 'available' ||
				participant.review.connectionId !== actor.connectionId
			)
				return fail('review_unavailable', 'Cette correction n’est plus disponible sur cet écran.');
			participant.review.status = 'consumed';
			return personalReview(state, participant);
	}
	return undefined;
};

export const applyQuizSessionCommand = (
	state: QuizSessionState,
	actorValue: QuizSessionActor,
	commandValue: QuizSessionCommand,
	now: number
): QuizSessionTransition => {
	const actor = parse(quizSessionActorSchema, actorValue);
	const command = parse(quizSessionCommandSchema, commandValue);
	const at = serverInstant(state, now);
	authorize(state, actor, command);
	const expired = expireQuizSession(state, at);
	const previous = expired.receipts.find((stored) => stored.receipt.requestId === command.requestId);
	if (previous) {
		if (previous.actor !== actorKey(actor, command) || previous.signature !== JSON.stringify(command))
			fail('request_conflict', 'Cet identifiant de commande a déjà été utilisé.');
		return { state: expired, receipt: structuredClone(previous.receipt) };
	}
	const submittedParticipant = [...expired.participants, ...expired.excludedParticipants].find(
		(participant) => participant.lastSubmissionReceipt?.requestId === command.requestId
	);
	const submissionReceipt = submittedParticipant?.lastSubmissionReceipt;
	if (submittedParticipant && submissionReceipt) {
		if (
			actor.kind !== 'participant' ||
			actor.participantId !== submittedParticipant.id ||
			command.type !== 'submit' ||
			command.answerVersion !== submittedParticipant.answerVersion
		)
			fail('request_conflict', 'Cet identifiant de commande a déjà été utilisé.');
		return { state: expired, receipt: structuredClone(submissionReceipt) };
	}
	if (command.type === 'save_answers' && actor.kind === 'participant') {
		const participant = requireParticipant(expired, actor.participantId);
		if (
			participant.lastAnswerReceipt?.requestId === command.requestId &&
			(command.version !== participant.answerVersion ||
				canonicalAnswers(command.answers) !== canonicalAnswers(participant.answers))
		)
			fail('request_conflict', 'Cet identifiant de commande a déjà été utilisé.');
		if (
			participant.lastAnswerReceipt &&
			command.version === participant.answerVersion &&
			canonicalAnswers(command.answers) === canonicalAnswers(participant.answers)
		)
			return {
				state: expired,
				receipt: { ...participant.lastAnswerReceipt, requestId: command.requestId }
			};
	}
	const updated = structuredClone(expired);
	let review: QuizSessionReview | undefined;
	if (actor.kind === 'teacher') applyTeacherCommand(updated, command, at);
	else review = applyParticipantCommand(updated, actor, command, at);
	updated.revision++;
	updated.updatedAt = at;
	const receipt: QuizSessionReceipt = {
		requestId: command.requestId,
		type: command.type,
		sessionRevision: updated.revision,
		receivedAt: at,
		participantId:
			actor.kind === 'participant' ? actor.participantId : 'participantId' in command ? command.participantId : null,
		...(command.type === 'save_answers' ? { answerVersion: command.version } : {})
	};
	if (command.type === 'save_answers' && actor.kind === 'participant')
		requireParticipant(updated, actor.participantId).lastAnswerReceipt = receipt;
	if (command.type === 'submit' && actor.kind === 'participant')
		requireParticipant(updated, actor.participantId).lastSubmissionReceipt = receipt;
	cacheReceipt(updated, actor, command, receipt);
	return { state: updated, receipt: structuredClone(receipt), ...(review ? { review } : {}) };
};

const publicParticipant = (participant: QuizSessionParticipant) => ({
	id: participant.id,
	name: participant.name,
	status: participant.status,
	connected: participant.connected,
	answerVersion: participant.answerVersion,
	startedAt: participant.startedAt,
	deadlineAt: participant.deadlineAt,
	extraSeconds: participant.extraSeconds,
	points: participant.points,
	incidents: { ...participant.incidents }
});

export const quizTeacherProjectionSchema = z.strictObject({
	id: idSchema,
	title: z.string().trim().min(1).max(200),
	status: z.enum(['lobby', 'running', 'closed']),
	revision: z.int().nonnegative(),
	serverNow: instantSchema,
	startedAt: instantSchema.nullable(),
	closedAt: instantSchema.nullable(),
	maxPoints: z.int().positive().max(200),
	participants: z
		.array(
			z.strictObject({
				id: idSchema,
				name: z.string().trim().min(1).max(200),
				status: quizParticipantStatusSchema,
				connected: z.boolean(),
				answerVersion: z.int().nonnegative(),
				answeredCount: z.int().nonnegative().max(200),
				startedAt: instantSchema.nullable(),
				deadlineAt: instantSchema.nullable(),
				extraSeconds: z.int().nonnegative().max(14400),
				points: z.int().nonnegative().max(200).nullable(),
				incidents: z.strictObject({
					focus: z.int().min(0).max(999),
					fullscreen: z.int().min(0).max(999)
				})
			})
		)
		.max(200)
});

export const projectQuizSessionForTeacher = (state: QuizSessionState, now: number) => {
	const at = serverInstant(state, now);
	const current = expireQuizSession(state, at);
	return {
		id: current.id,
		title: current.content.title,
		status: current.status,
		revision: current.revision,
		serverNow: at,
		startedAt: current.startedAt,
		closedAt: current.closedAt,
		maxPoints: current.content.questions.length,
		participants: current.participants.map((participant) => ({
			...publicParticipant(participant),
			answeredCount: participant.answers.filter((answer) => answer.optionIds.length > 0).length
		}))
	};
};
export type QuizTeacherProjection = ReturnType<typeof projectQuizSessionForTeacher>;

export const projectQuizSessionForParticipant = (
	state: QuizSessionState,
	actorValue: QuizSessionActor,
	now: number
) => {
	const actor = parse(quizSessionActorSchema, actorValue);
	if (actor.kind !== 'participant') return fail('forbidden', 'Un accès étudiant est requis.');
	const at = serverInstant(state, now);
	const current = expireQuizSession(state, at);
	const participant = requireParticipant(current, actor.participantId);
	if (participant.credentialHash !== actor.credentialHash)
		fail('credentials_conflict', 'Cet accès étudiant est invalide.');
	if (current.revokedCredentialHashes.includes(actor.credentialHash))
		fail('credentials_conflict', 'Cet accès a été retiré de cette session.');
	if (participant.connectionId !== actor.connectionId) fail('connection_conflict', 'Cette connexion a été remplacée.');
	return {
		id: current.id,
		title: current.content.title,
		status: current.status,
		revision: current.revision,
		serverNow: at,
		participant: {
			...publicParticipant(participant),
			points: null,
			answers: current.status === 'closed' ? [] : structuredClone(participant.answers)
		},
		questions:
			current.status === 'running' && participant.status === 'active' ? orderedQuestions(current, participant) : [],
		reviewAvailable:
			current.status === 'closed' &&
			participant.connected &&
			participant.review?.status === 'available' &&
			participant.review.connectionId === actor.connectionId
	};
};
export type QuizParticipantProjection = ReturnType<typeof projectQuizSessionForParticipant>;

export const quizRetakeCreateSchema = z.strictObject({
	id: idSchema,
	newParticipants: rosterSchema.optional(),
	participantIds: z
		.array(idSchema)
		.min(1)
		.max(200)
		.refine((ids) => new Set(ids).size === ids.length),
	protectedParticipantIds: z
		.array(idSchema)
		.max(200)
		.refine((ids) => new Set(ids).size === ids.length),
	shuffleSeed: z.string().min(1).max(256),
	createdAt: instantSchema
});
export type QuizRetakeCreate = z.infer<typeof quizRetakeCreateSchema>;
export const createQuizRetakeSession = (source: QuizSessionState, value: QuizRetakeCreate): QuizSessionState => {
	const input = parse(quizRetakeCreateSchema, value);
	if (source.status !== 'closed' || input.id === source.id || input.createdAt < (source.closedAt ?? source.createdAt))
		return fail('retake_not_allowed', 'Le rattrapage nécessite une session clôturée distincte.');
	const newcomers = input.newParticipants ?? [];
	if (
		newcomers.some(
			(entry) =>
				!input.participantIds.includes(entry.id) ||
				source.participants.some((participant) => participant.id === entry.id) ||
				source.excludedParticipants.some((participant) => participant.id === entry.id)
		)
	)
		return fail('retake_not_allowed', 'La sélection des nouveaux étudiants est invalide.');
	const roster = input.participantIds.map((id) => {
		if (input.protectedParticipantIds.includes(id))
			return fail('retake_not_allowed', 'Une note protégée empêche ce nouveau passage.');
		const newcomer = newcomers.find((entry) => entry.id === id);
		if (newcomer) return newcomer;
		const participant = requireParticipant(source, id);
		if (participant.status !== 'absent' || participant.points !== 0)
			return fail('retake_not_allowed', 'Seule une absence à zéro sans note protégée peut être rattrapée.');
		return { id: participant.id, name: participant.name };
	});
	return {
		...createQuizSession({
			id: input.id,
			content: source.content,
			roster,
			shuffleSeed: input.shuffleSeed,
			createdAt: input.createdAt
		}),
		sourceSessionId: source.id
	};
};
