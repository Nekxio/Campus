import { z } from 'zod';
import { academicYearSchema, idSchema, modulePublicationSchema } from './contracts.js';
import { emptyStudentContent, studentContentSchema } from './pedagogy.js';

const label = z.string().trim().min(1).max(200);
export const publicationSnapshotSchema = z.strictObject({
	...modulePublicationSchema.shape,
	version: z.literal(2),
	className: label,
	academicYear: academicYearSchema,
	objectives: z.array(label).max(100),
	studentContent: studentContentSchema.default(emptyStudentContent),
	rubric: z
		.array(
			z.strictObject({
				title: label,
				kind: z.enum(['quiz', 'project', 'oral', 'other']),
				groups: z.array(
					z.strictObject({
						title: label,
						lines: z.array(
							z.strictObject({
								label,
								description: z.string().max(2000),
								maxPoints: z.int().positive()
							})
						)
					})
				)
			})
		)
		.default([]),
	lessonNotes: z
		.array(
			z.strictObject({
				id: idSchema,
				label,
				startsAt: z.iso.datetime({ offset: true }),
				recap: z.string().max(10000),
				toDo: z.string().max(10000)
			})
		)
		.max(200)
});
export type PublicationSnapshot = z.infer<typeof publicationSnapshotSchema>;

export const publicationDecisionSchema = z.strictObject({
	requestId: idSchema,
	contextId: idSchema,
	action: z.enum(['publish', 'unpublish']),
	expectedRevision: z.int().nonnegative(),
	moduleRevision: z.int().positive(),
	contextRevision: z.int().positive(),
	classRevision: z.int().nonnegative(),
	confirm: z.literal(true)
});
export type PublicationDecision = z.infer<typeof publicationDecisionSchema>;
export const publicationReceiptSchema = z.strictObject({
	requestId: idSchema,
	contextId: idSchema,
	revision: z.int().positive(),
	publicPath: z.string(),
	publishedAt: z.iso.datetime({ offset: true }),
	unpublishedAt: z.iso.datetime({ offset: true }).nullable()
});
export type PublicationReceipt = z.infer<typeof publicationReceiptSchema>;

export const publicationContextSchema = z.strictObject({
	id: idSchema,
	classId: idSchema.nullable(),
	className: label,
	academicYear: academicYearSchema,
	archived: z.boolean()
});
export type PublicationContext = z.infer<typeof publicationContextSchema>;

const publicationPathSchema = (prefix: '/modules/' | '/classes/') =>
	z.string().refine((path) => path.startsWith(prefix) && idSchema.safeParse(path.slice(prefix.length)).success);

export const publicationSelectionSchema = z.strictObject({
	context: publicationContextSchema,
	moduleRevision: z.int().positive(),
	contextRevision: z.int().positive(),
	classRevision: z.int().nonnegative(),
	publicationRevision: z.int().nonnegative(),
	draft: publicationSnapshotSchema.nullable(),
	published: publicationSnapshotSchema.nullable(),
	status: z.enum(['draft', 'published', 'unpublished', 'legacy']),
	publishedAt: z.iso.datetime({ offset: true }).nullable(),
	unpublishedAt: z.iso.datetime({ offset: true }).nullable(),
	changed: z.boolean(),
	// Public identities can outlive the annual context and class that first created them.
	publicPath: publicationPathSchema('/modules/'),
	classPath: publicationPathSchema('/classes/').nullable()
});
export type PublicationSelection = z.infer<typeof publicationSelectionSchema>;
export const publicationReviewDataSchema = z
	.strictObject({
		module: z.strictObject({ id: idSchema, title: label }),
		contexts: z.array(publicationContextSchema),
		selected: publicationSelectionSchema.nullable()
	})
	.superRefine((review, ctx) => {
		if (new Set(review.contexts.map((context) => context.id)).size !== review.contexts.length)
			ctx.addIssue({
				code: 'custom',
				path: ['contexts'],
				message: 'Duplicate publication context.'
			});
		if (!review.selected) {
			if (review.contexts.length)
				ctx.addIssue({
					code: 'custom',
					path: ['selected'],
					message: 'Missing publication selection.'
				});
			return;
		}
		const selected = review.selected.context;
		const context = review.contexts.find((context) => context.id === selected.id);
		if (
			!context ||
			Object.keys(publicationContextSchema.shape).some(
				(key) => context[key as keyof PublicationContext] !== selected[key as keyof PublicationContext]
			)
		)
			ctx.addIssue({
				code: 'custom',
				path: ['selected', 'context'],
				message: 'Publication context mismatch.'
			});
	});
export type PublicationReviewData = z.infer<typeof publicationReviewDataSchema>;
export type PublicModuleData = {
	contextId: string;
	snapshot: PublicationSnapshot;
	publishedAt: string;
	classPath: string | null;
};
export type PublicClassData = {
	classId: string;
	className: string;
	academicYear: string;
	modules: {
		contextId: string;
		title: string;
		description: string;
		publicPath: string;
		publishedAt: string;
	}[];
};

export const publicModulePath = (contextId: string) => `/modules/${contextId}`;
export const publicClassPath = (classId: string) => `/classes/${classId}`;

export const publicationSections = [
	{ id: 'supports', label: 'Supports du cours' },
	{ id: 'consignes', label: 'Consignes et barèmes' },
	{ id: 'remise', label: 'Échéances et remise' },
	{ id: 'ressources', label: 'Ressources utiles' },
	{ id: 'suivi', label: 'Vu en cours / à faire' }
] as const;
