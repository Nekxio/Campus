import { sectionWeightLabel } from '#lib/domain/grade-export.js';
import { z } from 'zod';
import {
	correctionWriteSchema,
	type CorrectionRecord,
	type CorrectionWrite,
	type RubricAssessment,
	type RubricData,
	type StudentGrading
} from '#lib/domain/grading.js';
import { fromDateInput, toDateInput } from '#lib/teaching/calendar.js';
import { scoreInputError } from './score-draft.js';

const assessmentInput = z.strictObject({
	assessmentId: z.string(),
	status: z.enum(['to_evaluate', 'graded', 'absent_unjustified', 'absent_justified']),
	submissionUrl: z.string(),
	submittedAt: z.string(),
	latenessDecision: z.enum(['automatic', 'exempt', 'refused']),
	scores: z.array(z.strictObject({ lineId: z.string(), points: z.string() }))
});
const draftInput = z.strictObject({ assessments: z.array(assessmentInput) });
export type AssessmentInput = z.infer<typeof assessmentInput>;
export type CorrectionDraft = z.infer<typeof draftInput>;
export type SavedSubmission = { local: string; instant: string | null };

export function correctionInput(rubric: RubricData, student: StudentGrading): CorrectionDraft {
	return {
		assessments: rubric.assessments.map((assessment) => {
			const record = student.corrections.find((item) => item.assessmentId === assessment.id);
			return {
				assessmentId: assessment.id,
				status: record?.status ?? 'to_evaluate',
				submissionUrl: record?.submissionUrl ?? '',
				submittedAt: toDateInput(record?.submittedAt ?? ''),
				latenessDecision: record?.latenessDecision ?? 'automatic',
				scores: assessment.lines.map((line) => {
					const points = record?.scores.find((score) => score.lineId === line.id)?.points;
					return { lineId: line.id, points: points == null ? '' : String(points) };
				})
			};
		})
	};
}
// A selected assessment save must not advance revisions behind independent drafts.
export function mergeSavedAssessment(
	previous: StudentGrading,
	fresh: StudentGrading,
	assessmentId: string
): StudentGrading {
	const saved = fresh.corrections.find((record) => record.assessmentId === assessmentId);
	if (!saved) throw new Error('La réponse ne contient pas l’évaluation enregistrée.');
	const existing = previous.corrections.some((record) => record.assessmentId === assessmentId);
	return {
		...previous,
		corrections: existing
			? previous.corrections.map((record) => (record.assessmentId === assessmentId ? saved : record))
			: [...previous.corrections, saved]
	};
}
export function submissionMetadata(student: StudentGrading): Record<string, SavedSubmission> {
	return Object.fromEntries(
		student.corrections.map((record) => [
			record.assessmentId,
			{
				local: toDateInput(record.submittedAt ?? ''),
				instant: record.submittedAt
			}
		])
	);
}
function submissionInstant(local: string, saved?: SavedSubmission) {
	if (saved?.local === local) return saved.instant;
	return local ? fromDateInput(local) : null;
}
export function correctionPayload(
	input: AssessmentInput,
	rubricRevision: number,
	record?: CorrectionRecord,
	saved?: SavedSubmission
): CorrectionWrite {
	return {
		expectedRevision: record?.revision ?? 0,
		rubricRevision,
		status: input.status,
		submissionUrl: input.submissionUrl.trim() || null,
		submittedAt: submissionInstant(input.submittedAt, saved),
		latenessDecision: input.latenessDecision,
		scores: input.scores.map((score) => ({
			lineId: score.lineId,
			points: input.status.startsWith('absent_')
				? (record?.scores.find((savedScore) => savedScore.lineId === score.lineId)?.points ?? null)
				: score.points.trim() === ''
					? null
					: Number(score.points)
		}))
	};
}
export function previewCorrection(
	input: AssessmentInput,
	rubricRevision: number,
	record?: CorrectionRecord,
	saved?: SavedSubmission
): CorrectionRecord {
	let submittedAt: string | null = null;
	try {
		submittedAt = submissionInstant(input.submittedAt, saved);
	} catch {
		/* Invalid local dates stay pending until corrected. */
	}
	return {
		assessmentId: input.assessmentId,
		revision: record?.revision ?? 0,
		rubricRevision,
		status: input.status,
		submissionUrl: input.submissionUrl.trim() || null,
		submittedAt,
		latenessDecision: input.latenessDecision,
		scores: input.scores.map((score) => ({
			lineId: score.lineId,
			points: score.points.trim() === '' ? null : /^\d+$/.test(score.points.trim()) ? Number(score.points) : Number.NaN
		}))
	};
}
export function makeCorrectionSchema(
	rubric: RubricData,
	selectedIndex: () => number,
	saved: () => Record<string, SavedSubmission>,
	contextId: string
) {
	return draftInput.superRefine((draft, context) => {
		const index = selectedIndex();
		const input = draft.assessments[index];
		const assessment = rubric.assessments[index];
		if (!input || !assessment) return;
		const issue = (path: (string | number)[], message: string) =>
			context.addIssue({ code: 'custom', path: ['assessments', index, ...path], message });
		for (const [scoreIndex, score] of input.scores.entries()) {
			if (input.status.startsWith('absent_')) continue;
			const raw = score.points.trim();
			const error = scoreInputError(raw, assessment.lines[scoreIndex].maxPoints);
			if (error) issue(['scores', scoreIndex, 'points'], error);
			if (!raw && input.status === 'graded' && !(assessment.kind === 'project' && input.latenessDecision === 'refused'))
				issue(['scores', scoreIndex, 'points'], 'Complétez les points, ou conservez le statut À évaluer.');
		}
		if (
			input.status === 'graded' &&
			assessment.kind === 'project' &&
			input.latenessDecision === 'automatic' &&
			!input.submittedAt &&
			rubric.contexts
				.find((context) => context.id === contextId)
				?.deadlines.some((deadline) => deadline.assessmentId === assessment.id)
		)
			issue(['submittedAt'], 'Renseignez la date de remise ou accordez une exception de retard.');
		let payload: CorrectionWrite;
		try {
			payload = correctionPayload(input, rubric.module.revision, undefined, saved()[assessment.id]);
		} catch {
			issue(['submittedAt'], 'Cette date ou heure est invalide ou ambiguë. Choisissez une autre heure.');
			return;
		}
		const parsed = correctionWriteSchema.safeParse(payload);
		if (!parsed.success)
			for (const error of parsed.error.issues) {
				if (error.path[0] === 'scores') continue;
				issue(
					error.path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number'),
					error.path[0] === 'submissionUrl'
						? 'Renseignez un lien HTTPS valide, sans identifiant ni mot de passe.'
						: error.message
				);
			}
	});
}
export function assessmentWeights(assessment: RubricAssessment, rubric: RubricData) {
	return sectionWeightLabel(assessment, rubric.results, rubric.assessments);
}
