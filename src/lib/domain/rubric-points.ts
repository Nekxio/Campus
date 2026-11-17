import type { RubricAssessment } from './grading.js';
import type { ResultRule } from './contracts.js';

export type QuizMaximum = { assessmentId: string; maxPoints: number };

export function sectionMaximum(assessment: RubricAssessment, quizMaxima: QuizMaximum[]) {
	return assessment.kind === 'quiz'
		? (quizMaxima.find((item) => item.assessmentId === assessment.id)?.maxPoints ?? Number.NaN)
		: assessment.lines.reduce((sum, line) => sum + line.maxPoints, 0);
}

/** Compile section maxima to the established normalized calculation engine. */
export function sectionPointsRule(
	assessments: RubricAssessment[],
	quizMaxima: QuizMaximum[]
): Extract<ResultRule, { kind: 'weighted' }> {
	const sections = assessments.filter((assessment) => assessment.purpose === 'graded');
	const total = sections.reduce((sum, assessment) => sum + sectionMaximum(assessment, quizMaxima), 0);
	return {
		kind: 'weighted',
		sectionPoints: { quizMaxima },
		components: sections.map((assessment) => ({
			assessmentIds: [assessment.id],
			weight: (100 * sectionMaximum(assessment, quizMaxima)) / total
		}))
	};
}
