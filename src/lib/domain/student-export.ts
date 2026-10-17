import { z } from 'zod';
import type { GradeGridData } from './grading.js';
import { assessmentStatusSchema } from './contracts.js';
import { calculateStudent } from './grade-calculation.js';
import { sectionWeight, sectionWeightLabel } from './grade-export.js';

const mark = z.number().finite().min(0).max(20).nullable();
export const studentGradeExportSchema = z.strictObject({
	moduleTitle: z.string(),
	className: z.string(),
	academicYear: z.string(),
	name: z.string(),
	sections: z.array(
		z.strictObject({
			title: z.string(),
			kind: z.enum(['quiz', 'project', 'oral', 'other']),
			status: assessmentStatusSchema,
			state: z.enum(['ready', 'pending', 'invalid']),
			mark,
			rawMark: mark,
			penalty: z.number().nonnegative(),
			latenessDays: z.int().nonnegative(),
			latenessDecision: z.enum(['automatic', 'exempt', 'refused']),
			weight: z.string(),
			groups: z.array(
				z.strictObject({
					title: z.string(),
					lines: z.array(
						z.strictObject({
							label: z.string(),
							points: z.int().nonnegative().nullable(),
							maximum: z.int().positive()
						})
					)
				})
			),
			contributions: z.array(
				z.strictObject({ title: z.string(), weight: z.number().nonnegative(), mark })
			)
		})
	),
	results: z
		.array(z.strictObject({ title: z.string(), mark: z.number().finite().min(0).max(20) }))
		.min(1)
});
export type StudentGradeExport = z.infer<typeof studentGradeExportSchema>;
export function projectStudentGradeExport(
	grid: GradeGridData,
	studentId: string
): StudentGradeExport | null {
	const rubric = grid.rubric;
	const context = rubric?.contexts.find((item) => item.id === grid.contextId);
	const student = grid.students.find((item) => item.id === studentId);
	if (!rubric || !context || !student) return null;
	const calculated = calculateStudent(
		rubric.assessments,
		rubric.results,
		student,
		context.deadlines
	);
	if (!calculated.complete) return null;
	return studentGradeExportSchema.parse({
		moduleTitle: rubric.module.title,
		className: context.className,
		academicYear: context.academicYear,
		name: student.name,
		sections: rubric.assessments.map((assessment) => {
			const correction = student.corrections.find((item) => item.assessmentId === assessment.id);
			const grade = calculated.assessments[assessment.id];
			return {
				title: assessment.title,
				kind: assessment.kind,
				status: correction?.status ?? 'to_evaluate',
				state: grade.state,
				mark: grade.mark,
				rawMark: grade.rawMark,
				penalty: grade.penalty,
				latenessDays: grade.latenessDays,
				latenessDecision: correction?.latenessDecision ?? 'automatic',
				weight: sectionWeightLabel(assessment, rubric.results, rubric.assessments),
				groups: assessment.groups.map((group) => ({
					title: group.title,
					lines: assessment.lines
						.filter((line) => line.groupId === group.id)
						.map((line) => ({
							label: line.label,
							points: correction?.scores.find((score) => score.lineId === line.id)?.points ?? null,
							maximum: line.maxPoints
						}))
				})),
				contributions: rubric.results.flatMap((result) => {
					const weight = sectionWeight(assessment, result, rubric.assessments);
					return weight
						? [
								{
									title: result.title,
									weight,
									mark: grade.mark === null ? null : (grade.mark * weight) / 100
								}
							]
						: [];
				})
			};
		}),
		results: rubric.results.map((result) => ({
			title: result.title,
			mark: calculated.results[result.id].mark
		}))
	});
}
