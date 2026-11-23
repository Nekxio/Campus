import { z } from 'zod';
import {
	assessmentKindSchema,
	externalLinkSchema,
	idSchema,
	preparationSchema,
	resourceKindSchema,
	revisionSchema
} from './contracts.js';
import { moduleDraftSchema, moduleFieldsSchema } from './teaching.js';
import { importRubricSchema } from './module-import.js';
import { dossierSchema, exerciseIdsSchema, exerciseSchema, studentContentSchema } from './pedagogy.js';

// Local keys describe durable entities; titles are editable and never used to guess identity.
export const localKeySchema = z
	.string()
	.regex(/^[a-z\d][a-z\d._-]{0,99}$/i)
	.refine((key) => !['constructor', 'prototype', '__proto__'].includes(key));
const title = z.string().trim().min(1).max(200);
const assessmentKeys = z.array(localKeySchema).min(1).max(100);
const resourceKeys = z.array(localKeySchema).max(200);
const localStudentContentSchema = studentContentSchema.extend({
	dossiers: z
		.array(
			z.union([
				dossierSchema,
				z.strictObject({ assessmentKey: localKeySchema, instructions: dossierSchema.shape.instructions, resourceKeys })
			])
		)
		.max(100)
		.optional(),
	exercises: z
		.array(
			exerciseSchema
				.extend({ resourceKeys: resourceKeys.optional() })
				.refine(
					(item) => !item.resourceKeys || !item.resourceIds,
					'Use either resource keys or resource IDs for a workshop.'
				)
		)
		.max(100)
		.default([])
});
const localRule = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('points_ratio'), assessmentKeys }),
	z.strictObject({
		kind: z.literal('weighted'),
		components: z
			.array(z.strictObject({ assessmentKeys, weight: z.number().positive().max(100) }))
			.min(1)
			.max(100)
	})
]);
export const localModuleSchema = z.strictObject({
	title,
	studentContent: localStudentContentSchema.optional(),
	description: z.string().max(20000).default(''),
	objectives: z.array(title).max(100).default([]),
	preparation: preparationSchema.default({ framing: '', nextSteps: '', sourceLinks: [] }),
	resources: z
		.array(
			z.strictObject({
				key: localKeySchema,
				label: title,
				url: externalLinkSchema,
				kind: resourceKindSchema,
				driveFileId: z
					.string()
					.regex(/^[a-z\d_-]{1,200}$/i)
					.optional()
			})
		)
		.max(200)
		.default([]),
	contexts: z
		.array(
			z.strictObject({
				classId: idSchema,
				expectedRevision: revisionSchema.optional(),
				lessons: z
					.array(
						z.strictObject({
							key: localKeySchema,
							title,
							startsAt: z.iso.datetime({ offset: true }),
							endsAt: z.iso.datetime({ offset: true }),
							recap: z.string().max(10000).default(''),
							toDo: z.string().max(10000).default(''),
							exerciseIds: exerciseIdsSchema.optional()
						})
					)
					.max(200)
			})
		)
		.max(100)
		.default([]),
	rubric: z
		.strictObject({
			assessments: z
				.array(
					z.strictObject({
						key: localKeySchema,
						title,
						kind: assessmentKindSchema,
						purpose: z.enum(['graded', 'formative']),
						groups: z
							.array(z.strictObject({ key: localKeySchema, title }))
							.min(1)
							.max(100),
						lines: z
							.array(
								z.strictObject({
									key: localKeySchema,
									groupKey: localKeySchema,
									label: title,
									description: z.string().max(2000).default(''),
									maxPoints: z.int().positive().max(1000000)
								})
							)
							.min(1)
							.max(1000)
					})
				)
				.max(100),
			results: z.array(z.strictObject({ key: localKeySchema, title, rule: localRule })).max(100),
			contexts: z
				.array(
					z.strictObject({
						classId: idSchema,
						deadlines: z
							.array(
								z.strictObject({
									assessmentKey: localKeySchema,
									dueAt: z.iso.datetime({ offset: true }),
									submissionInstructions: z.string().max(10000)
								})
							)
							.max(100)
					})
				)
				.max(100)
				.default([])
		})
		.optional()
});
// Legacy updates must state every scalar field: creation defaults must never erase an existing draft.
// Targeted updates with omissions use the version-2 patch contract instead.
const legacyContext = localModuleSchema.shape.contexts.removeDefault().element;
const legacyLesson = legacyContext.shape.lessons.element;
export const localModuleUpdateSchema = localModuleSchema.extend({
	description: localModuleSchema.shape.description.removeDefault(),
	objectives: localModuleSchema.shape.objectives.removeDefault(),
	preparation: preparationSchema.extend({
		framing: preparationSchema.shape.framing.removeDefault(),
		nextSteps: preparationSchema.shape.nextSteps.removeDefault(),
		sourceLinks: preparationSchema.shape.sourceLinks.removeDefault()
	}),
	resources: localModuleSchema.shape.resources.removeDefault(),
	contexts: z
		.array(
			legacyContext.extend({
				lessons: z
					.array(
						legacyLesson.extend({
							recap: legacyLesson.shape.recap.removeDefault(),
							toDo: legacyLesson.shape.toDo.removeDefault()
						})
					)
					.max(200)
			})
		)
		.max(100)
});
export type LocalModule = z.infer<typeof localModuleSchema>;
const identityMap = z.record(z.string().max(300), idSchema).refine((map) => Object.keys(map).length <= 20000);
export const folderBindingSchema = z.strictObject({
	version: z.literal(1),
	origin: z.url(),
	moduleId: idSchema,
	linked: z.boolean(),
	revision: revisionSchema.optional(),
	ids: z.strictObject({
		resources: identityMap,
		contexts: identityMap,
		lessons: identityMap,
		assessments: identityMap,
		groups: identityMap,
		lines: identityMap,
		results: identityMap
	}),
	driveFiles: z.record(localKeySchema, z.string().regex(/^[a-z\d_-]{1,200}$/i)),
	lastOperation: z
		.strictObject({
			action: z.enum(['create', 'update']),
			requestId: idSchema,
			fingerprint: z.string().regex(/^[a-f\d]{64}$/)
		})
		.optional()
});
export type FolderBinding = z.infer<typeof folderBindingSchema>;
export function newFolderBinding(origin: string): FolderBinding {
	return {
		version: 1,
		origin,
		moduleId: crypto.randomUUID(),
		linked: false,
		ids: {
			resources: {},
			contexts: {},
			lessons: {},
			assessments: {},
			groups: {},
			lines: {},
			results: {}
		},
		driveFiles: {}
	};
}
export function resolveLocalModule(
	value: LocalModule,
	binding: FolderBinding,
	folder: string,
	action: 'create' | 'update' = 'create'
) {
	const draft = localModuleSchema.parse(value);
	const identity = (type: keyof FolderBinding['ids'], key: string) => {
		if (!Object.hasOwn(binding.ids[type], key)) binding.ids[type][key] = crypto.randomUUID();
		return binding.ids[type][key];
	};
	const declared = {
		resources: new Set(draft.resources.map((item) => item.key)),
		assessments: new Set(draft.rubric?.assessments.map((item) => item.key))
	};
	const reference = (type: keyof typeof declared, key: string) => {
		if (!declared[type].has(key) && !Object.hasOwn(binding.ids[type], key)) {
			throw new Error('Course material must use a declared or bound ' + type + ' key.');
		}
		return identity(type, key);
	};
	const content = draft.studentContent;
	const converted = (action === 'update' ? moduleFieldsSchema : moduleDraftSchema).parse({
		title: draft.title,
		description: draft.description,
		objectives: draft.objectives,
		preparation: draft.preparation,
		studentContent: content && {
			...content,
			dossiers: content.dossiers?.map((item) => {
				if ('assessmentId' in item) return item;
				return {
					assessmentId: reference('assessments', item.assessmentKey),
					instructions: item.instructions,
					resourceIds: item.resourceKeys.map((key) => reference('resources', key))
				};
			}),
			exercises: content.exercises.map(({ resourceKeys, ...exercise }) => ({
				...exercise,
				resourceIds: resourceKeys?.map((key) => reference('resources', key)) ?? exercise.resourceIds
			}))
		},
		sourcePath: folder,
		resources: draft.resources.map(({ key, driveFileId, ...resource }) => {
			if (driveFileId) binding.driveFiles[key] = driveFileId;
			return { ...resource, id: identity('resources', key) };
		}),
		contexts: draft.contexts.map(({ classId, expectedRevision, lessons }) => ({
			id: identity('contexts', classId),
			classId,
			expectedRevision,
			lessons: lessons.map(({ key, ...lesson }) => ({
				...lesson,
				id: identity('lessons', classId + '/' + key)
			}))
		}))
	});
	const rubric = draft.rubric
		? importRubricSchema.parse({
				assessments: draft.rubric.assessments.map(({ key, groups, lines, ...a }) => ({
					...a,
					id: identity('assessments', key),
					groups: groups.map(({ key: g, title }) => ({
						id: identity('groups', key + '/' + g),
						title
					})),
					lines: lines.map(({ key: l, groupKey, ...line }) => ({
						...line,
						id: identity('lines', key + '/' + l),
						groupId: identity('groups', key + '/' + groupKey)
					}))
				})),
				results: draft.rubric.results.map(({ key, title, rule }) => ({
					id: identity('results', key),
					title,
					rule:
						rule.kind === 'points_ratio'
							? {
									kind: rule.kind,
									assessmentIds: rule.assessmentKeys.map((a) => identity('assessments', a))
								}
							: {
									kind: rule.kind,
									components: rule.components.map(({ assessmentKeys, weight }) => ({
										weight,
										assessmentIds: assessmentKeys.map((a) => identity('assessments', a))
									}))
								}
				})),
				contexts: draft.rubric.contexts.map(({ classId, deadlines }) => ({
					id: identity('contexts', classId),
					deadlines: deadlines.map(({ assessmentKey, ...deadline }) => ({
						...deadline,
						assessmentId: identity('assessments', assessmentKey)
					}))
				}))
			})
		: undefined;
	return { draft: converted, rubric };
}
