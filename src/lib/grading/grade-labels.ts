import type { CorrectionRecord, RubricAssessment, RubricResult } from '../domain/grading.js';
import { calendarLateness, formatMark, projectLatenessLimit } from '../domain/grade-calculation.js';

export function projectDelayLabel(
	assessment: Pick<RubricAssessment, 'kind'>,
	record: CorrectionRecord | undefined,
	deadline: { dueAt: string } | undefined
) {
	if (record?.status === 'absent_unjustified') return 'Absence injustifiée enregistrée · zéro';
	if (record?.status === 'absent_justified') return 'Absence justifiée enregistrée · rattrapage à traiter';
	if (assessment.kind !== 'project') return '';
	if (record?.latenessDecision === 'exempt') return 'Exception de retard accordée';
	if (record?.latenessDecision === 'refused') return 'Production refusée · zéro';
	if (!record?.submittedAt || !deadline) return 'Pénalité automatique · retard non établi';
	const days = calendarLateness(deadline.dueAt, record.submittedAt);
	if (days > projectLatenessLimit) return `Retard du projet : ${days} jours · au-delà de cinq jours, projet à zéro`;
	return days
		? `Retard du projet : ${days} jour${days > 1 ? 's' : ''} · −${formatMark(days)} /20`
		: 'Pénalité automatique · aucun retard';
}

export function resultRuleLabel(result: RubricResult, assessments: RubricAssessment[]) {
	if (result.rule.kind === 'weighted') return 'Notes normalisées puis pondérées';
	if (
		result.rule.assessmentIds.length &&
		result.rule.assessmentIds.every((id) => assessments.find((assessment) => assessment.id === id)?.kind === 'quiz')
	)
		return 'Sections Quiz normalisées sur 20 puis moyennées à poids égal';
	return 'Somme des points, puis conversion sur 20 ; dans chaque section Quiz, moyenne des quiz normalisés à poids égal';
}
