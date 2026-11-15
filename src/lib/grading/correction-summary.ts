import { formatMark, type calculateStudent, type CalculatedGrade } from '#lib/domain/grade-calculation.js';
import type { RubricData, RubricResult } from '#lib/domain/grading.js';
import { assessmentWeights, type CorrectionDraft } from './correction-form.js';
import { scoreDraftSummary } from './score-draft.js';

export const summarizeCorrection = (
	rubric: RubricData,
	draft: CorrectionDraft,
	calculated: ReturnType<typeof calculateStudent>,
	invalidScoreIds: string[]
) => {
	const diagnosticAssessments = rubric.assessments.flatMap((item) => {
		const issues = calculated.assessments[item.id].issues;
		return issues.length ? [{ id: `assessment-${item.id}`, title: item.title, issues }] : [];
	});
	const diagnosticResults = rubric.results.flatMap((item) => {
		// Results repeat assessment diagnostics; retain only their independent rule errors.
		const issues = calculated.results[item.id].issues.filter(
			(issue) =>
				!rubric.assessments.some(
					(assessment) =>
						calculated.assessments[assessment.id].issues.length > 0 && issue.startsWith(`${assessment.title} : `)
				)
		);
		return issues.length ? [{ id: `result-${item.id}`, title: item.title, issues }] : [];
	});
	const resultIssueSummary = (result: RubricResult) => {
		const ids =
			result.rule.kind === 'weighted'
				? result.rule.components.flatMap((component) => component.assessmentIds)
				: result.rule.assessmentIds;
		const count =
			ids
				.filter((id, index) => ids.indexOf(id) === index)
				.reduce((total, id) => {
					const grade = calculated.assessments[id];
					return total + (grade && grade.state !== 'ready' ? grade.issues.length : 0);
				}, 0) ||
			calculated.results[result.id].issues.length ||
			1;
		return `${count} élément${count > 1 ? 's' : ''} ${calculated.results[result.id].state === 'invalid' ? 'à corriger' : 'à compléter'}.`;
	};
	const resultHasScoreError = (result: RubricResult) => {
		const ids =
			result.rule.kind === 'weighted'
				? result.rule.components.flatMap((component) => component.assessmentIds)
				: result.rule.assessmentIds;
		return ids.some((id) => invalidScoreIds.includes(id));
	};
	const resultLabel = (grade: CalculatedGrade, invalidScore = false) => {
		if (invalidScore) return 'Calcul indisponible';
		return grade.state === 'ready'
			? `${formatMark(grade.mark)} /20`
			: grade.state === 'invalid'
				? 'À corriger'
				: 'En attente';
	};
	const delayLabel = (id: string) => {
		const item = draft.assessments.find((value) => value.assessmentId === id)!;
		const grade = calculated.assessments[id];
		if (item.status === 'absent_unjustified') return 'Absence injustifiée · zéro';
		if (item.status === 'absent_justified') return 'Rattrapage à traiter';
		if (rubric.assessments.find((value) => value.id === id)?.kind !== 'project') return 'Aucune pénalité';
		if (item.latenessDecision === 'refused') return 'Production refusée · zéro';
		if (item.latenessDecision === 'exempt') return 'Exception de retard accordée';
		return grade.latenessDays > 0
			? `${grade.latenessDays} jour${grade.latenessDays > 1 ? 's' : ''} · −${formatMark(grade.penalty)} /20`
			: 'Pénalité automatique · aucun retard établi';
	};
	const assessments = rubric.assessments.map((item) => {
		const grade = calculated.assessments[item.id];
		return {
			id: item.id,
			title: item.title,
			kind: item.kind,
			points: scoreDraftSummary(
				item,
				draft.assessments.find((assessment) => assessment.assessmentId === item.id)!
			),
			mark: resultLabel(grade, invalidScoreIds.includes(item.id)),
			raw:
				!invalidScoreIds.includes(item.id) &&
				grade.rawMark !== null &&
				grade.mark !== null &&
				grade.rawMark !== grade.mark
					? `${formatMark(grade.rawMark)} brut → `
					: '',
			weight: assessmentWeights(item, rubric),
			delay: delayLabel(item.id)
		};
	});
	const results = rubric.results.map((result) => {
		const grade = calculated.results[result.id];
		return {
			id: result.id,
			title: result.title,
			mark: resultLabel(grade, resultHasScoreError(result)),
			pending: grade.state !== 'ready',
			explanation: resultHasScoreError(result)
				? 'Corrigez les points signalés.'
				: grade.state === 'ready'
					? result.rule.kind === 'points_ratio' &&
						!result.rule.assessmentIds.every((id) => rubric.assessments.find((item) => item.id === id)?.kind === 'quiz')
						? 'Somme des points, puis conversion sur 20'
						: 'Notes normalisées puis pondérées'
					: resultIssueSummary(result)
		};
	});
	return { assessments, results, diagnostics: [...diagnosticAssessments, ...diagnosticResults] };
};
