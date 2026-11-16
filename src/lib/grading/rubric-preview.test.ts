import { describe, expect, it } from 'vitest';
import { rubricMaximum, rubricSectionMaximum } from './rubric-form.js';
import type { RubricAssessment } from '../domain/grading.js';

const assessment: RubricAssessment = {
	id: 'assessment',
	title: 'Project',
	kind: 'project',
	purpose: 'graded',
	groups: [],
	lines: [{ id: 'line', groupId: 'group', label: 'Criterion', description: '', maxPoints: 20 }]
};

describe('Rubric preview maxima', () => {
	it.each([-1, 0, 1.5, 1000001, Number.NaN, Number.POSITIVE_INFINITY])(
		'does not display a maximum from invalid input %s, even with a positive total',
		(maximum) => {
			const lines = [...assessment.lines, { ...assessment.lines[0], id: 'invalid', maxPoints: maximum }];
			expect(rubricMaximum(lines)).toBeNull();
			expect(rubricSectionMaximum({ ...assessment, lines }, [])).toBeNull();
		}
	);
	it('does not display a zero denominator for an empty rubric', () => {
		expect(rubricMaximum([])).toBeNull();
	});
	it('keeps valid integer maxima and the separate normalized quiz maximum', () => {
		expect(rubricMaximum(assessment.lines)).toBe(20);
		expect(
			rubricSectionMaximum({ ...assessment, kind: 'quiz' }, [{ assessmentId: assessment.id, maxPoints: 35 }])
		).toBe(35);
	});
	it('requires both valid question counts and a valid quiz section maximum', () => {
		const quiz = { ...assessment, kind: 'quiz' as const };
		expect(rubricSectionMaximum(quiz, [])).toBeNull();
		expect(rubricSectionMaximum(quiz, [{ assessmentId: quiz.id, maxPoints: -1 }])).toBeNull();
		expect(
			rubricSectionMaximum({ ...quiz, lines: [{ ...quiz.lines[0], maxPoints: 0 }] }, [
				{ assessmentId: quiz.id, maxPoints: 35 }
			])
		).toBeNull();
	});
});
