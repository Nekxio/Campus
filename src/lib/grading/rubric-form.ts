import { z } from 'zod';
import {
	rubricAssessmentSchema,
	rubricDraftSchema,
	type RubricData,
	type RubricDraft
} from '#lib/domain/grading.js';
import { fromDateInput, toDateInput } from '#lib/teaching/calendar.js';
import { sectionPointsRule, type QuizMaximum } from '#lib/domain/rubric-points.js';

export type RubricEditorInput = {
	calculationMode: 'sections' | 'custom';
	quizMaxima: QuizMaximum[];
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
	const rule = data.results.length === 1 ? data.results[0].rule : undefined;
	const sectionPoints = rule?.kind === 'weighted' ? rule.sectionPoints : undefined;
	return {
		calculationMode:
			sectionPoints || (!data.results.length && !data.assessments.length) ? 'sections' : 'custom',
		quizMaxima: data.assessments
			.filter((item) => item.kind === 'quiz')
			.map((item) => ({
				assessmentId: item.id,
				maxPoints:
					sectionPoints?.quizMaxima.find((maximum) => maximum.assessmentId === item.id)
						?.maxPoints ?? Number.NaN
			})),
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
export function syncRubricSections(input: RubricEditorInput): RubricEditorInput {
	const graded = input.assessments.filter((item) => item.purpose === 'graded');
	return {
		...input,
		quizMaxima: input.assessments
			.filter((item) => item.kind === 'quiz')
			.map((item) => ({
				assessmentId: item.id,
				maxPoints:
					input.quizMaxima.find((maximum) => maximum.assessmentId === item.id)?.maxPoints ??
					Number.NaN
			})),
		results:
			input.calculationMode !== 'sections'
				? input.results
				: !graded.length
					? []
					: [
							input.results[0] ?? {
								id: crypto.randomUUID(),
								title: 'Note du module',
								kind: 'weighted',
								assessmentIds: [],
								components: []
							}
						]
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
				input.calculationMode === 'sections'
					? sectionPointsRule(
							input.assessments,
							input.quizMaxima.filter((maximum) =>
								input.assessments.some(
									(item) =>
										item.id === maximum.assessmentId &&
										item.kind === 'quiz' &&
										item.purpose === 'graded'
								)
							)
						)
					: result.kind === 'points_ratio'
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
		.replace(/^results\.0\.rule\.sectionPoints\.quizMaxima/, 'quizMaxima')
		.replace(/\.rule\.kind$/, '.kind')
		.replace(/\.rule\./, '.')
		.replace(/\.rule$/, '.kind');
}
export function rubricEditorSchema(dates: () => SavedDeadlineDates) {
	return z
		.strictObject({
			calculationMode: z.enum(['sections', 'custom']),
			// An unused quiz maximum can remain blank in the compatible custom editor.
			quizMaxima: z
				.array(
					z.strictObject({ assessmentId: z.string(), maxPoints: z.union([z.number(), z.nan()]) })
				)
				.max(100),
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
			let missingQuizMaximum = false;
			if (input.calculationMode === 'sections') {
				input.quizMaxima.forEach((maximum, index) => {
					if (
						input.assessments.some(
							(item) => item.id === maximum.assessmentId && item.purpose === 'graded'
						) &&
						(!Number.isInteger(maximum.maxPoints) ||
							maximum.maxPoints < 1 ||
							maximum.maxPoints > 1000000)
					) {
						missingQuizMaximum = true;
						context.addIssue({
							code: 'custom',
							path: ['quizMaxima', index, 'maxPoints'],
							message: 'Choisissez un maximum entier positif pour cette section Quiz.'
						});
					}
				});
			}
			const dateIssues = new Set<string>();
			const domain = rubricToDomain(input, dates(), (path, message) => {
				dateIssues.add(path.join('.'));
				context.addIssue({ code: 'custom', path, message });
			});
			// Generated weights are not editable errors while a quiz maximum is still blank.
			const parsed = rubricDraftSchema.safeParse(
				missingQuizMaximum ? { ...domain, results: [] } : domain
			);
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
