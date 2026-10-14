import { describe, expect, it } from 'vitest';
import type { GradeGridData } from './grading.js';
import { rubricDraftSchema } from './grading.js';
import {
	gradeExportStatus,
	projectFinalGradeExport,
	finalGradeExportSchema
} from './grade-export.js';

function completeGrid(): GradeGridData {
	return {
		modules: [{ id: 'module', title: 'Application web' }],
		contexts: [{ id: 'context', moduleId: 'module', className: 'B2', academicYear: '2026–2027' }],
		contextId: 'context',
		rubric: {
			module: { id: 'module', title: 'Application web', revision: 1 },
			contexts: [
				{
					id: 'context',
					className: 'B2',
					academicYear: '2026–2027',
					expectedRevision: 1,
					deadlines: []
				}
			],
			assessments: ['graded', 'formative'].map((purpose, i) => ({
				id: `assessment-${i}`,
				title: `Assessment ${i}`,
				kind: 'other',
				purpose: purpose as 'graded' | 'formative',
				groups: [{ id: `group-${i}`, title: 'Group' }],
				lines: [
					{
						id: `line-${i}`,
						groupId: `group-${i}`,
						label: 'Private criterion',
						description: 'Private details',
						maxPoints: 15
					}
				]
			})),
			results: [
				{
					id: 'result',
					title: 'Résultat',
					rule: { kind: 'points_ratio', assessmentIds: ['assessment-0'] }
				}
			]
		},
		students: Array.from({ length: 12 }, (_, i) => ({
			id: `student-${i}`,
			name: i === 0 ? 'Élodie Démo' : `Étudiant fictif ${i}`,
			comment: { revision: 1, content: 'Private semester comment' },
			retiredScores: [],
			corrections: [
				{
					assessmentId: 'assessment-0',
					rubricRevision: 1,
					revision: 1,
					status: 'graded',
					submissionUrl: 'https://example.test/private-submission',
					submittedAt: null,
					latenessDecision: 'automatic',
					scores: [{ lineId: 'line-0', points: 11 }]
				}
			]
		}))
	};
}
const date = new Date('2026-10-13T12:00:00Z');
describe('Final module export', () => {
	it.each([
		{ name: 'integer weights', weights: [3, 79, 18] },
		{ name: 'decimal weights', weights: [0.5, 79.8, 19.7] },
		{ name: 'accepted near-100 weight sum', weights: [3, 79, 18 + 5e-9] }
	])('exports a perfect 20 with $name', ({ weights }) => {
		const grid = completeGrid();
		const assessments = [15, 100, 120].map((maxPoints, index) => {
			const groupId = crypto.randomUUID();
			return {
				...grid.rubric!.assessments[0],
				id: crypto.randomUUID(),
				title: `Graded assessment ${index}`,
				groups: [{ id: groupId, title: 'Points' }],
				lines: [
					{
						...grid.rubric!.assessments[0].lines[0],
						id: crypto.randomUUID(),
						groupId,
						maxPoints
					}
				]
			};
		});
		const result = {
			id: crypto.randomUUID(),
			title: 'Perfect weighted result',
			rule: {
				kind: 'weighted' as const,
				components: assessments.map((assessment, index) => ({
					assessmentIds: [assessment.id],
					weight: weights[index]
				}))
			}
		};
		expect(
			rubricDraftSchema.safeParse({ assessments, results: [result], contexts: [] }).success
		).toBe(true);
		grid.rubric!.assessments = assessments;
		grid.rubric!.results = [result];
		for (const student of grid.students) {
			const correction = student.corrections[0];
			student.corrections = assessments.map((assessment) => ({
				...correction,
				assessmentId: assessment.id,
				scores: assessment.lines.map((line) => ({ lineId: line.id, points: line.maxPoints }))
			}));
		}
		expect(gradeExportStatus(grid)).toMatchObject({ ready: true, complete: 12 });
		const document = projectFinalGradeExport(grid, date)!;
		expect(document.students.map((student) => student.marks)).toEqual(
			grid.students.map(() => [20])
		);
		expect(finalGradeExportSchema.safeParse(document).success).toBe(true);
	});
	it('projects every student and only defined results, without private correction data', () => {
		const grid = completeGrid();
		const document = projectFinalGradeExport(grid, date)!;
		expect(document.students).toHaveLength(12);
		expect(document.students[0].name).toBe('Élodie Démo');
		expect(document.students[0].marks[0]).toBeCloseTo((11 / 15) * 20, 10);
		expect(document.results).toEqual(['Résultat']);
		expect(document.exportedAt).toBe(date.toISOString());
		expect(JSON.stringify(document)).not.toMatch(/Private|private-submission|student-0|line-0/);
	});
	it.each(['to_evaluate', 'absent_justified'] as const)(
		'blocks unresolved required state %s',
		(status) => {
			const grid = completeGrid();
			grid.students[3].corrections[0].status = status;
			expect(gradeExportStatus(grid)).toMatchObject({ ready: false, complete: 11 });
			expect(projectFinalGradeExport(grid, date)).toBeNull();
		}
	);
	it('counts unjustified absence as final zero and ignores ungraded formative work', () => {
		const grid = completeGrid();
		grid.students[3].corrections[0].status = 'absent_unjustified';
		expect(gradeExportStatus(grid)).toMatchObject({ ready: true, complete: 12 });
		expect(projectFinalGradeExport(grid, date)?.students[3].marks).toEqual([0]);
	});
	it.each([null, 16])('blocks missing or excessive points instead of coercing %s', (points) => {
		const grid = completeGrid();
		grid.students[0].corrections[0].scores[0].points = points;
		expect(projectFinalGradeExport(grid, date)).toBeNull();
	});
	it('does not export an empty class or a module without defined results', () => {
		const grid = completeGrid();
		grid.students = [];
		expect(projectFinalGradeExport(grid, date)).toBeNull();
		const withoutResults = completeGrid();
		withoutResults.rubric!.results = [];
		expect(projectFinalGradeExport(withoutResults, date)).toBeNull();
	});
	it('refuses extra private fields and mismatched mark columns at the download boundary', () => {
		const document = projectFinalGradeExport(completeGrid(), date)!;
		expect(finalGradeExportSchema.safeParse({ ...document, comment: 'private' }).success).toBe(
			false
		);
		document.students[0].marks = [];
		expect(finalGradeExportSchema.safeParse(document).success).toBe(false);
	});
});
