import { describe, expect, it } from 'vitest';
import { calculateStudent } from '#lib/domain/grade-calculation.js';
import type { RubricData, StudentGrading } from '#lib/domain/grading.js';
import { correctionInput, previewCorrection, type CorrectionDraft } from './correction-form.js';
import { summarizeCorrection } from './correction-summary.js';

const fixture = () => {
	const rubric: RubricData = {
		module: { id: 'module', title: 'Module fictif', revision: 1 },
		assessments: [
			{
				id: 'project',
				title: 'Projet',
				kind: 'project',
				purpose: 'graded',
				groups: [{ id: 'group', title: 'Groupe' }],
				lines: [{ id: 'line', groupId: 'group', label: 'Critère', description: '', maxPoints: 5 }]
			}
		],
		results: [{ id: 'result', title: 'Résultat', rule: { kind: 'points_ratio', assessmentIds: ['project'] } }],
		contexts: []
	};
	const student: StudentGrading = {
		id: 'student',
		name: 'Étudiant fictif',
		corrections: [],
		comment: { revision: 0, content: '' },
		retiredScores: []
	};
	return { rubric, student, draft: correctionInput(rubric, student) };
};

const summary = (rubric: RubricData, student: StudentGrading, draft: CorrectionDraft, invalidScoreIds: string[] = []) =>
	summarizeCorrection(
		rubric,
		draft,
		calculateStudent(rubric.assessments, rubric.results, {
			...student,
			corrections: draft.assessments.map((item) => previewCorrection(item, rubric.module.revision))
		}),
		invalidScoreIds
	);

describe('Correction summary presentation', () => {
	it('shows a missing criterion once while retaining independent result errors', () => {
		const { rubric, student, draft } = fixture();
		draft.assessments[0].status = 'graded';
		rubric.results.push({
			id: 'invalid-result',
			title: 'Règle incomplète',
			rule: { kind: 'weighted', components: [{ assessmentIds: ['project'], weight: 90 }] }
		});
		const result = summary(rubric, student, draft);
		expect(result.diagnostics).toEqual([
			{ id: 'assessment-project', title: 'Projet', issues: ['Critère : points manquants.'] },
			{ id: 'result-invalid-result', title: 'Règle incomplète', issues: ['Règle de calcul à corriger.'] }
		]);
		expect(result.results[0]).toMatchObject({ mark: 'En attente', explanation: '1 élément à compléter.' });
	});

	it('updates blank points to a recorded zero in both assessment and result summaries', () => {
		const { rubric, student, draft } = fixture();
		draft.assessments[0].status = 'graded';
		expect(summary(rubric, student, draft).assessments[0]).toMatchObject({ mark: 'En attente' });
		draft.assessments[0].scores[0].points = '0';
		const result = summary(rubric, student, draft);
		expect(result.assessments[0]).toMatchObject({ mark: '0,0 /20', raw: '' });
		expect(result.results[0]).toMatchObject({ mark: '0,0 /20', pending: false });
	});

	it('blocks the assessment and its dependent result labels for invalid numeric input', () => {
		const { rubric, student, draft } = fixture();
		draft.assessments[0].status = 'graded';
		draft.assessments[0].scores[0].points = '0x4';
		const result = summary(rubric, student, draft, ['project']);
		expect(result.assessments[0]).toMatchObject({ mark: 'Calcul indisponible', raw: '' });
		expect(result.results[0]).toMatchObject({
			mark: 'Calcul indisponible',
			explanation: 'Corrigez les points signalés.'
		});
	});
});
