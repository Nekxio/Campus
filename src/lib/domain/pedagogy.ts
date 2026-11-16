import { z } from 'zod';
import { idSchema } from './contracts.js';

export const exerciseSchema = z.strictObject({
	id: idSchema,
	title: z.string().trim().min(1).max(200),
	instructions: z.string().max(20000),
	solution: z.string().max(20000),
	code: z.string().max(20000).default('')
});
export const studentContentSchema = z.strictObject({
	instructions: z.string().max(20000).default(''),
	projectInstructions: z.string().max(20000).default(''),
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
