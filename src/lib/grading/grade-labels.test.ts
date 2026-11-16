import { describe, expect, it } from 'vitest';
import { projectDelayLabel, resultRuleLabel } from './grade-labels.js';
import { blankCorrection, type RubricAssessment } from '../domain/grading.js';
import { calculateAssessment } from '../domain/grade-calculation.js';

const assessment: RubricAssessment = {
	id: crypto.randomUUID(),
	title: 'Projet fictif',
	kind: 'project',
	purpose: 'graded',
	groups: [{ id: 'group', title: 'Points' }],
	lines: [{ id: 'line', groupId: 'group', label: 'Travail', description: '', maxPoints: 10 }]
};
const deadline = { dueAt: '2026-10-10T12:00:00Z' };
const record = {
	...blankCorrection(assessment.id, 1),
	status: 'graded' as const,
	scores: [{ lineId: 'line', points: 9 }]
};

describe('grading explanations', () => {
	it.each([0, 1, 5, 6])('explains the calculated project delay after %s days', (days) => {
		const correction = { ...record, submittedAt: `2026-10-${10 + days}T12:00:00Z` };
		const label = projectDelayLabel(assessment, correction, deadline);
		const grade = calculateAssessment(assessment, correction, deadline.dueAt);
		expect(grade.mark).toBe(days > 5 ? 0 : 18 - days);
		if (days > 5) {
			expect(label).toContain('projet à zéro');
			expect(label).not.toContain('−6');
		} else if (days) expect(label).toContain(`−${days},0 /20`);
		else expect(label).toContain('aucun retard');
	});
	it('keeps explicit exemptions, refusals and absence decisions', () => {
		expect(projectDelayLabel(assessment, { ...record, latenessDecision: 'exempt' }, deadline)).toBe(
			'Exception de retard accordée'
		);
		expect(projectDelayLabel(assessment, { ...record, latenessDecision: 'refused' }, deadline)).toBe(
			'Production refusée · zéro'
		);
		expect(projectDelayLabel(assessment, { ...record, status: 'absent_unjustified' }, deadline)).toContain(
			'Absence injustifiée'
		);
		expect(projectDelayLabel(assessment, { ...record, status: 'absent_justified' }, deadline)).toContain('rattrapage');
	});
	it('distinguishes equal quiz averages, mixed point totals and weighted results', () => {
		const quiz = { ...assessment, id: 'quiz', kind: 'quiz' as const };
		const quizzes = [quiz, { ...quiz, id: 'long-quiz', lines: [{ ...quiz.lines[0], maxPoints: 100 }] }];
		const result = {
			id: 'result',
			title: 'Résultat',
			rule: { kind: 'points_ratio' as const, assessmentIds: quizzes.map((item) => item.id) }
		};
		expect(quizzes.map((item) => item.lines[0].maxPoints)).toEqual([10, 100]);
		expect(resultRuleLabel(result, quizzes)).toContain('moyennées à poids égal');
		expect(resultRuleLabel(result, quizzes)).toBe('Sections Quiz normalisées sur 20 puis moyennées à poids égal');
		expect(
			resultRuleLabel({ ...result, rule: { ...result.rule, assessmentIds: ['quiz', assessment.id] } }, [
				quiz,
				assessment
			])
		).toContain('Somme des points');
		expect(
			resultRuleLabel({ ...result, rule: { ...result.rule, assessmentIds: ['quiz', assessment.id] } }, [
				quiz,
				assessment
			])
		).toBe(
			'Somme des points, puis conversion sur 20 ; dans chaque section Quiz, moyenne des quiz normalisés à poids égal'
		);
		expect(
			resultRuleLabel(
				{
					...result,
					rule: { kind: 'weighted', components: [{ assessmentIds: ['quiz'], weight: 100 }] }
				},
				quizzes
			)
		).toBe('Notes normalisées puis pondérées');
	});
});
