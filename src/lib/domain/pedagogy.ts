import { z } from 'zod';
import { idSchema } from './contracts.js';

const distinctIds = (maximum: number) =>
	z
		.array(idSchema)
		.max(maximum)
		.refine((ids) => new Set(ids).size === ids.length, 'Retirez les références en double.');
export const exerciseIdsSchema = distinctIds(100);
const resourceIdsSchema = distinctIds(200);
export const dossierSchema = z.strictObject({
	assessmentId: idSchema,
	instructions: z.string().max(20000),
	resourceIds: resourceIdsSchema
});
export const exerciseSchema = z.strictObject({
	id: idSchema,
	title: z.string().trim().min(1).max(200),
	instructions: z.string().max(20000),
	solution: z.string().max(20000),
	code: z.string().max(20000).default(''),
	semester: z.enum(['S1', 'S2']).nullish(),
	resourceIds: resourceIdsSchema.optional()
});
export const studentContentSchema = z.strictObject({
	instructions: z.string().max(20000).default(''),
	projectInstructions: z.string().max(20000).default(''),
	dossiers: z
		.array(dossierSchema)
		.max(100)
		.refine(
			(dossiers) => new Set(dossiers.map((dossier) => dossier.assessmentId)).size === dossiers.length,
			'Rattachez chaque dossier à une évaluation différente.'
		)
		.optional(),
	exercises: z
		.array(exerciseSchema)
		.max(100)
		.refine(
			(exercises) => new Set(exercises.map((exercise) => exercise.id)).size === exercises.length,
			'Chaque exercice doit avoir une identité distincte.'
		)
		.default([])
});
export type StudentContent = z.infer<typeof studentContentSchema>;
export const emptyStudentContent = (): StudentContent => ({
	instructions: '',
	projectInstructions: '',
	exercises: []
});

export const checkResourceReferences = (content: StudentContent, resources: { id: string }[], ctx: z.RefinementCtx) => {
	const ids = new Set(resources.map((resource) => resource.id));
	for (const key of ['dossiers', 'exercises'] as const) {
		for (const [index, item] of (content[key] ?? []).entries()) {
			if (item.resourceIds?.some((id) => !ids.has(id))) {
				ctx.addIssue({
					code: 'custom',
					path: ['studentContent', key, index, 'resourceIds'],
					message: 'Choisissez un lien étudiant de ce module.'
				});
			}
		}
	}
};

export const checkLessonExercises = (
	content: StudentContent,
	lessons: { exerciseIds?: string[] }[],
	path: (string | number)[],
	ctx: z.RefinementCtx
) => {
	const available = new Set(content.exercises.map((exercise) => exercise.id));
	const assigned = new Set<string>();
	for (const [index, lesson] of lessons.entries()) {
		for (const id of lesson.exerciseIds ?? []) {
			if (!available.has(id) || assigned.has(id)) {
				ctx.addIssue({
					code: 'custom',
					path: [...path, index, 'exerciseIds'],
					message: 'Choisissez une activité de ce module rattachée à une seule séance.'
				});
			}
			assigned.add(id);
		}
	}
};
