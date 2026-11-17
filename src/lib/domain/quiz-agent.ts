import { z } from 'zod';
import { idSchema, revisionSchema } from './contracts.js';
import { quizDraftPatchSchema, quizDraftSchema, quizDraftWriteSchema } from './quiz-content.js';

export const quizAgentPermissions = { 'quiz-drafts': ['read', 'write'] };
export type QuizAgentAction = 'quiz_read' | 'quiz_write';

export const quizContextRequestSchema = z.strictObject({
	moduleId: idSchema,
	contextId: idSchema.optional(),
	quizId: idSchema.optional()
});
export type QuizContextRequest = z.infer<typeof quizContextRequestSchema>;
export const createAgentQuizSchema = quizDraftWriteSchema.extend({
	expectedRevision: z.literal(0)
});
export const patchAgentQuizSchema = quizDraftPatchSchema.extend({ moduleId: idSchema });
export type AgentQuizPatch = z.input<typeof patchAgentQuizSchema>;

export const quizContextSchema = z.strictObject({
	version: z.literal(1),
	module: z.strictObject({ id: idSchema, title: z.string(), revision: revisionSchema }),
	contexts: z.array(
		z.strictObject({
			id: idSchema,
			classId: idSchema.nullable(),
			className: z.string(),
			academicYear: z.string(),
			revision: revisionSchema,
			archived: z.boolean(),
			lessons: z.array(z.strictObject({ id: idSchema, title: z.string() }))
		})
	),
	scoringLines: z.array(
		z.strictObject({
			assessmentId: idSchema,
			assessmentTitle: z.string(),
			lineId: idSchema,
			label: z.string(),
			maxPoints: z.int().positive()
		})
	),
	quizzes: z.array(
		z.strictObject({
			id: idSchema,
			contextId: idSchema,
			lessonId: idSchema.nullable(),
			assessmentId: idSchema,
			lineId: idSchema,
			revision: revisionSchema,
			needsReview: z.boolean(),
			title: z.string(),
			durationSeconds: z.int().positive(),
			questionCount: z.int().positive(),
			frozen: z.boolean()
		})
	),
	quiz: quizDraftSchema.nullable()
});
export type QuizContext = z.infer<typeof quizContextSchema>;
