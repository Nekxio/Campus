import { describe, expect, it } from 'vitest';
import { blankCorrection, type RubricData, type StudentGrading } from '#lib/domain/grading.js';
import { calculateAssessment } from '#lib/domain/grade-calculation.js';
import {
	correctionInput,
	correctionPayload,
	makeCorrectionSchema,
	mergeSavedAssessment,
	previewCorrection,
	submissionMetadata
} from './correction-form.js';

function fixture() {
	const groupId = crypto.randomUUID();
	const rubric: RubricData = {
		module: { id: crypto.randomUUID(), title: 'Module fictif', revision: 4 },
		assessments: [0, 1].map((index) => ({
			id: crypto.randomUUID(),
			title: `Évaluation ${index + 1}`,
			kind: index === 0 ? 'project' : 'quiz',
			purpose: 'graded',
			groups: [{ id: groupId, title: 'Groupe' }],
			lines: [
				{ id: crypto.randomUUID(), groupId, label: 'Critère fictif', description: '', maxPoints: 5 }
			]
		})),
		results: [],
		contexts: []
	};
	const student: StudentGrading = {
		id: crypto.randomUUID(),
		name: 'Étudiant fictif',
		corrections: [],
		comment: { revision: 0, content: '' },
		retiredScores: []
	};
	const contextId = crypto.randomUUID();
	rubric.contexts = [
		{
			id: contextId,
			classId: crypto.randomUUID(),
			expectedRevision: 1,
			className: 'Classe fictive',
			academicYear: '2026-2027',
			deadlines: [
				{
					assessmentId: rubric.assessments[0].id,
					dueAt: '2026-10-10T21:59:00Z',
					submissionInstructions: ''
				}
			]
		}
	];
	return { rubric, student, contextId };
}

