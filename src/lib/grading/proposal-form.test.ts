import { describe, expect, it } from 'vitest';
import { blankCorrection, type RubricAssessment } from '#lib/domain/grading.js';
import { calculateStudent } from '#lib/domain/grade-calculation.js';
import type { ProposalReviewSelection } from '#lib/domain/proposals.js';
import {
	makeProposalPointsSchema,
	proposalInput,
	proposalPointsDecision,
	proposalPreview,
	reconcileProposalInput,
	retryDecision
} from './proposal-form.js';

function fixture(): ProposalReviewSelection {
	const groupId = crypto.randomUUID();
	const assessment: RubricAssessment = {
		id: crypto.randomUUID(),
		title: 'Projet fictif',
		kind: 'project',
		purpose: 'graded',
		groups: [{ id: groupId, title: 'Groupe fictif' }],
		lines: [0, 1, 2].map((index) => ({
			id: crypto.randomUUID(),
			groupId,
			label: `Critère ${index + 1}`,
			description: 'Repère fictif',
			maxPoints: 5
		}))
	};
	const moduleId = crypto.randomUUID();
	const studentId = crypto.randomUUID();
	const contextId = crypto.randomUUID();
	return {
		contextId,
		assessmentId: assessment.id,
		pointsIssues: [],
		commentIssues: [],
		rubric: {
			module: { id: moduleId, title: 'Module fictif', revision: 4 },
			assessments: [assessment],
			results: [],
			contexts: [
				{
					id: contextId,
					expectedRevision: 2,
					className: 'Classe fictive',
					academicYear: '2026–2027',
					deadlines: []
				}
			]
		},
		student: {
			id: studentId,
			name: 'Étudiant fictif',
			corrections: [
				{
					...blankCorrection(assessment.id, 4),
					revision: 3,
					status: 'graded',
					scores: assessment.lines.map((line) => ({ lineId: line.id, points: 3 }))
				}
			],
			comment: { revision: 2, content: 'Commentaire actuel' },
			retiredScores: []
		},
		proposal: {
			id: crypto.randomUUID(),
			revision: 1,
			state: 'pending',
			commentState: 'pending',
			createdAt: '2026-10-12T10:00:00Z',
			legacy: false,
			appliedCorrectionRevision: null,
			payload: {
				version: 2,
				moduleId,
				contextId,
				studentId,
				assessmentId: assessment.id,
				rubricRevision: 4,
				contextRevision: 2,
				correctionRevision: 3,
				scores: [{ lineId: assessment.lines[0].id, points: 5 }],
				semesterComment: 'Commentaire proposé',
				commentRevision: 2
			}
		}
	};
}

