import { z } from 'zod';
import { idSchema } from './contracts.js';

const optionSchema = z.strictObject({
	id: idSchema,
	text: z.string().trim().min(1, 'Renseignez une réponse.').max(10000)
});
const questionFields = z.strictObject({
	id: idSchema,
	type: z.enum(['single', 'multiple', 'true_false']),
	prompt: z.string().trim().min(1, 'Renseignez la question.').max(10000),
	code: z.string().max(20000).default(''),
	codeLanguage: z.string().trim().max(50).default(''),
	options: z.array(optionSchema).min(2).max(12),
	correctOptionIds: z.array(idSchema).min(1).max(12)
});

export const quizQuestionSchema = questionFields.superRefine((question, context) => {
	const issue = (path: (string | number)[], message: string) => context.addIssue({ code: 'custom', path, message });
	const optionIds = new Set(question.options.map((option) => option.id));
	if (optionIds.size !== question.options.length)
		issue(['options'], 'Chaque réponse doit avoir un identifiant distinct.');
	if (
		new Set(question.correctOptionIds).size !== question.correctOptionIds.length ||
		question.correctOptionIds.some((id) => !optionIds.has(id))
	)
		issue(['correctOptionIds'], 'Choisissez les bonnes réponses parmi les options de cette question.');
	if (question.type !== 'multiple' && question.correctOptionIds.length !== 1)
		issue(['correctOptionIds'], 'Cette question doit avoir une seule bonne réponse.');
	if (question.type === 'true_false' && question.options.length !== 2)
		issue(['options'], 'Une question Vrai / Faux doit avoir exactement deux réponses.');
});

export const quizContentSchema = z
	.strictObject({
		version: z.literal(1),
		title: z.string().trim().min(1, 'Renseignez le titre du quiz.').max(200),
		durationSeconds: z.int().min(1).max(14400),
		questions: z.array(quizQuestionSchema).min(1).max(200)
	})
	.superRefine((content, context) => {
		const ids = content.questions.flatMap((question) => [question.id, ...question.options.map((option) => option.id)]);
		if (new Set(ids).size !== ids.length)
			context.addIssue({
				code: 'custom',
				path: ['questions'],
				message: 'Les questions et réponses doivent avoir des identifiants distincts.'
			});
		if (new TextEncoder().encode(JSON.stringify(content)).byteLength > 200000)
			context.addIssue({
				code: 'custom',
				message: 'Le quiz est trop volumineux. Réduisez le texte ou le nombre de questions.'
			});
	});

export type QuizContent = z.infer<typeof quizContentSchema>;
export type QuizQuestion = QuizContent['questions'][number];
export type PublicQuizQuestion = Omit<QuizQuestion, 'correctOptionIds'>;

export const quizAnswersSchema = z
	.array(
		z.strictObject({
			questionId: idSchema,
			optionIds: z
				.array(idSchema)
				.max(12)
				.refine((ids) => new Set(ids).size === ids.length, 'Retirez les réponses en double.')
		})
	)
	.max(200)
	.refine(
		(answers) => new Set(answers.map((answer) => answer.questionId)).size === answers.length,
		'Une question ne peut être renseignée qu’une fois.'
	);
export type QuizAnswers = z.infer<typeof quizAnswersSchema>;
export type QuizScore = {
	points: number;
	maxPoints: number;
	questions: { questionId: string; points: number }[];
};

export const projectQuizQuestions = (content: QuizContent): PublicQuizQuestion[] =>
	content.questions.map((question) => ({
		id: question.id,
		type: question.type,
		prompt: question.prompt,
		code: question.code,
		codeLanguage: question.codeLanguage,
		options: question.options.map((option) => ({ id: option.id, text: option.text }))
	}));

export const scoreQuizAnswers = (content: QuizContent, value: QuizAnswers): QuizScore => {
	const quiz = quizContentSchema.parse(content);
	const answers = quizAnswersSchema.parse(value);
	const questionsById = new Map(quiz.questions.map((question) => [question.id, question]));
	for (const answer of answers) {
		const question = questionsById.get(answer.questionId);
		if (!question || answer.optionIds.some((id) => !question.options.some((option) => option.id === id)))
			throw new Error('Les réponses ne correspondent pas à cette version du quiz.');
	}
	const selected = new Map(answers.map((answer) => [answer.questionId, answer.optionIds]));
	const questions = quiz.questions.map((question) => {
		const optionIds = selected.get(question.id) ?? [];
		return {
			questionId: question.id,
			points:
				optionIds.length === question.correctOptionIds.length &&
				optionIds.every((id) => question.correctOptionIds.includes(id))
					? 1
					: 0
		};
	});
	return {
		points: questions.reduce((sum, question) => sum + question.points, 0),
		maxPoints: questions.length,
		questions
	};
};

export const quizContentPatchSchema = z.strictObject({
	title: z.string().trim().min(1).max(200).optional(),
	durationSeconds: z.int().min(1).max(14400).optional(),
	questions: z
		.array(
			questionFields
				.partial()
				.required({ id: true })
				.extend({
					code: questionFields.shape.code.removeDefault().optional(),
					codeLanguage: questionFields.shape.codeLanguage.removeDefault().optional(),
					options: z.array(optionSchema).max(12).optional()
				})
		)
		.max(200)
		.optional()
});
export type QuizContentPatch = z.infer<typeof quizContentPatchSchema>;

