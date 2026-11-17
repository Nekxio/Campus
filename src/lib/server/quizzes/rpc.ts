import { z } from 'zod';
import { idSchema } from '../../domain/contracts.js';
import { quizGradeWriteSchema, type QuizGradeReceipt } from '../../domain/quiz-content.js';
import {
	quizRetakeCreateSchema,
	quizParticipantActorSchema,
	quizSessionActorSchema,
	quizSessionCommandSchema,
	quizSessionCreateSchema,
	quizSessionErrorCodeSchema,
	type QuizParticipantProjection,
	type QuizSessionReceipt,
	type QuizSessionReview,
	type QuizTeacherProjection
} from '../../domain/quiz-session.js';

export const quizTeacherIdentitySchema = z.strictObject({
	teacherId: z.string().min(1).max(256),
	sessionId: z.string().min(1).max(256)
});
export const quizTeacherAuthorizationSchema = quizTeacherIdentitySchema.extend({ runId: idSchema });
export const quizGradeTransferSchema = z.strictObject({
	teacher: quizTeacherIdentitySchema,
	input: quizGradeWriteSchema
});

export const quizRoomRpcInputSchema = z.discriminatedUnion('method', [
	z.strictObject({ method: z.literal('initialize'), input: quizSessionCreateSchema }),
	z.strictObject({ method: z.literal('teacherState') }),
	quizGradeTransferSchema.extend({ method: z.literal('reportGrade') }),
	z.strictObject({
		method: z.literal('command'),
		actor: quizSessionActorSchema,
		command: quizSessionCommandSchema
	}),
	z.strictObject({ method: z.literal('createRetake'), input: quizRetakeCreateSchema }),
	z.strictObject({
		method: z.literal('participantState'),
		actor: quizParticipantActorSchema
	}),
	z.strictObject({ method: z.literal('admissionState'), actor: quizParticipantActorSchema }),
	z.strictObject({ method: z.literal('purge') })
]);
export type QuizRoomRpcInput = z.infer<typeof quizRoomRpcInputSchema>;

export const quizRoomErrorCodeSchema = z.enum([
	'quiz_room_not_initialized',
	'quiz_room_purged',
	'quiz_room_identity_conflict',
	'quiz_room_storage_incomplete'
]);
export const quizRoomRpcErrorSchema = z.discriminatedUnion('kind', [
	z.strictObject({
		kind: z.literal('http'),
		status: z.union([
			z.literal(400),
			z.literal(401),
			z.literal(403),
			z.literal(404),
			z.literal(409),
			z.literal(422),
			z.literal(503)
		]),
		message: z.string().max(1000)
	}),
	z.strictObject({
		kind: z.literal('domain'),
		code: quizSessionErrorCodeSchema,
		message: z.string().max(1000)
	}),
	z.strictObject({
		kind: z.literal('room'),
		code: quizRoomErrorCodeSchema,
		message: z.string().max(1000)
	}),
	z.strictObject({
		kind: z.literal('invalid_input'),
		code: z.literal('invalid_input'),
		message: z.string().max(1000)
	})
]);
export type QuizRoomRpcError = z.infer<typeof quizRoomRpcErrorSchema>;

export type QuizRoomRpcValues = {
	initialize: QuizTeacherProjection;
	teacherState: QuizTeacherProjection;
	reportGrade: QuizGradeReceipt;
	command: {
		receipt: QuizSessionReceipt;
		view: QuizTeacherProjection | QuizParticipantProjection;
		review?: QuizSessionReview;
	};
	createRetake: QuizTeacherProjection;
	participantState: QuizParticipantProjection;
	admissionState: { joined: boolean; participantId: string | null; available: boolean };
	purge: null;
};
export type QuizRoomRpcSuccess = {
	[Method in keyof QuizRoomRpcValues]: {
		ok: true;
		method: Method;
		value: QuizRoomRpcValues[Method];
	};
}[keyof QuizRoomRpcValues];
export type QuizRoomRpcResult = QuizRoomRpcSuccess | { ok: false; error: QuizRoomRpcError };
