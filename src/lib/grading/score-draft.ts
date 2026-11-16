import { calculateAssessment, formatMark } from '#lib/domain/grade-calculation.js';
import { blankCorrection, type RubricAssessment } from '#lib/domain/grading.js';
import type { AssessmentInput } from './correction-form.js';

export const scoreInputError = (raw: string, maximum: number): string | null => {
	const value = raw.trim();
	if (!value) return null;
	const points = Number(value);
	return /^\d+$/.test(value) && Number.isSafeInteger(points) && points <= Math.min(maximum, 1000000)
		? null
		: `Saisissez un entier entre 0 et ${maximum}. La valeur saisie est conservée.`;
};

export const hasScoreInputError = (assessment: RubricAssessment, input: AssessmentInput): boolean =>
	!input.status.startsWith('absent_') &&
	assessment.lines.some((line) =>
		scoreInputError(input.scores.find((score) => score.lineId === line.id)?.points ?? '', line.maxPoints)
	);

export const scoreDraftSummary = (assessment: RubricAssessment, input: AssessmentInput, groupId?: string): string => {
	if (input.status.startsWith('absent_')) return 'Points conservés · saisie désactivée pour l’absence';
	const lines = assessment.lines.filter((line) => !groupId || line.groupId === groupId);
	const selected = { ...assessment, lines };
	if (hasScoreInputError(selected, input)) return 'Calcul indisponible · corrigez les points';
	const scores = lines.map((line) => {
		const raw = input.scores.find((score) => score.lineId === line.id)?.points.trim() ?? '';
		return { lineId: line.id, points: raw === '' ? null : Number(raw) };
	});
	const filled = scores.filter((score) => score.points !== null).length;
	const progress = `${filled}/${lines.length} renseignés`;
	if (!filled) return `Aucun critère noté · ${progress}`;
	// This is a raw-score preview, not a saved status or a final result with delay penalties.
	const grade = calculateAssessment(selected, {
		...blankCorrection(assessment.id, 0),
		status: 'graded',
		scores
	});
	if (grade.state === 'invalid') return 'Calcul indisponible · barème à corriger';
	if (assessment.kind === 'quiz')
		return grade.rawMark === null
			? `Moyenne des quiz incomplète · ${progress}`
			: `${formatMark(grade.rawMark)} /20 · moyenne des quiz · ${progress}`;
	return `${grade.rawPoints} / ${grade.maxPoints} pts${filled < lines.length ? ' · partiel' : ''} · ${progress}`;
};
