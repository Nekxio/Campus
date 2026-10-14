import { z } from 'zod';
import type { GradeGridData } from './grading.js';
import { calculateStudent } from './grade-calculation.js';

export const finalGradeExportSchema = z
	.strictObject({
		moduleTitle: z.string().min(1).max(200),
		className: z.string().min(1).max(200),
		academicYear: z.string().min(1).max(200),
		exportedAt: z.iso.datetime(),
		results: z.array(z.string().min(1).max(200)).min(1).max(100),
		students: z
			.array(
				z.strictObject({
					name: z.string().min(1).max(200),
					marks: z.array(z.number().finite().min(0).max(20)).min(1).max(100)
				})
			)
			.min(1)
			.max(10000)
	})
	.superRefine((value, ctx) => {
		for (const [index, student] of value.students.entries()) {
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
		results: grid.rubric.results.map((result) => result.title),
		students: status.calculated.map(({ student, calculation }) => ({
			name: student.name,
			marks: grid.rubric!.results.map((result) => calculation.results[result.id].mark)
		}))
	});
}
