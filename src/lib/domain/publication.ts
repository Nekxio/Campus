import { z } from 'zod';
import { academicYearSchema, idSchema, modulePublicationSchema } from './contracts.js';

const label = z.string().trim().min(1).max(200);
export const publicationSnapshotSchema = z.strictObject({
	...modulePublicationSchema.shape,
	version: z.literal(2),
	className: label,
	academicYear: academicYearSchema,
	objectives: z.array(label).max(100),
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

export type PublicationContext = {
	id: string;
	classId: string | null;
	className: string;
	academicYear: string;
	archived: boolean;
};
export type PublicationSelection = {
	context: PublicationContext;
	moduleRevision: number;
	contextRevision: number;
	classRevision: number;
	publicationRevision: number;
	draft: PublicationSnapshot | null;
	published: PublicationSnapshot | null;
	status: 'draft' | 'published' | 'unpublished' | 'legacy';
	publishedAt: string | null;
	unpublishedAt: string | null;
	changed: boolean;
	publicPath: string;
	classPath: string | null;
};
export type PublicationReviewData = {
	module: { id: string; title: string };
	contexts: PublicationContext[];
	selected: PublicationSelection | null;
};
export type PublicModuleData = {
	contextId: string;
	snapshot: PublicationSnapshot;
	publishedAt: string;
	classPath: string | null;
};
export type PublicClassData = {
	classId: string;
	className: string | null;
	academicYear: string | null;
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
