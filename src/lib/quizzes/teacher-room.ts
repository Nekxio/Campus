import { z } from 'zod';
import { idSchema } from '#lib/domain/contracts.js';
import { formatDurationSeconds } from '#lib/teaching/duration.js';
import {
	quizTeacherProjectionSchema,
	type QuizSessionCommand,
	type QuizSessionStatus,
	type QuizParticipantStatus
} from '#lib/domain/quiz-session.js';

export const quizRoomPageSchema = z.strictObject({
	view: quizTeacherProjectionSchema,
	run: z.strictObject({
		id: idSchema,
		quizId: idSchema,
		contextId: idSchema,
		sourceRunId: idSchema.nullable()
	}),
	quiz: z.strictObject({
		id: idSchema,
		title: z.string(),
		moduleId: idSchema,
		lessonId: idSchema.nullable()
	}),
	context: z.strictObject({
		id: idSchema,
		className: z.string(),
		academicYear: z.string(),
		publicContextId: idSchema
	})
});
export type QuizRoomPage = z.infer<typeof quizRoomPageSchema>;

export const quizRoomCandidatesSchema = z.array(
	z.strictObject({
		id: idSchema,
		name: z.string().min(1),
		kind: z.enum(['ungraded', 'absence'])
	})
);
export type QuizRoomCandidate = z.infer<typeof quizRoomCandidatesSchema>[number];

const resultSchema = z.object({
	receipt: z.object({ requestId: idSchema, type: z.string() }),
	view: quizTeacherProjectionSchema,
	grades: z.strictObject({ reported: z.int().nonnegative(), conflicts: z.array(idSchema) }).optional()
});

export const confirmQuizRoomCommand = (roomId: string, command: QuizSessionCommand, payload: unknown) => {
	const result = resultSchema.parse(payload);
	if (
		result.view.id !== roomId ||
		result.receipt.requestId !== command.requestId ||
		result.receipt.type !== command.type
	)
		throw new Error('Quiz room confirmation does not match its command.');
	return result;
};

export const quizTimeRemaining = (
	deadline: number | null,
	serverNow: number,
	participantStatus: QuizParticipantStatus,
	roomStatus: QuizSessionStatus
): string => {
	if (roomStatus === 'closed') return quizParticipantLabels.closed;
	if (['submitted', 'expired', 'interrupted', 'closed'].includes(participantStatus))
		return quizParticipantLabels[participantStatus];
	if (roomStatus !== 'running' || participantStatus !== 'active' || deadline === null) return 'N/D';
	const seconds = Math.max(0, Math.ceil((deadline - serverNow) / 1000));
	return formatDurationSeconds(seconds);
};

export const quizParticipantLabels: Record<QuizParticipantStatus, string> = {
	not_joined: 'Non connecté',
	lobby: 'Prêt',
	awaiting_admission: 'Admission à confirmer',
	active: 'En cours',
	submitted: 'Rendu',
	expired: 'Temps écoulé',
	interrupted: 'Interrompu',
	absent: 'Absent',
	closed: 'Clôturé'
};
