import { z } from 'zod';
import type { GradeGridData } from './grading.js';
import { calculateStudent } from './grade-calculation.js';
import type { RubricAssessment, RubricResult } from './grading.js';

export function sectionWeight(
	assessment: RubricAssessment,
	result: RubricResult,
	assessments: RubricAssessment[]
) {
	if (assessment.purpose !== 'graded') return 0;
	const components =
		result.rule.kind === 'weighted'
			? result.rule.components
			: [{ assessmentIds: result.rule.assessmentIds, weight: 100 }];
	const component = components.find((item) => item.assessmentIds.includes(assessment.id));
	if (!component) return 0;
	if (
		result.rule.kind === 'weighted' ||
		component.assessmentIds.every(
			(id) => assessments.find((item) => item.id === id)?.kind === 'quiz'
		)
	)
		return component.weight / component.assessmentIds.length;
	const maximum = assessments
		.filter((item) => component.assessmentIds.includes(item.id))
		.reduce((sum, item) => sum + item.lines.reduce((total, line) => total + line.maxPoints, 0), 0);
	return maximum
		? (100 * assessment.lines.reduce((sum, line) => sum + line.maxPoints, 0)) / maximum
		: 0;
}
export function sectionWeightLabel(
	assessment: RubricAssessment,
	results: RubricResult[],
	assessments: RubricAssessment[]
) {
	if (assessment.purpose === 'formative') return 'Formatif';
	return (
		results
			.flatMap((result) => {
				const weight = sectionWeight(assessment, result, assessments);
				return weight
					? [
							`${results.length > 1 ? result.title + ' : ' : ''}${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(weight)} %`
						]
					: [];
			})
			.join(' · ') || 'Hors résultat'
	);
}

export const finalGradeExportSchema = z
	.strictObject({
		moduleTitle: z.string().min(1).max(200),
		className: z.string().min(1).max(200),
		academicYear: z.string().min(1).max(200),
		exportedAt: z.iso.datetime(),
		sections: z.array(z.strictObject({ title: z.string(), weight: z.string() })).optional(),
		results: z.array(z.string().min(1).max(200)).min(1).max(100),
		students: z
			.array(
				z.strictObject({
					name: z.string().min(1).max(200),
					sectionMarks: z.array(z.number().finite().min(0).max(20).nullable()).optional(),
					marks: z.array(z.number().finite().min(0).max(20)).min(1).max(100)
				})
			)
			.min(1)
			.max(10000)
	})
	.superRefine((value, ctx) => {
		for (const [index, student] of value.students.entries()) {
			if (value.sections && student.sectionMarks?.length !== value.sections.length)
				ctx.addIssue({
					code: 'custom',
					path: ['students', index, 'sectionMarks'],
					message: 'Sections incomplètes.'
				});
			if (student.marks.length !== value.results.length)
				ctx.addIssue({
					code: 'custom',
					path: ['students', index, 'marks'],
					message: 'Résultats incomplets.'
				});
		}
	});
export type FinalGradeExport = z.infer<typeof finalGradeExportSchema>;

export function gradeExportStatus(grid: GradeGridData) {
	const context = grid.rubric?.contexts.find((item) => item.id === grid.contextId);
	const calculated = grid.students.map((student) => ({
		student,
		calculation: calculateStudent(
			grid.rubric?.assessments ?? [],
			grid.rubric?.results ?? [],
			student,
			context?.deadlines
		)
	}));
	const complete = calculated.filter((item) => item.calculation.complete).length;
	const reason =
		!context || !grid.rubric
			? 'Sélectionnez un module et une classe.'
			: !grid.rubric.results.length
				? 'Définissez les résultats du module dans le barème.'
				: !grid.students.length
					? 'Ajoutez les étudiants à cette classe.'
					: complete !== grid.students.length
						? 'Complétez les évaluations requises et les résultats à corriger avant l’export.'
						: '';
	return { ready: reason === '', complete, total: grid.students.length, reason, calculated };
}

// Only names and final marks may leave the grading service for the school document.
export function projectFinalGradeExport(
	grid: GradeGridData,
	exportedAt: Date
): FinalGradeExport | null {
	const status = gradeExportStatus(grid);
	const context = grid.rubric?.contexts.find((item) => item.id === grid.contextId);
	if (!status.ready || !grid.rubric || !context) return null;
	return finalGradeExportSchema.parse({
		moduleTitle: grid.rubric.module.title,
		className: context.className,
		academicYear: context.academicYear,
		exportedAt: exportedAt.toISOString(),
		sections: grid.rubric.assessments.map((assessment) => ({
			title: assessment.title,
			weight: sectionWeightLabel(assessment, grid.rubric!.results, grid.rubric!.assessments)
		})),
		results: grid.rubric.results.map((result) => result.title),
		students: status.calculated.map(({ student, calculation }) => ({
			name: student.name,
			sectionMarks: grid.rubric!.assessments.map(
				(assessment) => calculation.assessments[assessment.id].mark
			),
			marks: grid.rubric!.results.map((result) => calculation.results[result.id].mark)
		}))
	});
}
