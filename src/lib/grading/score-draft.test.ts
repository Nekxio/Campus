import { describe, expect, it } from 'vitest';
import type { RubricAssessment } from '#lib/domain/grading.js';
import type { AssessmentInput } from './correction-form.js';
import { scoreInputError, scoreDraftSummary } from './score-draft.js';

const assessment: RubricAssessment = {
	id: 'assessment',
	title: 'Dossier',
	kind: 'other',
	purpose: 'graded',
	groups: [{ id: 'group', title: 'Critères' }],
	lines: [8, 6, 6].map((maxPoints, index) => ({
		id: `line-${index}`,
		groupId: 'group',
		label: `Critère ${index + 1}`,
		description: '',
		maxPoints
	}))
};
const draft = (values: string[]): AssessmentInput => ({
	assessmentId: assessment.id,
	status: 'to_evaluate',
	submissionUrl: '',
	submittedAt: '',
	latenessDecision: 'automatic',
	scores: values.map((points, index) => ({ lineId: `line-${index}`, points }))
});

describe('score draft feedback', () => {
	it.each(['', '0', '8', ' 8 '])('accepts blank or bounded integers: %s', (raw) => {
		expect(scoreInputError(raw, 8)).toBeNull();
	});
	it.each(['9', '-1', '1.5', '1,5', '1e1', '0x4', 'abc', '9007199254740992'])(
		'rejects invalid score input: %s',
		(raw) => {
			expect(scoreInputError(raw, 8)).toBe('Saisissez un entier entre 0 et 8. La valeur saisie est conservée.');
		}
	);
	it('distinguishes empty, explicit zero, partial and complete without calculating invalid totals', () => {
		expect(scoreDraftSummary(assessment, draft(['', '', '']))).toBe('Aucun critère noté · 0/3 renseignés');
		expect(scoreDraftSummary(assessment, draft(['0', '', '']))).toBe('0 / 20 pts · partiel · 1/3 renseignés');
		expect(scoreDraftSummary(assessment, draft(['8', '4', '6']))).toBe('18 / 20 pts · 3/3 renseignés');
		expect(scoreDraftSummary(assessment, draft(['9', '4', '']))).toBe('Calcul indisponible · corrigez les points');
	});
	it('retains the existing normalized quiz average and never divides by a zero maximum', () => {
		expect(scoreDraftSummary({ ...assessment, kind: 'quiz' }, draft(['8', '3', '0']))).toBe(
			'10,0 /20 · moyenne des quiz · 3/3 renseignés'
		);
		expect(
			scoreDraftSummary(
				{ ...assessment, lines: assessment.lines.map((line) => ({ ...line, maxPoints: 0 })) },
				draft(['0', '0', '0'])
			)
		).toBe('Calcul indisponible · barème à corriger');
	});
	it('does not make absence inputs participate in score validation or calculations', () => {
		for (const status of ['absent_justified', 'absent_unjustified'] as const) {
			expect(scoreDraftSummary(assessment, { ...draft(['9', '', '']), status })).toBe(
				'Points conservés · saisie désactivée pour l’absence'
			);
		}
	});
});
