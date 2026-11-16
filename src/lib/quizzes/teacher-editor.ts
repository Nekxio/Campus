import { quizDraftReceiptSchema, type QuizDraftWrite, type QuizQuestion } from '#lib/domain/quiz-content.js';

export type QuizEditorInput = Pick<
	QuizDraftWrite,
	'moduleId' | 'contextId' | 'lessonId' | 'assessmentId' | 'lineId' | 'content'
>;

export const createQuizQuestion = (type: QuizQuestion['type'] = 'single'): QuizQuestion => ({
	id: crypto.randomUUID(),
	type,
	prompt: '',
	code: '',
	codeLanguage: '',
	options: (type === 'true_false' ? ['Vrai', 'Faux'] : ['', '']).map((text) => ({
		id: crypto.randomUUID(),
		text
	})),
	correctOptionIds: []
});

export const changeQuizQuestionType = (question: QuizQuestion, type: QuizQuestion['type']): QuizQuestion => {
	if (type === question.type) return question;
	if (type === 'true_false')
		return {
			...question,
			type,
			options: createQuizQuestion(type).options,
			correctOptionIds: []
		};
	return {
		...question,
		type,
		correctOptionIds: type === 'single' ? question.correctOptionIds.slice(0, 1) : question.correctOptionIds
	};
};

export const selectQuizCorrectOption = (question: QuizQuestion, optionId: string, checked: boolean): QuizQuestion => {
	if (!question.options.some((option) => option.id === optionId)) return question;
	const selected = new Set(question.correctOptionIds);
	if (checked && question.type !== 'multiple') selected.clear();
	if (checked) selected.add(optionId);
	else selected.delete(optionId);
	return {
		...question,
		correctOptionIds: question.options.filter((option) => selected.has(option.id)).map((option) => option.id)
	};
};

export const quizEditorInput = (input: QuizEditorInput): QuizEditorInput =>
	structuredClone({
		moduleId: input.moduleId,
		contextId: input.contextId,
		lessonId: input.lessonId,
		assessmentId: input.assessmentId,
		lineId: input.lineId,
		content: input.content
	});

export const confirmQuizDraftSave = (command: QuizDraftWrite, value: unknown) => {
	const receipt = quizDraftReceiptSchema.parse(value);
	if (
		receipt.quizId !== command.id ||
		receipt.requestId !== command.requestId ||
		receipt.revision !== command.expectedRevision + 1
	)
		throw new Error('Quiz save confirmation does not match its command.');
	return { revision: receipt.revision, baseline: quizEditorInput(command) };
};
