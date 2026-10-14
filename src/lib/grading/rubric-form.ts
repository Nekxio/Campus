import { z } from 'zod';
import {
	rubricAssessmentSchema,
	rubricDraftSchema,
	type RubricData,
	type RubricDraft
} from '#lib/domain/grading.js';
import { fromDateInput, toDateInput } from '#lib/teaching/calendar.js';

export type RubricEditorInput = {
	assessments: RubricDraft['assessments'];
	results: {
		id: string;
		title: string;
		kind: 'points_ratio' | 'weighted';
		assessmentIds: string[];
		components: { id: string; assessmentIds: string[]; weight: number }[];
	}[];
	contexts: RubricDraft['contexts'];
};
export type SavedDeadlineDates = Record<string, { local: string; instant: string }>;
export function savedDeadlineDates(data: RubricData): SavedDeadlineDates {
	return Object.fromEntries(
		data.contexts.flatMap((context) =>
			context.deadlines.map((deadline) => [
				`${context.id}:${deadline.assessmentId}`,
				{ local: toDateInput(deadline.dueAt), instant: deadline.dueAt }
			])
		)
	);
}
export function rubricToInput(data: RubricData): RubricEditorInput {
	return {
		assessments: data.assessments.map((assessment) => ({
			...assessment,
			groups: assessment.groups.map((group) => ({ ...group })),
			lines: assessment.lines.map((line) => ({ ...line }))
		})),
		results: data.results.map((result) => ({
			id: result.id,
			title: result.title,
			kind: result.rule.kind,
			assessmentIds: result.rule.kind === 'points_ratio' ? [...result.rule.assessmentIds] : [],
			components:
				result.rule.kind === 'weighted'
					? result.rule.components.map((component, index) => ({
							...component,
							id: `${result.id}-${index}`,
							assessmentIds: [...component.assessmentIds]
						}))
					: []
		})),
		contexts: data.contexts.map((context) => ({
			id: context.id,
			expectedRevision: context.expectedRevision,
			deadlines: context.deadlines.map((deadline) => ({
				...deadline,
				dueAt: toDateInput(deadline.dueAt)
			}))
		}))
	};
}
export function rubricToDomain(
	input: RubricEditorInput,
	dates: SavedDeadlineDates,
	issue?: (path: (string | number)[], message: string) => void
): RubricDraft {
	return {
		assessments: input.assessments,
		results: input.results.map((result) => ({
			id: result.id,
			title: result.title,
			rule:
				result.kind === 'points_ratio'
					? { kind: result.kind, assessmentIds: result.assessmentIds }
					: {
							kind: result.kind,
							components: result.components.map(({ assessmentIds, weight }) => ({
								assessmentIds,
								weight
							}))
						}
		})),
		contexts: input.contexts.map((context, contextIndex) => ({
			...context,
			deadlines: context.deadlines.map((deadline, deadlineIndex) => {
				const saved = dates[`${context.id}:${deadline.assessmentId}`];
				let dueAt = '';
				if (saved?.local === deadline.dueAt) dueAt = saved.instant;
				else if (deadline.dueAt) {
					try {
						dueAt = fromDateInput(deadline.dueAt);
					} catch {
						issue?.(
							['contexts', contextIndex, 'deadlines', deadlineIndex, 'dueAt'],
							'Cette heure n’existe pas ou est ambiguë à Paris. Choisissez une autre heure.'
						);
					}
				}
				return { ...deadline, dueAt };
			})
		}))
	};
}
export function rubricInputPath(path: string) {
	return path
		.replace(/\.rule\.kind$/, '.kind')
		.replace(/\.rule\./, '.')
		.replace(/\.rule$/, '.kind');
}
export function rubricEditorSchema(dates: () => SavedDeadlineDates) {
	return z
		.strictObject({
			assessments: z.array(rubricAssessmentSchema).max(100),
			results: z
				.array(
					z.strictObject({
						id: z.string(),
						title: z.string(),
						kind: z.enum(['points_ratio', 'weighted']),
						assessmentIds: z.array(z.string()),
						components: z.array(
							z.strictObject({
								id: z.string(),
								assessmentIds: z.array(z.string()),
								weight: z.number()
							})
						)
					})
				)
				.max(100),
			contexts: z
				.array(
					z.strictObject({
						id: z.string(),
						expectedRevision: z.number(),
						deadlines: z.array(
							z.strictObject({
								assessmentId: z.string(),
								dueAt: z.string(),
								submissionInstructions: z.string()
							})
						)
					})
				)
				.max(100)
		})
		.superRefine((input, context) => {
			const dateIssues = new Set<string>();
			const domain = rubricToDomain(input, dates(), (path, message) => {
				dateIssues.add(path.join('.'));
				context.addIssue({ code: 'custom', path, message });
			});
			const parsed = rubricDraftSchema.safeParse(domain);
			if (!parsed.success)
				for (const issue of parsed.error.issues) {
					if (dateIssues.has(issue.path.join('.'))) continue;
					const path = rubricInputPath(issue.path.join('.'))
						.split('.')
						.map((part) => (/^\d+$/.test(part) ? Number(part) : part));
					context.addIssue({
						code: 'custom',
						path,
						message:
							issue.path.at(-1) === 'dueAt'
								? 'Renseignez la date et l’heure de remise.'
								: issue.message
					});
				}
		});
}
