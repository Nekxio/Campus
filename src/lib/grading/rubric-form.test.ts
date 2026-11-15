import { describe, expect, it } from 'vitest';
import { rubricUpdateSchema, type RubricAssessment, type RubricData } from '#lib/domain/grading.js';
import { rubricEditorSchema, rubricToDomain, rubricToInput, syncRubricSections } from './rubric-form.js';

function section(): RubricAssessment {
	const groupId = crypto.randomUUID();
	return {
		id: crypto.randomUUID(),
		title: 'Section libre fictive',
		kind: 'other',
		purpose: 'graded',
		groups: [{ id: groupId, title: 'Critères' }],
		lines: [
			{
				id: crypto.randomUUID(),
				groupId,
				label: 'Livrable fictif',
				description: '',
				maxPoints: 5
			}
		]
	};
}
function data(): RubricData {
	return {
		module: { id: crypto.randomUUID(), title: 'Module fictif', revision: 1 },
		assessments: [],
		results: [],
		contexts: []
	};
}
function draft() {
	return syncRubricSections({ ...rubricToInput(data()), assessments: [section()] });
}
const schema = rubricEditorSchema(() => ({}));

describe('Rubric maximum validation recovery', () => {
	it('rejects -1 then zero on the maximum alone and recovers at 20 without losing other fields', () => {
		const input = draft();
		input.assessments[0].lines[0].maxPoints = 20;
		input.assessments[0].lines[0].description = 'Conserver les sources du livrable fictif.';
		input.results[0].title = 'Résultat fictif personnalisé';
		input.contexts = [
			{
				id: crypto.randomUUID(),
				expectedRevision: 7,
				deadlines: [
					{
						assessmentId: input.assessments[0].id,
						dueAt: '2026-11-03T09:30',
						submissionInstructions: 'Remettre le livrable fictif.'
					}
				]
			}
		];
		const original = structuredClone(input);
		expect(schema.safeParse(input).success).toBe(true);
		for (const maximum of [-1, 0]) {
			input.assessments[0].lines[0].maxPoints = maximum;
			const beforeValidation = structuredClone(input);
			const parsed = schema.safeParse(input);
			expect(parsed.success).toBe(false);
			if (!parsed.success)
				expect(
					parsed.error.issues.every(
						(issue) =>
							issue.path.join('.') === 'assessments.0.lines.0.maxPoints' &&
							issue.message === 'Le maximum doit être un entier positif.'
					)
				).toBe(true);
			expect(input).toEqual(beforeValidation);
		}
		expect(rubricToDomain(input, {}).results).toEqual([]);
		input.assessments[0].lines[0].maxPoints = 20;
		expect(schema.safeParse(input).success).toBe(true);
		expect(input).toEqual(original);
		const saved = rubricUpdateSchema.parse({
			...rubricToDomain(input, {}),
			expectedRevision: 1
		});
		expect(saved.results[0]).toMatchObject({
			id: original.results[0].id,
			title: original.results[0].title,
			rule: { components: [{ assessmentIds: [original.assessments[0].id], weight: 100 }] }
		});
		expect(saved.contexts[0].deadlines[0]).toEqual({
			...original.contexts[0].deadlines[0],
			dueAt: '2026-11-03T08:30:00.000Z'
		});
	});

	it.each([0, Number.NaN, 101])('still rejects an editable custom weight of %s', (weight) => {
		const input = draft();
		input.calculationMode = 'custom';
		input.assessments[0].lines[0].maxPoints = 0;
		input.results[0].components = [{ id: crypto.randomUUID(), assessmentIds: [input.assessments[0].id], weight }];
		const parsed = schema.safeParse(input);
		expect(parsed.success).toBe(false);
		if (!parsed.success)
			expect(parsed.error.issues.some((issue) => issue.path.join('.') === 'results.0.components.0.weight')).toBe(true);
		expect(rubricToDomain(input, {}).results[0].rule).toMatchObject({
			components: [{ weight }]
		});
	});

	it('keeps server maximum validation with either a saved rule or suspended calculations', () => {
		const input = draft();
		input.assessments[0].lines[0].maxPoints = 20;
		const saved = rubricToDomain(input, {});
		for (const maximum of [-1, 0]) {
			for (const results of [saved.results, []]) {
				const update = structuredClone({ ...saved, results, expectedRevision: 1 });
				update.assessments[0].lines[0].maxPoints = maximum;
				const parsed = rubricUpdateSchema.safeParse(update);
				expect(parsed.success).toBe(false);
				if (!parsed.success)
					expect(parsed.error.issues).toContainEqual(
						expect.objectContaining({
							path: ['assessments', 0, 'lines', 0, 'maxPoints'],
							message: 'Le maximum doit être un entier positif.'
						})
					);
			}
		}
	});
});

