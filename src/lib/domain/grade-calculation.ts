import type {
	CorrectionRecord,
	RubricAssessment,
	RubricResult,
	StudentGrading
} from './grading.js';

export type CalculatedGrade = {
	state: 'ready' | 'pending' | 'invalid';
	rawPoints: number | null;
	maxPoints: number;
	rawMark: number | null;
	mark: number | null;
	latenessDays: number;
	penalty: number;
	issues: string[];
};
const parisDate = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Europe/Paris',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});
function calendarDay(instant: string) {
	const parts = parisDate.formatToParts(new Date(instant));
	const get = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((p) => p.type === type)?.value);
	return Date.UTC(get('year'), get('month') - 1, get('day')) / 86400000;
}
export function calendarLateness(dueAt: string, submittedAt: string) {
	return Math.max(0, calendarDay(submittedAt) - calendarDay(dueAt));
}
export function calculateAssessment(
	assessment: RubricAssessment,
	correction?: CorrectionRecord,
	dueAt?: string
): CalculatedGrade {
	const maxPoints = assessment.lines.reduce((sum, line) => sum + line.maxPoints, 0);
	const base: CalculatedGrade = {
		state: 'pending',
		rawPoints: null,
		maxPoints,
		rawMark: null,
		mark: null,
		latenessDays: 0,
		penalty: 0,
		issues: []
	};
	if (!maxPoints)
		return { ...base, state: 'invalid', issues: ['Le barème doit avoir un maximum positif.'] };
	if (!correction || correction.status === 'to_evaluate')
		return { ...base, issues: ['Évaluation à compléter.'] };
	if (correction.status === 'absent_justified')
		return { ...base, issues: ['Rattrapage à traiter.'] };
	const awarded = new Map(correction.scores.map((score) => [score.lineId, score.points]));
	const partial = assessment.lines.reduce((sum, line) => {
		const points = awarded.get(line.id);
		return (
			sum + (typeof points === 'number' && Number.isInteger(points) && points >= 0 ? points : 0)
		);
	}, 0);
	if (correction.status === 'absent_unjustified')
		return { ...base, state: 'ready', rawPoints: 0, rawMark: 0, mark: 0 };
	if (assessment.kind === 'project' && correction.latenessDecision === 'refused')
		return {
			...base,
			state: 'ready',
			rawPoints: partial,
			rawMark: (20 * partial) / maxPoints,
			mark: 0,
			issues: ['Production refusée.']
		};
	const invalid = assessment.lines.filter((line) => {
		const points = awarded.get(line.id);
		return points != null && (!Number.isInteger(points) || points < 0 || points > line.maxPoints);
	});
	if (invalid.length)
		return {
			...base,
			state: 'invalid',
			rawPoints: invalid.some((line) => !Number.isInteger(awarded.get(line.id))) ? null : partial,
			issues: invalid.map(
				(line) => `${line.label} : points à corriger (maximum ${line.maxPoints}).`
			)
		};
	const missing = assessment.lines.filter((line) => awarded.get(line.id) == null);
	if (missing.length)
		return {
			...base,
			rawPoints: partial,
			issues: missing.map((line) => `${line.label} : points manquants.`)
		};
	// Each line of a Quiz section is one Wayground quiz, with its own question count.
	// Normalize before averaging: a longer quiz must not carry more weight.
	if (correction.needsReview)
		return {
			...base,
			rawPoints: partial,
			issues: ['Barème modifié : vérifiez et enregistrez à nouveau cette évaluation.']
		};
	const rawMark =
		assessment.kind === 'quiz'
			? assessment.lines.reduce(
					(sum, line) => sum + (20 * awarded.get(line.id)!) / line.maxPoints,
					0
				) / assessment.lines.length
			: (20 * partial) / maxPoints;
	const project = assessment.kind === 'project';
	if (project && dueAt && !correction.submittedAt && correction.latenessDecision === 'automatic')
		return {
			...base,
			rawPoints: partial,
			rawMark,
			issues: ['Renseignez la date de remise ou accordez une exception de retard.']
		};
	const latenessDays =
		project && dueAt && correction.submittedAt
			? calendarLateness(dueAt, correction.submittedAt)
			: 0;
	const penalty =
		project && correction.latenessDecision === 'automatic'
			? latenessDays > 5
				? rawMark
				: latenessDays
			: 0;
	return {
		...base,
		state: 'ready',
		rawPoints: partial,
		rawMark,
		mark: Math.max(0, rawMark - penalty),
		latenessDays,
		penalty
	};
}
export function calculateResult(
	result: RubricResult,
	assessments: RubricAssessment[],
	grades: Record<string, CalculatedGrade>
): CalculatedGrade {
	const components =
		result.rule.kind === 'weighted'
			? result.rule.components
			: [{ assessmentIds: result.rule.assessmentIds, weight: 100 }];
	const base: CalculatedGrade = {
		state: 'pending',
		rawPoints: null,
		maxPoints: 0,
		rawMark: null,
		mark: null,
		latenessDays: 0,
		penalty: 0,
		issues: []
	};
	const allIds = components.flatMap((component) => component.assessmentIds);
	if (
		Math.abs(components.reduce((sum, c) => sum + c.weight, 0) - 100) > 1e-8 ||
		new Set(allIds).size !== allIds.length ||
		!allIds.length
	)
		return { ...base, state: 'invalid', issues: ['Règle de calcul à corriger.'] };
	let total = 0;
	for (const component of components) {
		let points = 0;
		let maximum = 0;
		for (const id of component.assessmentIds) {
			const assessment = assessments.find((item) => item.id === id);
			const grade = grades[id];
			if (!assessment || assessment.purpose !== 'graded' || !grade)
				return {
					...base,
					state: 'invalid',
					issues: ['Évaluation notée indisponible dans la règle.']
				};
			if (grade.state !== 'ready')
				return {
					...base,
					state: grade.state,
					issues: [assessment.title + ' : ' + grade.issues.join(' ')]
				};
			const equalQuizWeight = component.assessmentIds.every(
				(assessmentId) => assessments.find((item) => item.id === assessmentId)?.kind === 'quiz'
			);
			const share = result.rule.kind === 'weighted' || equalQuizWeight ? 1 : grade.maxPoints;
			maximum += share;
			points += (grade.mark! / 20) * share;
		}
		if (!maximum) return { ...base, state: 'invalid', issues: ['Maximum de composante nul.'] };
		total += (((20 * points) / maximum) * component.weight) / 100;
	}
	// The accepted 1e-8 weight-sum error contributes at most 20 * 1e-8 / 100.
	// Allow 1e-8 outside the final /20 boundary for that error and floating arithmetic noise.
	const boundaryTolerance = 1e-8;
	if (!Number.isFinite(total) || total < -boundaryTolerance || total > 20 + boundaryTolerance)
		return { ...base, state: 'invalid', issues: ['Résultat hors des limites de 0 à 20.'] };
	const mark = total < 0 ? 0 : total > 20 ? 20 : total;
	return { ...base, state: 'ready', mark, rawMark: total };
}
export function calculateStudent(
	assessments: RubricAssessment[],
	results: RubricResult[],
	student: StudentGrading,
	deadlines: { assessmentId: string; dueAt: string }[] = []
) {
	const grades = Object.fromEntries(
		assessments.map((assessment) => [
			assessment.id,
			calculateAssessment(
				assessment,
				student.corrections.find((c) => c.assessmentId === assessment.id),
				deadlines.find((d) => d.assessmentId === assessment.id)?.dueAt
			)
		])
	);
	const outputs = Object.fromEntries(
		results.map((result) => [result.id, calculateResult(result, assessments, grades)])
	);
	const requiredIds = new Set(
		results.flatMap((result) =>
			result.rule.kind === 'weighted'
				? result.rule.components.flatMap((c) => c.assessmentIds)
				: result.rule.assessmentIds
		)
	);
	const complete =
		results.length > 0 &&
		Object.values(outputs).every((g) => g.state === 'ready') &&
		[...requiredIds].every((id) => grades[id]?.state === 'ready');
	return { assessments: grades, results: outputs, complete };
}
export function formatMark(mark: number | null) {
	return mark === null
		? '—'
		: new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
				Math.round((mark + Number.EPSILON) * 10) / 10
			);
}
