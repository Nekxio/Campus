import { z } from 'zod';
import { assessmentStatusSchema } from '#lib/domain/contracts.js';
import { blankCorrection, type CorrectionRecord, type StudentGrading } from '#lib/domain/grading.js';
import { calculateAssessment } from '#lib/domain/grade-calculation.js';
import { proposalDecisionSchema, type ProposalDecision, type ProposalReviewSelection } from '#lib/domain/proposals.js';

const pointsInputSchema = z.strictObject({
	status: assessmentStatusSchema,
	scores: z
		.array(z.strictObject({ lineId: z.string(), points: z.string() }))
		.min(1)
		.max(1000)
});
export type ProposalPointsDraft = z.infer<typeof pointsInputSchema>;
export const proposalCommentSchema = z.strictObject({ content: z.string().max(10000) });
export type ProposalDecisionInput = ProposalDecision extends infer Decision
	? Decision extends ProposalDecision
		? Omit<Decision, 'requestId'>
		: never
	: never;
export type DecisionRetry = { fingerprint: string; requestId: string };

export function recordedProposalInput(selection: ProposalReviewSelection): ProposalPointsDraft {
	const assessment = selection.rubric.assessments.find((item) => item.id === selection.assessmentId);
	const correction = selection.student.corrections.find((item) => item.assessmentId === selection.assessmentId);
	return {
		status: correction?.status ?? 'to_evaluate',
		scores: (assessment?.lines ?? []).map((line) => {
			const points = correction?.scores.find((score) => score.lineId === line.id)?.points;
			return { lineId: line.id, points: points == null ? '' : String(points) };
		})
	};
}

// An omitted proposal line retains its recorded value; a proposed null explicitly clears it.
export function proposalInput(selection: ProposalReviewSelection): ProposalPointsDraft {
	const current = recordedProposalInput(selection);
	const proposed = new Map(selection.proposal.payload?.scores.map((score) => [score.lineId, score.points]));
	const scores = current.scores.map((score) => {
		if (!proposed.has(score.lineId)) return score;
		const points = proposed.get(score.lineId);
		return { ...score, points: points == null ? '' : String(points) };
	});
	return {
		status:
			current.status === 'to_evaluate' && scores.length > 0 && scores.every((score) => score.points !== '')
				? 'graded'
				: current.status,
		scores
	};
}

export function proposalPreview(selection: ProposalReviewSelection, input: ProposalPointsDraft): StudentGrading {
	const record =
		selection.student.corrections.find((item) => item.assessmentId === selection.assessmentId) ??
		blankCorrection(selection.assessmentId, selection.rubric.module.revision);
	const preview: CorrectionRecord = {
		...record,
		rubricRevision: selection.rubric.module.revision,
		status: input.status,
		scores: input.scores.map((score) => {
			const raw = score.points.trim();
			return {
				lineId: score.lineId,
				points: raw === '' ? null : /^\d+$/.test(raw) ? Number(raw) : Number.NaN
			};
		})
	};
	return {
		...selection.student,
		corrections: selection.student.corrections.some((item) => item.assessmentId === selection.assessmentId)
			? selection.student.corrections.map((item) => (item.assessmentId === selection.assessmentId ? preview : item))
			: [...selection.student.corrections, preview]
	};
}

export function makeProposalPointsSchema(selection: () => ProposalReviewSelection) {
	return pointsInputSchema.superRefine((draft, context) => {
		const review = selection();
		const assessment = review.rubric.assessments.find((item) => item.id === review.assessmentId);
		const issue = (path: (string | number)[], message: string) => context.addIssue({ code: 'custom', path, message });
		if (!assessment) {
			issue([], 'Cette évaluation ne figure plus dans le barème. Actualisez la proposition.');
			return;
		}
		if (draft.status.startsWith('absent_')) {
			issue(['status'], 'Choisissez un statut sans absence avant de valider des points.');
			return;
		}
		if (
			draft.scores.length !== assessment.lines.length ||
			draft.scores.some((score, index) => score.lineId !== assessment.lines[index]?.id)
		) {
			issue(['scores'], 'Le barème a changé. Actualisez les références ; vos saisies seront conservées.');
			return;
		}
		for (const [index, score] of draft.scores.entries()) {
			const raw = score.points.trim();
			const line = assessment.lines[index];
			if (raw && (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > 1000000)) {
				issue(['scores', index, 'points'], 'Saisissez un entier positif ou zéro. Un champ vide reste non noté.');
			} else if (raw && Number(raw) > line.maxPoints) {
				issue(['scores', index, 'points'], `Le maximum est ${line.maxPoints}. Corrigez les points conservés.`);
			} else if (!raw && draft.status === 'graded') {
				const record = review.student.corrections.find((item) => item.assessmentId === assessment.id);
				if (!(assessment.kind === 'project' && record?.latenessDecision === 'refused')) {
					issue(['scores', index, 'points'], 'Complétez les points, ou conservez le statut À évaluer.');
				}
			}
		}
		if (draft.status === 'graded') {
			const preview = proposalPreview(review, draft);
			const grade = calculateAssessment(
				assessment,
				preview.corrections.find((item) => item.assessmentId === assessment.id),
				review.rubric.contexts
					.find((item) => item.id === review.contextId)
					?.deadlines.find((item) => item.assessmentId === assessment.id)?.dueAt
			);
			if (grade.issues.some((message) => message.startsWith('Renseignez la date de remise'))) {
				issue(
					['status'],
					'La date de remise ou la décision de retard manque. Complétez-la dans la correction, puis demandez une proposition à jour.'
				);
			}
		}
	});
}

export function proposalPointsDecision(input: ProposalPointsDraft, expectedRevision: number): ProposalDecisionInput {
	return {
		action: 'accept_points',
		expectedRevision,
		status: input.status,
		scores: input.scores.map((score) => ({
			lineId: score.lineId,
			points: score.points.trim() === '' ? null : Number(score.points)
		}))
	};
}

export function retryDecision(
	input: ProposalDecisionInput,
	previous?: DecisionRetry,
	newId: () => string = () => crypto.randomUUID()
): { decision: ProposalDecision; retry: DecisionRetry } {
	const fingerprint = JSON.stringify(input);
	const retry = previous?.fingerprint === fingerprint ? previous : { fingerprint, requestId: newId() };
	return {
		decision: proposalDecisionSchema.parse({ ...input, requestId: retry.requestId }),
		retry
	};
}

// A deliberate refresh reconciles by stable rubric IDs, keeping detached drafts visible as history.
export function reconcileProposalInput(
	selection: ProposalReviewSelection,
	previous: ProposalPointsDraft
): { draft: ProposalPointsDraft; detached: ProposalPointsDraft['scores'] } {
	const fresh = proposalInput(selection);
	const existing = new Map(previous.scores.map((score) => [score.lineId, score]));
	return {
		draft: {
			status: previous.status,
			scores: fresh.scores.map((score) => existing.get(score.lineId) ?? score)
		},
		detached: previous.scores.filter((score) => !fresh.scores.some((line) => line.lineId === score.lineId))
	};
}