describe('Correction form boundary', () => {
	it('keeps blank distinct from zero and sends every active criterion', () => {
		const { rubric, student } = fixture();
		const input = correctionInput(rubric, student).assessments[0];
		expect(correctionPayload(input, 4).scores).toEqual([
			{ lineId: rubric.assessments[0].lines[0].id, points: null }
		]);
		input.scores[0].points = '0';
		expect(correctionPayload(input, 4).scores[0].points).toBe(0);
	});
	it('validates only the selected assessment when another draft is invalid', () => {
		const { rubric, student, contextId } = fixture();
		let selected = 0;
		const schema = makeCorrectionSchema(
			rubric,
			() => selected,
			() => ({}),
			contextId
		);
		const input = correctionInput(rubric, student);
		input.assessments[1].scores[0].points = '2.5';
		expect(schema.safeParse(input).success).toBe(true);
		selected = 1;
		const parsed = schema.safeParse(input);
		expect(parsed.success).toBe(false);
		if (!parsed.success)
			expect(parsed.error.issues[0].path).toEqual(['assessments', 1, 'scores', 0, 'points']);
	});
	it('requires graded points and a Paris submission date when automatic project delay applies', () => {
		const { rubric, student, contextId } = fixture();
		const schema = makeCorrectionSchema(
			rubric,
			() => 0,
			() => ({}),
			contextId
		);
		const input = correctionInput(rubric, student);
		input.assessments[0].status = 'graded';
		expect(schema.safeParse(input).success).toBe(false);
		input.assessments[0].scores[0].points = '4';
		expect(schema.safeParse(input).success).toBe(false);
		input.assessments[0].latenessDecision = 'exempt';
		expect(schema.safeParse(input).success).toBe(true);
	});
	it('preserves saved points during absence and permits disabled drafts with invalid text', () => {
		const { rubric, student, contextId } = fixture();
		const record = {
			...blankCorrection(rubric.assessments[0].id, 4),
			revision: 2,
			scores: [{ lineId: rubric.assessments[0].lines[0].id, points: 3 }]
		};
		student.corrections.push(record);
		const input = correctionInput(rubric, student);
		input.assessments[0].status = 'absent_justified';
		input.assessments[0].scores[0].points = 'invalid';
		expect(
			makeCorrectionSchema(
				rubric,
				() => 0,
				() => ({}),
				contextId
			).safeParse(input).success
		).toBe(true);
		expect(correctionPayload(input.assessments[0], 4, record)).toMatchObject({
			expectedRevision: 2,
			rubricRevision: 4,
			scores: [{ lineId: record.scores[0].lineId, points: 3 }]
		});
	});
	it('retains an over-maximum stored score after a rubric change and blocks a non-absence save', () => {
		const { rubric, student, contextId } = fixture();
		student.corrections.push({
			...blankCorrection(rubric.assessments[0].id, 3),
			scores: [{ lineId: rubric.assessments[0].lines[0].id, points: 8 }]
		});
		const input = correctionInput(rubric, student);
		expect(input.assessments[0].scores[0].points).toBe('8');
		expect(
			makeCorrectionSchema(
				rubric,
				() => 0,
				() => ({}),
				contextId
			).safeParse(input).success
		).toBe(false);
	});
	it('keeps the exact saved UTC instant unchanged, including an ambiguous Paris clock time', () => {
		const { rubric, student } = fixture();
		const record = {
			...blankCorrection(rubric.assessments[0].id, 4),
			submittedAt: '2026-10-25T00:30:42.123Z'
		};
		student.corrections.push(record);
		const input = correctionInput(rubric, student).assessments[0];
		expect(input.submittedAt).toBe('2026-10-25T02:30');
		expect(
			correctionPayload(input, 4, record, submissionMetadata(student)[record.assessmentId])
				.submittedAt
		).toBe(record.submittedAt);
		input.submittedAt = '2026-10-25T03:30';
		expect(
			correctionPayload(input, 4, record, submissionMetadata(student)[record.assessmentId])
				.submittedAt
		).toBe('2026-10-25T02:30:00.000Z');
	});
	it('keeps another assessment’s original revision and UTC metadata after a selected save', () => {
		const { rubric, student } = fixture();
		const [project, oral] = rubric.assessments;
		student.corrections = [
			{
				...blankCorrection(project.id, 4),
				revision: 3,
				scores: [{ lineId: project.lines[0].id, points: 3 }]
			},
			{
				...blankCorrection(oral.id, 4),
				revision: 2,
				submittedAt: '2026-10-25T00:30:42.123Z',
				scores: [{ lineId: oral.lines[0].id, points: 2 }]
			}
		];
		const draft = correctionInput(rubric, student);
		const oralBaseline = JSON.stringify(draft.assessments[1]);
		draft.assessments[1].scores[0].points = '4';
		const response: StudentGrading = {
			...student,
			corrections: [
				{ ...student.corrections[0], revision: 4 },
				{
					...student.corrections[1],
					revision: 10,
					submittedAt: '2026-10-25T02:30:00Z',
					scores: [{ lineId: oral.lines[0].id, points: 5 }]
				}
			]
		};
		const merged = mergeSavedAssessment(student, response, project.id);
		expect(merged.corrections[0].revision).toBe(4);
		expect(JSON.stringify(correctionInput(rubric, merged).assessments[1])).toBe(oralBaseline);
		const nextWrite = correctionPayload(
			draft.assessments[1],
			4,
			merged.corrections[1],
			submissionMetadata(merged)[oral.id]
		);
		expect(nextWrite).toMatchObject({
			expectedRevision: 2,
			submittedAt: '2026-10-25T00:30:42.123Z',
			scores: [{ lineId: oral.lines[0].id, points: 4 }]
		});
		// The next save still conflicts with the other window's revision 10.
		expect(nextWrite.expectedRevision).not.toBe(response.corrections[1].revision);
	});

	it('rejects unsupported numeric text in the visible result preview', () => {
		const { rubric, student } = fixture();
		const input = correctionInput(rubric, student).assessments[1];
		input.status = 'graded';
		input.scores[0].points = '0x4';
		expect(calculateAssessment(rubric.assessments[1], previewCorrection(input, 4)).state).toBe(
			'invalid'
		);
	});
});