describe('Rubric section type changes', () => {
	it('creates a separately validated maximum when a free section becomes one quiz', () => {
		let input = draft();
		input.assessments[0].kind = 'quiz';
		input = syncRubricSections(input);
		expect(input.quizMaxima).toEqual([{ assessmentId: input.assessments[0].id, maxPoints: Number.NaN }]);
		for (const maxPoints of [Number.NaN, 0, -1, 1.5, 1000001]) {
			input.quizMaxima[0].maxPoints = maxPoints;
			const parsed = schema.safeParse(input);
			expect(parsed.success).toBe(false);
			if (!parsed.success)
				expect(parsed.error.issues.map((issue) => issue.path)).toEqual([['quizMaxima', 0, 'maxPoints']]);
		}
		input.quizMaxima[0].maxPoints = 12;
		expect(schema.safeParse(input).success).toBe(true);
		const domain = rubricToDomain(input, {});
		expect(domain.assessments[0].lines[0].maxPoints).toBe(5);
		expect(domain.results[0].rule).toMatchObject({
			sectionPoints: { quizMaxima: [{ assessmentId: input.assessments[0].id, maxPoints: 12 }] }
		});
		expect(rubricToInput({ ...data(), ...domain, contexts: [] }).quizMaxima).toEqual(input.quizMaxima);
	});

	it.each(['other', 'project', 'oral'] as const)(
		'clears the quiz-only validation when switching to %s and requires a choice on return',
		(kind) => {
			let input = draft();
			input.assessments[0].kind = 'quiz';
			input = syncRubricSections(input);
			input.assessments[0].kind = kind;
			input = syncRubricSections(input);
			expect(input.quizMaxima).toEqual([]);
			expect(schema.safeParse(input).success).toBe(true);
			input.assessments[0].kind = 'quiz';
			input = syncRubricSections(input);
			expect(input.quizMaxima[0].maxPoints).toBeNaN();
			expect(schema.safeParse(input).success).toBe(false);
		}
	);

	it('does not require a maximum for a formative quiz and revalidates when it becomes graded', () => {
		let input = draft();
		input.assessments[0].kind = 'quiz';
		input.assessments[0].purpose = 'formative';
		input = syncRubricSections(input);
		expect(input.results).toEqual([]);
		expect(schema.safeParse(input).success).toBe(true);
		input.assessments[0].purpose = 'graded';
		input = syncRubricSections(input);
		expect(schema.safeParse(input).success).toBe(false);
		input.quizMaxima[0].maxPoints = 20;
		expect(schema.safeParse(input).success).toBe(true);
	});

	it('keeps independent legacy quiz results valid without a section maximum', () => {
		const quiz = { ...section(), kind: 'quiz' as const };
		const original = {
			...data(),
			assessments: [quiz],
			results: ['Premier résultat', 'Deuxième résultat'].map((title) => ({
				id: crypto.randomUUID(),
				title,
				rule: { kind: 'points_ratio' as const, assessmentIds: [quiz.id] }
			}))
		};
		const input = syncRubricSections(rubricToInput(original));
		expect(input.calculationMode).toBe('custom');
		expect(input.quizMaxima[0].maxPoints).toBeNaN();
		expect(schema.safeParse(input).success).toBe(true);
		expect(rubricToDomain(input, {}).results).toEqual(original.results);
	});
});
