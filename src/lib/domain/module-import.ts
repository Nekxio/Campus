import { z } from 'zod';
import { idSchema, revisionSchema, preparationSchema } from './contracts.js';
import { moduleDraftSchema, moduleDetailSchema } from './teaching.js';
import { rubricDraftSchema } from './grading.js';
import { studentContentSchema } from './pedagogy.js';

export const agentActions = ['read', 'create', 'update', 'rubric'] as const;
export type AgentAction = (typeof agentActions)[number];
export const agentConfigId = 'coursely-module-drafts';
export const agentPermissions = { 'module-drafts': [...agentActions] };

export const importRubricSchema = z
	.strictObject({
		assessments: rubricDraftSchema.shape.assessments,
		results: rubricDraftSchema.shape.results,
		contexts: z
			.array(
				z.strictObject({
					id: idSchema,
					deadlines: rubricDraftSchema.shape.contexts.element.shape.deadlines
				})
			)
			.max(100)
			.default([])
	})
	.superRefine((value, ctx) => {
		const checked = rubricDraftSchema.safeParse({
			...value,
			contexts: value.contexts.map((c) => ({ ...c, expectedRevision: 1 }))
		});
		if (!checked.success)
			for (const issue of checked.error.issues)
				ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
	});
const importFields = {
	version: z.literal(1),
	requestId: idSchema,
	moduleId: idSchema,
	draft: moduleDraftSchema,
	rubric: importRubricSchema.optional()
};
function validateContexts(
	value: { draft: { contexts: { id: string }[] }; rubric?: z.infer<typeof importRubricSchema> },
	ctx: z.RefinementCtx
) {
	if (value.rubric?.contexts.some((c) => !value.draft.contexts.some((d) => d.id === c.id)))
		ctx.addIssue({
			code: 'custom',
			path: ['rubric', 'contexts'],
			message: 'Les échéances doivent appartenir aux classes de ce brouillon.'
		});
}
export const createModuleImportSchema = z.strictObject(importFields).superRefine((value, ctx) => {
	validateContexts(value, ctx);
	if (value.draft.contexts.some((c) => c.expectedRevision !== undefined))
		ctx.addIssue({
			code: 'custom',
			path: ['draft', 'contexts'],
			message: 'Un nouveau module ne peut reprendre un contexte existant.'
		});
});
const legacyContext = moduleDraftSchema.shape.contexts.element;
const legacyLesson = legacyContext.shape.lessons.element;
export const updateModuleImportSchema = z
	.strictObject({
		...importFields,
		draft: z
			.strictObject({
				...moduleDraftSchema.shape,
				studentContent: studentContentSchema.optional(),
				contexts: z
					.array(
						legacyContext.extend({
							lessons: z
								.array(
									legacyLesson.safeExtend({
										recap: legacyLesson.shape.recap.removeDefault(),
										toDo: legacyLesson.shape.toDo.removeDefault()
									})
								)
								.max(200)
						})
					)
					.max(100),
				preparation: preparationSchema.extend({
					framing: preparationSchema.shape.framing.removeDefault(),
					nextSteps: preparationSchema.shape.nextSteps.removeDefault(),
					sourceLinks: preparationSchema.shape.sourceLinks.removeDefault()
				})
			})
			.superRefine((draft, ctx) => {
				const checked = moduleDraftSchema.safeParse(draft);
				if (!checked.success)
					for (const issue of checked.error.issues)
						ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
			}),
		expectedRevision: revisionSchema,
		confirmRubricReplacement: z.boolean().default(false)
	})
	.superRefine((value, ctx) => {
		validateContexts(value, ctx);
		if (value.rubric && !value.confirmRubricReplacement)
			ctx.addIssue({
				code: 'custom',
				path: ['confirmRubricReplacement'],
				message: 'Indiquez explicitement le remplacement du barème.'
			});
	});
export type ModuleImport =
	z.infer<typeof createModuleImportSchema> | z.infer<typeof updateModuleImportSchema>;
export const importReceiptSchema = z.strictObject({
	version: z.literal(1),
	requestId: idSchema,
	action: z.enum(['create', 'update']),
	moduleId: idSchema,
	revision: revisionSchema,
	contextRevisions: z.array(z.strictObject({ id: idSchema, revision: revisionSchema })),
	rubricImported: z.boolean(),
	editorPath: z.string().regex(/^\/enseignant\/modules\/[a-f\d-]+$/i)
});
export type ImportReceipt = z.infer<typeof importReceiptSchema>;
export const importContextSchema = z.strictObject({
	version: z.literal(1),
	modules: z.array(z.strictObject({ id: idSchema, title: z.string(), revision: revisionSchema })),
	classes: z.array(
		z.strictObject({
			id: idSchema,
			name: z.string(),
			academicYear: z.string(),
			revision: revisionSchema
		})
	),
	module: moduleDetailSchema.nullable(),
	rubric: z
		.strictObject({
			assessments: rubricDraftSchema.shape.assessments,
			results: rubricDraftSchema.shape.results,
			contexts: z.array(
				rubricDraftSchema.shape.contexts.element.extend({
					className: z.string(),
					academicYear: z.string()
				})
			)
		})
		.nullable()
});
export type ImportContext = z.infer<typeof importContextSchema>;

// A canonical fingerprint survives object-key order changes and retry serialization.
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
	if (value !== null && typeof value === 'object')
		return (
			'{' +
			Object.entries(value)
				.filter(([, v]) => v !== undefined)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v))
				.join(',') +
			'}'
		);
	return JSON.stringify(value);
}
export async function importFingerprint(value: unknown) {
	const bytes = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(canonicalJson(value))
	);
	return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}
