import { z } from 'zod';
import { idSchema, preparationSchema, resourceSchema, revisionSchema } from './contracts.js';
import { moduleDraftSchema } from './teaching.js';
import { rubricDraftSchema, rubricAssessmentSchema } from './grading.js';
import { dossierSchema, exerciseSchema, studentContentSchema } from './pedagogy.js';

const lesson = moduleDraftSchema.shape.contexts.element.shape.lessons.element;
export const modulePatchSchema = z.strictObject({
	title: moduleDraftSchema.shape.title.optional(),
	description: moduleDraftSchema.shape.description.optional(),
	objectives: moduleDraftSchema.shape.objectives.optional(),
	sourcePath: moduleDraftSchema.shape.sourcePath.optional(),
	preparation: z
		.strictObject({
			framing: preparationSchema.shape.framing.removeDefault().optional(),
			nextSteps: preparationSchema.shape.nextSteps.removeDefault().optional(),
			sourceLinks: preparationSchema.shape.sourceLinks.removeDefault().optional()
		})
		.optional(),
	studentContent: z
		.strictObject({
			instructions: studentContentSchema.shape.instructions.removeDefault().optional(),
			projectInstructions: studentContentSchema.shape.projectInstructions.removeDefault().optional(),
			dossiers: z
				.array(dossierSchema.partial().required({ assessmentId: true }))
				.max(100)
				.refine(
					(items) => new Set(items.map((item) => item.assessmentId)).size === items.length,
					'Une évaluation ne peut être modifiée qu’une fois.'
				)
				.optional(),
			exercises: z
				.array(
					exerciseSchema.extend({ code: exerciseSchema.shape.code.removeDefault() }).partial().required({ id: true })
				)
				.max(100)
				.optional()
		})
		.optional(),
	resources: z
		.array(resourceSchema.partial().required({ id: true }))
		.max(200)
		.optional(),
	contexts: z
		.array(
			z.strictObject({
				id: idSchema,
				classId: idSchema.optional(),
				expectedRevision: revisionSchema.optional(),
				lessons: z
					.array(
						z
							.strictObject({
								...lesson.shape,
								recap: lesson.shape.recap.removeDefault(),
								toDo: lesson.shape.toDo.removeDefault()
							})
							.partial()
							.required({ id: true })
					)
					.max(200)
					.optional()
			})
		)
		.max(1)
		.optional()
});
export const rubricPatchSchema = z.strictObject({
	assessments: z
		.array(
			z.strictObject({
				id: idSchema,
				title: rubricAssessmentSchema.shape.title.optional(),
				kind: rubricAssessmentSchema.shape.kind.optional(),
				purpose: rubricAssessmentSchema.shape.purpose.optional(),
				groups: z.array(rubricAssessmentSchema.shape.groups.element.partial().required({ id: true })).optional(),
				lines: z.array(rubricAssessmentSchema.shape.lines.element.partial().required({ id: true })).optional()
			})
		)
		.optional(),
	results: z.array(rubricDraftSchema.shape.results.element.partial().required({ id: true })).optional(),
	contexts: z
		.array(
			z.strictObject({
				id: idSchema,
				deadlines: rubricDraftSchema.shape.contexts.element.shape.deadlines.optional()
			})
		)
		.optional()
});
export const explicitRemovalSchema = z.strictObject({
	resources: z.array(idSchema).optional(),
	lessons: z.array(idSchema).optional(),
	exercises: z.array(idSchema).optional(),
	dossiers: z.array(idSchema).optional(),
	assessments: z.array(idSchema).optional(),
	groups: z.array(idSchema).optional(),
	lines: z.array(idSchema).optional(),
	results: z.array(idSchema).optional(),
	deadlineAssessments: z.array(idSchema).optional()
});
export const patchModuleImportSchema = z
	.strictObject({
		version: z.literal(2),
		requestId: idSchema,
		moduleId: idSchema,
		expectedRevision: revisionSchema,
		patch: modulePatchSchema,
		rubric: rubricPatchSchema.optional(),
		remove: explicitRemovalSchema.optional()
	})
	.superRefine((input, ctx) => {
		function inspect(value: unknown, path: (string | number)[]) {
			if (!value || typeof value !== 'object') return;
			if (Array.isArray(value)) {
				const ids = value.flatMap((item: unknown) =>
					item && typeof item === 'object' && 'id' in item ? [item.id] : []
				);
				if (ids.length !== new Set(ids).size)
					ctx.addIssue({
						code: 'custom',
						path,
						message: 'Une identité ne peut être modifiée qu’une fois.'
					});
				value.forEach((item, index) => inspect(item, [...path, index]));
			} else {
				for (const [key, child] of Object.entries(value)) inspect(child, [...path, key]);
			}
		}
		inspect(input.patch, ['patch']);
		inspect(input.rubric, ['rubric']);
		for (const [key, ids] of Object.entries(input.remove ?? {})) {
			if (ids && new Set(ids).size !== ids.length)
				ctx.addIssue({
					code: 'custom',
					path: ['remove', key],
					message: 'Retirez les identités en double.'
				});
		}
	});
export type ModulePatchImport = z.infer<typeof patchModuleImportSchema>;

// Arrays are keyed collections: omission preserves an element and only an explicit ID removes it.
export const mergeByKey = <Key extends string, T extends Record<Key, string>, Change extends Record<Key, string>>(
	key: Key,
	base: T[],
	changes: Change[] = [],
	remove: string[] = []
): (T | Change)[] => {
	const changesById = new Map<string, Change>(changes.map((item) => [item[key], item]));
	const existingIds = new Set<string>(base.map((item) => item[key]));
	return [
		...base
			.filter((item) => !remove.includes(item[key]))
			.map((item) => {
				const change = changesById.get(item[key]);
				return change ? { ...item, ...change } : item;
			}),
		...changes.filter((item) => !existingIds.has(item[key]))
	];
};
export const mergeIdentified = <T extends { id: string }, Change extends { id: string }>(
	base: T[],
	changes: Change[] = [],
	remove: string[] = []
) => mergeByKey('id', base, changes, remove);
