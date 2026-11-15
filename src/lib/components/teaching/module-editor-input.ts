import { z } from 'zod';
import { emptyStudentContent, studentContentSchema } from '#lib/domain/pedagogy.js';
import { moduleDraftSchema, validationFields } from '#lib/domain/teaching.js';
import { fromDateInput, toDateInput } from '#lib/teaching/calendar.js';
import type { ModuleDetail, ModuleDraft } from '#lib/teaching/types.js';
export type ModuleEditorInput = Omit<ModuleDraft, 'objectives' | 'preparation' | 'studentContent'> & {
	studentContent: import('#lib/domain/pedagogy.js').StudentContent;
	objectives: string;
	addClassId: string;
	preparation: {
		framing: string;
		nextSteps: string;
		sourceLinks: { id: string; label: string; url: string }[];
	};
};

type SavedModuleDates = Record<string, Record<'startsAt' | 'endsAt', { local: string; instant: string }>>;

export const savedModuleDates = (module: ModuleDetail | null): SavedModuleDates =>
	Object.fromEntries(
		(module?.contexts ?? []).flatMap((context) =>
			context.lessons.map((lesson) => [
				lesson.id,
				{
					startsAt: { local: toDateInput(lesson.startsAt), instant: lesson.startsAt },
					endsAt: { local: toDateInput(lesson.endsAt), instant: lesson.endsAt }
				}
			])
		)
	);

export const toModuleEditorInput = (module: ModuleDetail | null, originClassId = ''): ModuleEditorInput => ({
	title: module?.title ?? '',
	description: module?.description ?? '',
	objectives: module?.objectives.join('\n') ?? '',
	sourcePath: module?.sourcePath ?? '',
	studentContent: structuredClone(module?.studentContent ?? emptyStudentContent()),
	addClassId: module ? '' : originClassId,
	preparation: {
		framing: module?.preparation.framing ?? '',
		nextSteps: module?.preparation.nextSteps ?? '',
		sourceLinks: (module?.preparation.sourceLinks ?? []).map((link, index) => ({
			...link,
			id: `private-source-${index}`
		}))
	},
	resources: (module?.resources ?? []).map((row) => ({ ...row })),
	contexts: (module?.contexts ?? []).map((context) => ({
		...context,
		lessons: context.lessons.map((lesson) => ({
			...lesson,
			startsAt: toDateInput(lesson.startsAt),
			endsAt: toDateInput(lesson.endsAt)
		}))
	}))
});

export const toModuleDraft = (
	input: ModuleEditorInput,
	savedDates: SavedModuleDates,
	issue?: (path: (string | number)[], message: string) => void
): ModuleDraft => ({
	title: input.title,
	description: input.description,
	objectives: input.objectives
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean),
	sourcePath: input.sourcePath,
	studentContent: structuredClone(input.studentContent),
	preparation: {
		framing: input.preparation.framing,
		nextSteps: input.preparation.nextSteps,
		sourceLinks: input.preparation.sourceLinks.map(({ label, url }) => ({ label, url }))
	},
	resources: input.resources.map((row) => ({ ...row })),
	contexts: input.contexts.map((context, contextIndex) => ({
		...context,
		lessons: context.lessons.map((lesson, lessonIndex) => {
			const dates = { startsAt: '', endsAt: '' };
			for (const field of ['startsAt', 'endsAt'] as const) {
				const raw = lesson[field];
				const saved = savedDates[lesson.id]?.[field];
				if (saved?.local === raw) dates[field] = saved.instant;
				else if (raw) {
					try {
						dates[field] = fromDateInput(raw);
					} catch {
						issue?.(
							['contexts', contextIndex, 'lessons', lessonIndex, field],
							'Cette heure n’existe pas ou est ambiguë lors du changement d’heure. Choisissez une autre heure.'
						);
					}
				}
			}
			return { ...lesson, ...dates };
		})
	}))
});

export const moduleEditorFingerprint = (input: ModuleEditorInput) => {
	const comparable = {
		...input,
		preparation: {
			...input.preparation,
			// Private reference IDs are UI keys, absent from the saved domain payload.
			sourceLinks: input.preparation.sourceLinks.map(({ label, url }) => ({ label, url }))
		}
	};
	return JSON.stringify(comparable, (_key, value: unknown) =>
		value && typeof value === 'object' && !Array.isArray(value)
			? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
			: value
	);
};

export const friendlyModuleFields = (values: Record<string, string>): Record<string, string> =>
	Object.fromEntries(
		Object.entries(values).map(([path, message]) => {
			if (path.endsWith('.url')) return [path, 'Renseignez un lien HTTPS valide, sans identifiant ni mot de passe.'];
			if (path.endsWith('.startsAt')) return [path, 'Renseignez la date et l’heure de début.'];
			if (path.endsWith('.endsAt') && message !== 'La fin doit suivre le début.')
				return [path, 'Renseignez la date et l’heure de fin.'];
			if (path === 'title' || path.endsWith('.title') || path.endsWith('.label'))
				return [path, 'Renseignez un intitulé de 1 à 200 caractères.'];
			return [path, message];
		})
	);

const lessonInputSchema = z.strictObject({
	id: z.string(),
	title: z.string(),
	startsAt: z.string(),
	endsAt: z.string(),
	recap: z.string(),
	toDo: z.string()
});

export const createModuleEditorSchema = (getSavedDates: () => SavedModuleDates) =>
	z
		.strictObject({
			title: z.string(),
			description: z.string(),
			objectives: z.string(),
			sourcePath: z.string(),
			addClassId: z.string(),
			preparation: z.strictObject({
				framing: z.string(),
				nextSteps: z.string(),
				sourceLinks: z.array(z.strictObject({ id: z.string(), label: z.string(), url: z.string() }))
			}),
			studentContent: studentContentSchema,
			resources: z.array(
				z.strictObject({
					id: z.string(),
					label: z.string(),
					url: z.string(),
					kind: z.enum(['course', 'instructions', 'rubric', 'resource'])
				})
			),
			contexts: z.array(
				z.strictObject({
					id: z.string(),
					classId: z.string(),
					expectedRevision: z.number().optional(),
					lessons: z.array(lessonInputSchema)
				})
			)
		})
		.superRefine((input, context) => {
			const dateIssues: string[] = [];
			const draft = toModuleDraft(input, getSavedDates(), (path, message) => {
				dateIssues.push(path.join('.'));
				context.addIssue({ code: 'custom', path, message });
			});
			const parsed = moduleDraftSchema.safeParse(draft);
			if (!parsed.success) {
				for (const [path, message] of Object.entries(friendlyModuleFields(validationFields(parsed.error)))) {
					if (dateIssues.includes(path)) continue;
					context.addIssue({
						code: 'custom',
						path: path.startsWith('objectives')
							? ['objectives']
							: path.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
						message
					});
				}
			}
		});
