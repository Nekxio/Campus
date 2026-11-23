import { z } from 'zod';
import {
	studentContentSchema,
	emptyStudentContent,
	exerciseIdsSchema,
	checkResourceReferences,
	checkLessonExercises
} from './pedagogy.js';
import { academicYearSchema, idSchema, revisionSchema, preparationSchema, resourceSchema } from './contracts.js';

export const studentNameSchema = z
	.string()
	.trim()
	.transform((value) => value.normalize('NFC').replace(/\s+/g, ' '))
	.pipe(z.string().min(1, 'Renseignez un nom.').max(200, 'Limitez le nom à 200 caractères.'));
export const classInputSchema = z.strictObject({
	name: studentNameSchema,
	academicYear: academicYearSchema
});
export const classUpdateSchema = classInputSchema.extend({ expectedRevision: revisionSchema });
export const rosterInputSchema = z.discriminatedUnion('kind', [
	z.strictObject({
		kind: z.literal('add'),
		name: studentNameSchema,
		expectedRevision: revisionSchema
	}),
	z.strictObject({
		kind: z.literal('import'),
		source: z.string().min(1).max(200000),
		expectedRevision: revisionSchema
	})
]);
export const studentUpdateSchema = z.strictObject({
	name: studentNameSchema,
	expectedRevision: revisionSchema,
	classRevision: revisionSchema
});
export const studentDeleteSchema = z.strictObject({
	expectedRevision: revisionSchema,
	classRevision: revisionSchema,
	confirm: z.literal(true)
});
export const attachModuleSchema = z.strictObject({
	moduleId: idSchema,
	moduleRevision: revisionSchema,
	expectedRevision: revisionSchema
});
const lessonSchema = z
	.strictObject({
		id: idSchema,
		title: studentNameSchema,
		startsAt: z.iso.datetime({ offset: true }),
		endsAt: z.iso.datetime({ offset: true }),
		recap: z.string().max(10000).default(''),
		toDo: z.string().max(10000).default(''),
		exerciseIds: exerciseIdsSchema.optional()
	})
	.refine((lesson) => Date.parse(lesson.endsAt) > Date.parse(lesson.startsAt), {
		message: 'La fin doit suivre le début.',
		path: ['endsAt']
	});
const contextSchema = z.strictObject({
	id: idSchema,
	classId: idSchema,
	expectedRevision: revisionSchema.optional(),
	lessons: z.array(lessonSchema).max(200)
});
const moduleFields = z.strictObject({
	title: studentNameSchema,
	description: z.string().max(20000),
	objectives: z.array(studentNameSchema).max(100),
	sourcePath: z.string().trim().max(2000),
	preparation: preparationSchema,
	studentContent: studentContentSchema.default(emptyStudentContent),
	resources: z.array(resourceSchema).max(200),
	contexts: z.array(contextSchema).max(100)
});
const checkModuleIdentities = (
	value: Pick<z.infer<typeof moduleFields>, 'contexts' | 'resources'>,
	ctx: z.RefinementCtx
) => {
	for (const [key, ids] of [
		['resources', value.resources.map((v) => v.id)],
		['contexts', value.contexts.map((v) => v.id)],
		['contexts', value.contexts.map((v) => v.classId)],
		['contexts', value.contexts.flatMap((v) => v.lessons.map((l) => l.id))]
	] as const) {
		if (new Set(ids).size !== ids.length)
			ctx.addIssue({ code: 'custom', path: [key], message: 'Retirez les doublons.' });
	}
};
export const moduleFieldsSchema = moduleFields.superRefine(checkModuleIdentities);
export const moduleDraftSchema = moduleFieldsSchema.superRefine((value, ctx) => {
	checkResourceReferences(value.studentContent, value.resources, ctx);
	for (const [index, context] of value.contexts.entries()) {
		checkLessonExercises(value.studentContent, context.lessons, ['contexts', index, 'lessons'], ctx);
	}
});
// Older full-form clients can omit associations; their merged references are validated in the write transaction.
export const moduleUpdateSchema = moduleFields
	.extend({
		studentContent: studentContentSchema.optional(),
		expectedRevision: revisionSchema
	})
	.superRefine(checkModuleIdentities);
// Saved contexts carry their own optimistic revision; new draft contexts may omit it.
export const moduleDetailSchema = moduleDraftSchema.safeExtend({
	id: idSchema,
	revision: revisionSchema,
	needsReview: z.boolean().optional(),
	agentChanges: z.array(z.string()).optional(),
	paused: z.boolean().optional(),
	contexts: z.array(contextSchema.extend({ expectedRevision: revisionSchema })).max(100)
});
export function validationFields(error: z.ZodError) {
	const fields: Record<string, string> = {};
	for (const issue of error.issues) {
		const key = issue.path.join('.');
		fields[key] ??= issue.code === 'custom' ? issue.message : 'Vérifiez ce champ et ses limites.';
	}
	return fields;
}