describe('Proposal form boundary', () => {
	it('merges partial proposals with all active recorded scores and preserves explicit null versus zero', () => {
		const selection = fixture();
		const lines = selection.rubric.assessments[0].lines;
		selection.proposal.payload!.scores.push({ lineId: lines[1].id, points: null });
		const input = proposalInput(selection);
		expect(input.scores.map((score) => score.points)).toEqual(['5', '', '3']);
		input.status = 'to_evaluate';
		const first = proposalPointsDecision(input, 1);
		expect(first).toMatchObject({
			scores: [
				{ lineId: lines[0].id, points: 5 },
				{ lineId: lines[1].id, points: null },
				{ lineId: lines[2].id, points: 3 }
			]
		});
		input.scores[1].points = '0';
		expect(proposalPointsDecision(input, 1)).toMatchObject({
			scores: [
				{ lineId: lines[0].id, points: 5 },
				{ lineId: lines[1].id, points: 0 },
				{ lineId: lines[2].id, points: 3 }
			]
		});
	});
	it('defaults an ungraded correction to graded only when every active line is complete', () => {
		const selection = fixture();
		selection.student.corrections = [];
		expect(proposalInput(selection).status).toBe('to_evaluate');
		selection.proposal.payload!.scores = selection.rubric.assessments[0].lines.map((line) => ({
			lineId: line.id,
			points: 0
		}));
		expect(proposalInput(selection).status).toBe('graded');
		selection.proposal.payload!.scores[1].points = null;
		expect(proposalInput(selection).status).toBe('to_evaluate');
	});
	it('preserves absence and blocks point acceptance until the teacher selects a non-absence status', () => {
		const selection = fixture();
		selection.student.corrections[0].status = 'absent_justified';
		const input = proposalInput(selection);
		const schema = makeProposalPointsSchema(() => selection);
		expect(input.status).toBe('absent_justified');
		const absent = schema.safeParse(input);
		expect(absent.success).toBe(false);
		if (!absent.success) expect(absent.error.issues[0].path).toEqual(['status']);
		input.status = 'graded';
		expect(schema.safeParse(input).success).toBe(true);
	});
	it('retains excessive points without clamping and rejects decimal, hexadecimal, negative and over-maximum text', () => {
		const selection = fixture();
		selection.student.corrections[0].scores[2].points = 8;
		const input = proposalInput(selection);
		const schema = makeProposalPointsSchema(() => selection);
		expect(input.scores[2].points).toBe('8');
		expect(schema.safeParse(input).success).toBe(false);
		input.scores[2].points = '3';
		for (const raw of ['2.5', '0x4', '-1', '6', '1000001', '1e2']) {
			input.scores[0].points = raw;
			expect(schema.safeParse(input).success).toBe(false);
		}
		input.scores[0].points = ' 0 ';
		expect(schema.safeParse(input).success).toBe(true);
	});
	it('requires complete graded points and the existing submission metadata when automatic delay applies', () => {
		const selection = fixture();
		const input = proposalInput(selection);
		const schema = makeProposalPointsSchema(() => selection);
		input.scores[0].points = '';
		expect(schema.safeParse(input).success).toBe(false);
		input.status = 'to_evaluate';
		expect(schema.safeParse(input).success).toBe(true);
		input.status = 'graded';
		input.scores[0].points = '4';
		selection.rubric.contexts[0].deadlines.push({
			assessmentId: selection.assessmentId,
			dueAt: '2026-10-10T21:59:00Z',
			submissionInstructions: ''
		});
		expect(schema.safeParse(input).success).toBe(false);
		selection.student.corrections[0].latenessDecision = 'exempt';
		expect(schema.safeParse(input).success).toBe(true);
	});
	it('previews only the selected correction and retains submission precision, lateness, comments and independent result rules', () => {
		const selection = fixture();
		const record = selection.student.corrections[0];
		record.submissionUrl = 'https://example.test/submission';
		record.submittedAt = '2026-10-12T00:30:42.123Z';
		selection.rubric.contexts[0].deadlines.push({
			assessmentId: selection.assessmentId,
			dueAt: '2026-10-10T21:59:00Z',
			submissionInstructions: ''
		});
		const quiz = {
			...selection.rubric.assessments[0],
			id: crypto.randomUUID(),
			kind: 'quiz' as const,
			title: 'Quiz fictif',
			lines: [
				{ ...selection.rubric.assessments[0].lines[0], id: crypto.randomUUID(), maxPoints: 10 }
			]
		};
		selection.rubric.assessments.push(quiz);
		const quizRecord = {
			...blankCorrection(quiz.id, 4),
			revision: 6,
			status: 'graded' as const,
			scores: [{ lineId: quiz.lines[0].id, points: 5 }]
		};
		selection.student.corrections.push(quizRecord);
		selection.rubric.results = [
			{
				id: crypto.randomUUID(),
				title: 'Projet indépendant',
				rule: { kind: 'points_ratio', assessmentIds: [selection.assessmentId] }
			},
			{
				id: crypto.randomUUID(),
				title: 'Résultat pondéré',
				rule: {
					kind: 'weighted',
					components: [
						{ assessmentIds: [selection.assessmentId], weight: 25 },
						{ assessmentIds: [quiz.id], weight: 75 }
					]
				}
			}
		];
		const preview = proposalPreview(selection, proposalInput(selection));
		expect(preview.corrections[0]).toMatchObject({
			submissionUrl: record.submissionUrl,
			submittedAt: record.submittedAt,
			latenessDecision: 'automatic',
			status: 'graded'
		});
		expect(preview.corrections[1]).toBe(quizRecord);
		expect(preview.comment).toBe(selection.student.comment);
		const calculated = calculateStudent(
			selection.rubric.assessments,
			selection.rubric.results,
			preview,
			selection.rubric.contexts[0].deadlines
		);
		const projectMark = (20 * 11) / 15 - 2;
		expect(calculated.results[selection.rubric.results[0].id].mark).toBeCloseTo(projectMark);
		expect(calculated.results[selection.rubric.results[1].id].mark).toBeCloseTo(
			projectMark * 0.25 + 10 * 0.75
		);
		expect(proposalPointsDecision(proposalInput(selection), 1)).not.toHaveProperty('submittedAt');
	});
	it('reuses the retry request for identical input, but changes it for a changed draft or revision', () => {
		const selection = fixture();
		const input = proposalInput(selection);
		const first = retryDecision(proposalPointsDecision(input, 1));
		const same = retryDecision(proposalPointsDecision(input, 1), first.retry);
		expect(same.decision.requestId).toBe(first.decision.requestId);
		input.scores[0].points = '4';
		const changed = retryDecision(proposalPointsDecision(input, 1), first.retry);
		expect(changed.decision.requestId).not.toBe(first.decision.requestId);
		const revised = retryDecision(proposalPointsDecision(input, 2), changed.retry);
		expect(revised.decision.requestId).not.toBe(changed.decision.requestId);
	});
	it('refreshes active rows by stable IDs while preserving manual edits and detached draft points', () => {
		const selection = fixture();
		const input = proposalInput(selection);
		input.scores[0].points = '4';
		input.scores[1].points = '0';
		const removed = selection.rubric.assessments[0].lines.splice(1, 1)[0];
		selection.rubric.assessments[0].lines.push({
			...removed,
			id: crypto.randomUUID(),
			maxPoints: 2
		});
		expect(makeProposalPointsSchema(() => selection).safeParse(input).success).toBe(false);
		const reconciled = reconcileProposalInput(selection, input);
		expect(reconciled.draft.scores.map((score) => score.points)).toEqual(['4', '3', '']);
		expect(reconciled.detached).toEqual([{ lineId: removed.id, points: '0' }]);
	});
});
