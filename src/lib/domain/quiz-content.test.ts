import { describe, expect, it } from 'vitest';
import {
	quizContentSchema,
	quizAnswersSchema,
	projectQuizQuestions,
	scoreQuizAnswers,
	mergeQuizContentPatch,
	quizGradeWriteSchema,
	type QuizContent
} from './quiz-content.js';

const singleId = crypto.randomUUID();
const multipleId = crypto.randomUUID();
const trueFalseId = crypto.randomUUID();
const optionIds = Array.from({ length: 7 }, () => crypto.randomUUID());
const content: QuizContent = {
	version: 1,
	title: 'Control flow',
	durationSeconds: 1200,
	questions: [
		{
			id: singleId,
			type: 'single',
			prompt: 'What does this code print?',
			code: 'console.log(1 + 1);',
			codeLanguage: 'typescript',
			options: [
				{ id: optionIds[0], text: '2' },
				{ id: optionIds[1], text: '11' }
			],
			correctOptionIds: [optionIds[0]]
		},
		{
			id: multipleId,
			type: 'multiple',
			prompt: 'Choose the even numbers.',
			code: '',
			codeLanguage: '',
			options: [
				{ id: optionIds[2], text: '2' },
				{ id: optionIds[3], text: '4' },
				{ id: optionIds[4], text: '3' }
			],
			correctOptionIds: [optionIds[2], optionIds[3]]
		},
		{
			id: trueFalseId,
			type: 'true_false',
			prompt: 'Zero is even.',
			code: '',
			codeLanguage: '',
			options: [
				{ id: optionIds[5], text: 'Vrai' },
				{ id: optionIds[6], text: 'Faux' }
			],
			correctOptionIds: [optionIds[5]]
		}
	]
};

