import { describe, expect, it } from 'vitest';
import {
	changeQuizQuestionType,
	confirmQuizDraftSave,
	createQuizQuestion,
	selectQuizCorrectOption
} from './teacher-editor.js';
import type { QuizDraftWrite } from '#lib/domain/quiz-content.js';

describe('quiz teacher editing', () => {
	it('lets a teacher write an incomplete question without inventing a correct answer', () => {
		const question = createQuizQuestion('single');
		expect(question.prompt).toBe('');
		expect(question.options).toHaveLength(2);
		expect(question.correctOptionIds).toEqual([]);
		expect(new Set([question.id, ...question.options.map((option) => option.id)]).size).toBe(3);
	});

	it('keeps the question and code while changing to a true or false question', () => {
		const original = { ...createQuizQuestion('single'), prompt: 'Is this true?', code: '1 === 1' };
		const changed = changeQuizQuestionType(original, 'true_false');
		expect(changed.id).toBe(original.id);
		expect(changed.prompt).toBe(original.prompt);
		expect(changed.code).toBe(original.code);
		expect(changed.options.map((option) => option.text)).toEqual(['Vrai', 'Faux']);
		expect(changed.correctOptionIds).toEqual([]);
	});

	it('replaces a single correct choice but retains several choices in multiple-answer mode', () => {
		const single = createQuizQuestion('single');
		const first = selectQuizCorrectOption(single, single.options[0].id, true);
		const second = selectQuizCorrectOption(first, single.options[1].id, true);
		expect(second.correctOptionIds).toEqual([single.options[1].id]);
		const multiple = changeQuizQuestionType(first, 'multiple');
		const combined = selectQuizCorrectOption(multiple, single.options[1].id, true);
		expect(combined.correctOptionIds).toHaveLength(2);
		expect(changeQuizQuestionType(combined, 'single').correctOptionIds).toHaveLength(1);
		expect(selectQuizCorrectOption(single, crypto.randomUUID(), true)).toEqual(single);
	});

	it('accepts a saved revision only for the exact pending request and keeps later edits dirty', () => {
		const pending: QuizDraftWrite = {
			id: crypto.randomUUID(),
			moduleId: crypto.randomUUID(),
			contextId: crypto.randomUUID(),
			lessonId: crypto.randomUUID(),
			assessmentId: crypto.randomUUID(),
			lineId: crypto.randomUUID(),
			requestId: crypto.randomUUID(),
			expectedRevision: 4,
			content: { version: 1, title: 'Saved title', durationSeconds: 600, questions: [] }
		};
		const confirmed = confirmQuizDraftSave(pending, {
			requestId: pending.requestId,
			quizId: pending.id,
			revision: 5
		});
		expect(confirmed.revision).toBe(5);
		expect(confirmed.baseline.content.title).toBe('Saved title');
		expect(() =>
			confirmQuizDraftSave(pending, {
				requestId: crypto.randomUUID(),
				quizId: pending.id,
				revision: 5
			})
		).toThrow();
		expect(() =>
			confirmQuizDraftSave(pending, {
				requestId: pending.requestId,
				quizId: pending.id,
				revision: 7
			})
		).toThrow();
	});
});
