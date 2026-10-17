import { describe, expect, it } from 'vitest';
import type { RubricAssessment, RubricData } from '#lib/domain/grading.js';
import {
	rubricEditorSchema,
	rubricToDomain,
	rubricToInput,
	syncRubricSections
} from './rubric-form.js';

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

describe('Rubric section type changes', () => {
	it('creates a separately validated maximum when a free section becomes one quiz', () => {
		let input = draft();
		input.assessments[0].kind = 'quiz';
		input = syncRubricSections(input);
		expect(input.quizMaxima).toEqual([
			{ assessmentId: input.assessments[0].id, maxPoints: Number.NaN }
		]);
		for (const maxPoints of [Number.NaN, 0, -1, 1.5, 1000001]) {
			input.quizMaxima[0].maxPoints = maxPoints;
			const parsed = schema.safeParse(input);
			expect(parsed.success).toBe(false);
			if (!parsed.success)
				expect(parsed.error.issues.map((issue) => issue.path)).toEqual([
					['quizMaxima', 0, 'maxPoints']
				]);
		}
		input.quizMaxima[0].maxPoints = 12;
		expect(schema.safeParse(input).success).toBe(true);
		const domain = rubricToDomain(input, {});
		expect(domain.assessments[0].lines[0].maxPoints).toBe(5);
		expect(domain.results[0].rule).toMatchObject({
			sectionPoints: { quizMaxima: [{ assessmentId: input.assessments[0].id, maxPoints: 12 }] }
		});
		expect(rubricToInput({ ...data(), ...domain, contexts: [] }).quizMaxima).toEqual(
			input.quizMaxima
		);
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