describe('native quiz content', () => {
	it('awards one point only for an exact selection and counts missing answers as zero', () => {
		expect(
			scoreQuizAnswers(content, [
				{ questionId: singleId, optionIds: [optionIds[0]] },
				{ questionId: multipleId, optionIds: [optionIds[3], optionIds[2]] }
			])
		).toEqual({
			points: 2,
			maxPoints: 3,
			questions: [
				{ questionId: singleId, points: 1 },
				{ questionId: multipleId, points: 1 },
				{ questionId: trueFalseId, points: 0 }
			]
		});
		for (const selection of [[optionIds[2]], [optionIds[2], optionIds[3], optionIds[4]]])
			expect(scoreQuizAnswers(content, [{ questionId: multipleId, optionIds: selection }]).points).toBe(0);
	});

	it('awards zero when a selection of the required size contains one incorrect answer', () => {
		expect(scoreQuizAnswers(content, [{ questionId: multipleId, optionIds: [optionIds[2], optionIds[4]] }])).toEqual({
			points: 0,
			maxPoints: 3,
			questions: [
				{ questionId: singleId, points: 0 },
				{ questionId: multipleId, points: 0 },
				{ questionId: trueFalseId, points: 0 }
			]
		});
	});

	it('rejects answers with forged, duplicate or cross-question identities', () => {
		for (const answers of [
			[{ questionId: crypto.randomUUID(), optionIds: [] }],
			[{ questionId: singleId, optionIds: [optionIds[2]] }],
			[{ questionId: singleId, optionIds: [optionIds[0], optionIds[0]] }],
			[
				{ questionId: singleId, optionIds: [optionIds[0]] },
				{ questionId: singleId, optionIds: [] }
			]
		])
			expect(() => scoreQuizAnswers(content, answers)).toThrow();
		expect(quizAnswersSchema.safeParse([{ questionId: singleId, optionIds: [], points: 1 }]).success).toBe(false);
	});

	it('projects code and answer choices without shipping any correct-option key', () => {
		const projected = projectQuizQuestions(content);
		expect(projected[0]).toEqual({
			id: singleId,
			type: 'single',
			prompt: content.questions[0].prompt,
			code: content.questions[0].code,
			codeLanguage: 'typescript',
			options: content.questions[0].options
		});
		expect(JSON.stringify(projected)).not.toContain('correctOptionIds');
		projected[0].options[0].text = 'Changed client copy';
		expect(content.questions[0].options[0].text).toBe('2');
	});

	it('rejects malformed answer keys, duplicate identities and invalid question modes', () => {
		for (const alter of [
			(value: QuizContent) => (value.questions[0].correctOptionIds = [optionIds[2]]),
			(value: QuizContent) => (value.questions[0].correctOptionIds = optionIds.slice(0, 2)),
			(value: QuizContent) => (value.questions[1].correctOptionIds = []),
			(value: QuizContent) => (value.questions[1].id = singleId),
			(value: QuizContent) => (value.questions[0].options[1].id = optionIds[0]),
			(value: QuizContent) => (value.durationSeconds = 0)
		]) {
			const invalid = structuredClone(content);
			alter(invalid);
			expect(quizContentSchema.safeParse(invalid).success).toBe(false);
		}
		expect(quizContentSchema.parse(content)).toEqual(content);
	});

	it('rejects a true/false question with three distinct options and a valid answer key', () => {
		const invalid = structuredClone(content);
		invalid.questions[2].options.push({ id: crypto.randomUUID(), text: 'Neither' });
		expect(quizContentSchema.safeParse(invalid).success).toBe(false);
	});
	it('rejects a multiple-choice key that repeats an otherwise valid option', () => {
		const invalid = structuredClone(content);
		invalid.questions[1].correctOptionIds = [optionIds[2], optionIds[2]];
		expect(quizContentSchema.safeParse(invalid).success).toBe(false);
	});
	it('rejects a multiple-choice key mixing an option from this question with one from another question', () => {
		const invalid = structuredClone(content);
		invalid.questions[1].correctOptionIds = [optionIds[2], optionIds[0]];
		expect(quizContentSchema.safeParse(invalid).success).toBe(false);
	});
	it('rejects a selection mixing an option from this question with one from another question', () => {
		expect(() =>
			scoreQuizAnswers(content, [{ questionId: multipleId, optionIds: [optionIds[2], optionIds[0]] }])
		).toThrow();
	});
	it('accepts the exact serialized byte limit and rejects one additional UTF-8 byte', () => {
		const quiz: QuizContent = {
			...content,
			questions: Array.from({ length: 4 }, () => {
				const first = crypto.randomUUID();
				return {
					...content.questions[0],
					id: crypto.randomUUID(),
					prompt: 'x'.repeat(9000),
					code: 'x'.repeat(20000),
					options: [
						{ id: first, text: 'x'.repeat(10000) },
						{ id: crypto.randomUUID(), text: 'x'.repeat(10000) }
					],
					correctOptionIds: [first]
				};
			})
		};
		let remaining = 200000 - new TextEncoder().encode(JSON.stringify(quiz)).byteLength;
		for (const question of quiz.questions) {
			const added = Math.min(remaining, 10000 - question.prompt.length);
			question.prompt += 'x'.repeat(added);
			remaining -= added;
		}
		expect(new TextEncoder().encode(JSON.stringify(quiz)).byteLength).toBe(200000);
		expect(quizContentSchema.safeParse(quiz).success).toBe(true);
		quiz.questions[0].prompt = 'é' + quiz.questions[0].prompt.slice(1);
		expect(new TextEncoder().encode(JSON.stringify(quiz)).byteLength).toBe(200001);
		expect(quizContentSchema.safeParse(quiz).success).toBe(false);
	});

	it('preserves omitted questions while changing exact IDs and removes only explicit questions', () => {
		const merged = mergeQuizContentPatch(content, {
			title: 'Updated title',
			questions: [{ id: singleId, prompt: 'Updated prompt' }]
		});
		expect(merged.questions).toHaveLength(3);
		expect(merged.questions[0]).toEqual({ ...content.questions[0], prompt: 'Updated prompt' });
		expect(merged.questions[1]).toEqual(content.questions[1]);
		expect(mergeQuizContentPatch(content, { questions: [] }).questions).toEqual(content.questions);
		expect(mergeQuizContentPatch(content, {}, [singleId]).questions.map((question) => question.id)).toEqual([
			multipleId,
			trueFalseId
		]);
		expect(() => mergeQuizContentPatch(content, {}, [crypto.randomUUID()])).toThrow();
		expect(() =>
			mergeQuizContentPatch(content, {
				questions: [{ id: crypto.randomUUID(), prompt: 'Incomplete' }]
			})
		).toThrow();
	});

	it('updates one option without replacing omitted answer choices', () => {
		const updated = mergeQuizContentPatch(content, {
			questions: [{ id: singleId, options: [{ id: optionIds[0], text: 'Two' }] }]
		});
		expect(updated.questions[0].options).toEqual([{ id: optionIds[0], text: 'Two' }, content.questions[0].options[1]]);
	});
	it('updates multiple distinct questions together while preserving omitted content', () => {
		const original = structuredClone(content);
		const updated = mergeQuizContentPatch(content, {
			questions: [
				{
					id: singleId,
					prompt: 'Updated single question',
					options: [
						{ id: optionIds[0], text: 'Two' },
						{ id: optionIds[1], text: 'Eleven' }
					]
				},
				{ id: multipleId, prompt: 'Updated multiple question' }
			]
		});
		expect(updated.questions).toEqual([
			{
				...original.questions[0],
				prompt: 'Updated single question',
				options: [
					{ id: optionIds[0], text: 'Two' },
					{ id: optionIds[1], text: 'Eleven' }
				]
			},
			{ ...original.questions[1], prompt: 'Updated multiple question' },
			original.questions[2]
		]);
		expect(content).toEqual(original);
	});
	it('rejects removing an unknown option from an otherwise valid quiz', () => {
		const original = structuredClone(content);
		expect(() => mergeQuizContentPatch(content, {}, [], [crypto.randomUUID()])).toThrow();
		expect(content).toEqual(original);
	});

	it('removes only the requested incorrect option and preserves the source content', () => {
		const original = structuredClone(content);
		const updated = mergeQuizContentPatch(content, {}, [], [optionIds[4]]);
		expect(updated).toEqual({
			...original,
			questions: [
				original.questions[0],
				{
					...original.questions[1],
					options: [original.questions[1].options[0], original.questions[1].options[1]]
				},
				original.questions[2]
			]
		});
		expect(content).toEqual(original);
	});

	it('rejects updating and removing the same option even when the remaining question would be valid', () => {
		expect(() =>
			mergeQuizContentPatch(
				content,
				{ questions: [{ id: multipleId, options: [{ id: optionIds[4], text: 'Odd number' }] }] },
				[],
				[optionIds[4]]
			)
		).toThrow();
	});
	it.each([
		{ name: 'question', questions: [singleId, singleId], options: [] },
		{ name: 'option', questions: [], options: [optionIds[4], optionIds[4]] }
	])('rejects duplicate $name removals before changing the quiz', ({ questions, options }) => {
		const original = structuredClone(content);
		expect(() => mergeQuizContentPatch(content, {}, questions, options)).toThrow();
		expect(content).toEqual(original);
	});
	it('rejects updating and removing the same question even when the remaining quiz would be valid', () => {
		expect(() =>
			mergeQuizContentPatch(content, { questions: [{ id: singleId, prompt: 'Updated' }] }, [singleId])
		).toThrow();
	});
	it('rejects multiple updates to the same question rather than silently taking the last one', () => {
		expect(() =>
			mergeQuizContentPatch(content, {
				questions: [
					{ id: singleId, prompt: 'First edit' },
					{ id: singleId, prompt: 'Conflicting edit' }
				]
			})
		).toThrow();
	});
	it('rejects multiple updates to the same option rather than silently taking the last one', () => {
		expect(() =>
			mergeQuizContentPatch(content, {
				questions: [
					{
						id: singleId,
						options: [
							{ id: optionIds[0], text: 'First edit' },
							{ id: optionIds[0], text: 'Conflicting edit' }
						]
					}
				]
			})
		).toThrow();
	});
	it.each(['absence', 'stopped'] as const)('requires zero points for an explicit %s grade decision', (source) => {
		const decision = {
			requestId: crypto.randomUUID(),
			quizId: crypto.randomUUID(),
			runId: crypto.randomUUID(),
			studentId: crypto.randomUUID(),
			expectedCorrectionRevision: 0,
			points: 0,
			source
		};
		expect(quizGradeWriteSchema.safeParse(decision).success).toBe(true);
		expect(quizGradeWriteSchema.safeParse({ ...decision, points: 1 }).success).toBe(false);
		for (const points of [0, 1]) {
			expect(quizGradeWriteSchema.safeParse({ ...decision, source: 'attempt', points }).success).toBe(true);
		}
	});
});