export const mergeQuizContentPatch = (
	content: QuizContent,
	value: QuizContentPatch,
	removeQuestionIds: string[] = [],
	removeOptionIds: string[] = []
): QuizContent => {
	const patch = quizContentPatchSchema.parse(value);
	const questionIds = new Set(content.questions.map((question) => question.id));
	const optionIds = new Set(content.questions.flatMap((question) => question.options.map((option) => option.id)));
	if (
		new Set(removeQuestionIds).size !== removeQuestionIds.length ||
		new Set(removeOptionIds).size !== removeOptionIds.length ||
		removeQuestionIds.some((id) => !questionIds.has(id)) ||
		removeOptionIds.some((id) => !optionIds.has(id)) ||
		new Set(patch.questions?.map((question) => question.id)).size !== (patch.questions?.length ?? 0) ||
		patch.questions?.some((question) => removeQuestionIds.includes(question.id))
	)
		throw new Error('Les modifications et suppressions doivent cibler des identifiants distincts de ce quiz.');
	const questions = new Map<string, Partial<QuizQuestion> & Pick<QuizQuestion, 'id' | 'options'>>(
		content.questions.map((question) => [question.id, structuredClone(question)])
	);
	for (const changed of patch.questions ?? []) {
		const previous = questions.get(changed.id);
		const options = new Map(previous?.options.map((option) => [option.id, option]) ?? []);
		if (new Set(changed.options?.map((option) => option.id)).size !== (changed.options?.length ?? 0))
			throw new Error('Une réponse ne peut apparaître qu’une fois dans une modification.');
		for (const option of changed.options ?? []) {
			if (removeOptionIds.includes(option.id))
				throw new Error('Une réponse ne peut pas être modifiée et supprimée dans la même commande.');
			options.set(option.id, option);
		}
		questions.set(changed.id, {
			...previous,
			...changed,
			options: [...options.values()]
		});
	}
	for (const id of removeQuestionIds) questions.delete(id);
	for (const question of questions.values())
		question.options = question.options.filter((option) => !removeOptionIds.includes(option.id));
	return quizContentSchema.parse({
		...content,
		...patch,
		questions: [...questions.values()]
	});
};

const quizReferences = {
	id: idSchema,
	moduleId: idSchema,
	contextId: idSchema,
	lessonId: idSchema,
	assessmentId: idSchema,
	lineId: idSchema
};
export const quizDraftWriteSchema = z.strictObject({
	...quizReferences,
	requestId: idSchema,
	expectedRevision: z.int().nonnegative(),
	content: quizContentSchema
});
export type QuizDraftWrite = z.infer<typeof quizDraftWriteSchema>;
export const quizDraftSchema = z.strictObject({
	...quizReferences,
	lessonId: idSchema.nullable(),
	revision: z.int().positive(),
	needsReview: z.boolean(),
	archived: z.boolean().default(false),
	content: quizContentSchema
});
export type QuizDraft = z.infer<typeof quizDraftSchema>;
export const quizDraftPatchSchema = z.strictObject({
	id: idSchema,
	requestId: idSchema,
	expectedRevision: z.int().positive(),
	patch: quizContentPatchSchema,
	removeQuestionIds: z.array(idSchema).max(200).default([]),
	removeOptionIds: z.array(idSchema).max(2400).default([])
});
export type QuizDraftPatch = z.input<typeof quizDraftPatchSchema>;
export const quizDraftReceiptSchema = z.strictObject({
	requestId: idSchema,
	quizId: idSchema,
	revision: z.int().positive()
});
export type QuizDraftReceipt = z.infer<typeof quizDraftReceiptSchema>;

export const quizArchiveSchema = z.strictObject({
	id: idSchema,
	moduleId: idSchema,
	contextId: idSchema,
	requestId: idSchema,
	expectedRevision: z.int().positive(),
	expectedContextRevision: z.int().positive(),
	archived: z.boolean()
});
export type QuizArchive = z.infer<typeof quizArchiveSchema>;
export const quizArchiveReceiptSchema = z.strictObject({
	requestId: idSchema,
	quizId: idSchema,
	contextRevision: z.int().positive(),
	archived: z.boolean()
});
export type QuizArchiveReceipt = z.infer<typeof quizArchiveReceiptSchema>;

export const quizGradeWriteSchema = z
	.strictObject({
		requestId: idSchema,
		quizId: idSchema,
		runId: idSchema,
		studentId: idSchema,
		expectedCorrectionRevision: z.int().nonnegative(),
		points: z.int().nonnegative().max(200),
		source: z.enum(['attempt', 'absence', 'stopped'])
	})
	.superRefine((value, context) => {
		if (value.source !== 'attempt' && value.points !== 0)
			context.addIssue({
				code: 'custom',
				path: ['points'],
				message: 'Cette décision impose zéro point.'
			});
	});
export type QuizGradeWrite = z.infer<typeof quizGradeWriteSchema>;
export const quizGradeReceiptSchema = z.strictObject({
	requestId: idSchema,
	quizId: idSchema,
	runId: idSchema,
	studentId: idSchema,
	reportId: idSchema,
	correctionRevision: z.int().positive()
});
export type QuizGradeReceipt = z.infer<typeof quizGradeReceiptSchema>;
