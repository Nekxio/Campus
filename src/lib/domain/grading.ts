import { z } from 'zod';
import {
	assessmentKindSchema,
	assessmentStatusSchema,
	externalLinkSchema,
	idSchema,
	resultRuleSchema,
	revisionSchema
} from './contracts.js';
import { sectionPointsRule } from './rubric-points.js';

const label = z.string().trim().min(1, 'Renseignez un intitulé.').max(200);
export const rubricAssessmentSchema = z.strictObject({
	id: idSchema,
	title: label,
	kind: assessmentKindSchema,
	purpose: z.enum(['graded', 'formative']),
	groups: z
		.array(z.strictObject({ id: idSchema, title: label }))
		.min(1)
		.max(100),
	lines: z
		.array(
			z.strictObject({
				id: idSchema,
				groupId: idSchema,
				label,
				description: z.string().max(2000),
				maxPoints: z.int().positive('Le maximum doit être un entier positif.').max(1000000)
			})
		)
		.min(1)
		.max(1000)
});
export const rubricDraftSchema = z
	.strictObject({
		assessments: z.array(rubricAssessmentSchema).max(100),
		results: z
			.array(z.strictObject({ id: idSchema, title: label, rule: resultRuleSchema }))
			.max(100),
		contexts: z
			.array(
				z.strictObject({
					id: idSchema,
					expectedRevision: revisionSchema,
					deadlines: z
						.array(
							z.strictObject({
								assessmentId: idSchema,
								dueAt: z.iso.datetime({ offset: true }),
								submissionInstructions: z.string().max(10000)
							})
						)
						.max(100)
				})
			)
			.max(100)
	})
	.superRefine((value, ctx) => {
		const issue = (path: (string | number)[], message: string) =>
			ctx.addIssue({ code: 'custom', path, message });
		const unique = (ids: string[], path: (string | number)[]) => {
			if (new Set(ids).size !== ids.length) issue(path, 'Chaque identifiant doit être unique.');
		};
		unique(
			value.assessments.map((v) => v.id),
			['assessments']
		);
		unique(
			value.assessments.flatMap((v) => v.groups.map((g) => g.id)),
			['assessments']
		);
		unique(
			value.assessments.flatMap((v) => v.lines.map((l) => l.id)),
			['assessments']
		);
		unique(
			value.results.map((v) => v.id),
			['results']
		);
		unique(
			value.contexts.map((v) => v.id),
			['contexts']
		);
		for (const [a, assessment] of value.assessments.entries()) {
			for (const [l, line] of assessment.lines.entries())
				if (!assessment.groups.some((g) => g.id === line.groupId))
					issue(
						['assessments', a, 'lines', l, 'groupId'],
						'Choisissez un groupe de cette évaluation.'
					);
		}
		const graded = new Set(
			value.assessments.filter((v) => v.purpose === 'graded').map((v) => v.id)
		);
		for (const [i, result] of value.results.entries()) {
			if (result.rule.kind === 'weighted' && result.rule.sectionPoints) {
				const maxima = result.rule.sectionPoints.quizMaxima;
				const quizIds = value.assessments
					.filter((item) => item.purpose === 'graded' && item.kind === 'quiz')
					.map((item) => item.id);
				if (
					maxima.length !== quizIds.length ||
					new Set(maxima.map((item) => item.assessmentId)).size !== maxima.length ||
					maxima.some((item) => !quizIds.includes(item.assessmentId))
				)
					issue(['results', i, 'rule'], 'Renseignez le maximum de chaque section Quiz.');
				const expected = sectionPointsRule(value.assessments, maxima).components;
				if (
					value.results.length !== 1 ||
					expected.length !== result.rule.components.length ||
					expected.some((component, index) => {
						const actual = result.rule.kind === 'weighted' && result.rule.components[index];
						return (
							!actual ||
							actual.assessmentIds.length !== 1 ||
							actual.assessmentIds[0] !== component.assessmentIds[0] ||
							!Number.isFinite(component.weight) ||
							Math.abs(actual.weight - component.weight) > 1e-8
						);
					})
				)
					issue(
						['results', i, 'rule'],
						'Les poids doivent correspondre aux maxima des sections notées.'
					);
			}
			const components =
				result.rule.kind === 'weighted'
					? result.rule.components
					: [{ assessmentIds: result.rule.assessmentIds, weight: 100 }];
			if (Math.abs(components.reduce((sum, c) => sum + c.weight, 0) - 100) > 1e-8)
				issue(['results', i, 'rule'], 'Les coefficients doivent totaliser 100 %.');
			const ids = components.flatMap((c) => c.assessmentIds);
			if (new Set(ids).size !== ids.length)
				issue(
					['results', i, 'rule'],
					'Une évaluation ne peut contribuer qu’une fois au même résultat.'
				);
			if (ids.some((id) => !graded.has(id)))
				issue(['results', i, 'rule'], 'Utilisez uniquement les évaluations notées de ce module.');
		}
		const ids = new Set(value.assessments.map((v) => v.id));
		for (const [i, context] of value.contexts.entries()) {
			unique(
				context.deadlines.map((v) => v.assessmentId),
				['contexts', i, 'deadlines']
			);
			if (context.deadlines.some((v) => !ids.has(v.assessmentId)))
				issue(['contexts', i, 'deadlines'], 'Évaluation indisponible dans ce module.');
		}
	});
export const rubricUpdateSchema = rubricDraftSchema.safeExtend({
	expectedRevision: revisionSchema
});
export type RubricDraft = z.infer<typeof rubricDraftSchema>;
export type RubricAssessment = RubricDraft['assessments'][number];
export type RubricResult = RubricDraft['results'][number];
export type RubricData = Omit<RubricDraft, 'contexts'> & {
	module: { id: string; title: string; revision: number };
	contexts: (RubricDraft['contexts'][number] & {
		classId: string | null;
		className: string;
		academicYear: string;
	})[];
};

export const correctionWriteSchema = z
	.strictObject({
		expectedRevision: z.int().nonnegative(),
		rubricRevision: revisionSchema,
		status: assessmentStatusSchema,
		submissionUrl: externalLinkSchema.nullable(),
		submittedAt: z.iso.datetime({ offset: true }).nullable(),
		latenessDecision: z.enum(['automatic', 'exempt', 'refused']),
		scores: z
			.array(
				z.strictObject({ lineId: idSchema, points: z.int().nonnegative().max(1000000).nullable() })
			)
			.max(1000)
	})
	.superRefine((value, ctx) => {
		if (new Set(value.scores.map((v) => v.lineId)).size !== value.scores.length)
			ctx.addIssue({
				code: 'custom',
				path: ['scores'],
				message: 'Chaque critère ne doit apparaître qu’une fois.'
			});
	});
export type CorrectionWrite = z.infer<typeof correctionWriteSchema>;
export type CorrectionRecord = Omit<CorrectionWrite, 'expectedRevision'> & {
	assessmentId: string;
	revision: number;
	needsReview?: boolean;
};
export const semesterCommentWriteSchema = z.strictObject({
	expectedRevision: z.int().nonnegative(),
	content: z.string().max(10000)
});
export type StudentGrading = {
	id: string;
	name: string;
	corrections: CorrectionRecord[];
	comment: { revision: number; content: string };
	retiredScores: {
		assessmentTitle: string;
		label: string;
		points: number | null;
		maxPoints: number;
	}[];
};
export type GradeGridData = {
	modules: { id: string; title: string }[];
	contexts: { id: string; moduleId: string; className: string; academicYear: string }[];
	rubric: RubricData | null;
	contextId: string | null;
	students: StudentGrading[];
};
export function blankCorrection(assessmentId: string, rubricRevision: number): CorrectionRecord {
	return {
		assessmentId,
		rubricRevision,
		revision: 0,
		status: 'to_evaluate',
		submissionUrl: null,
		submittedAt: null,
		latenessDecision: 'automatic',
		scores: []
	};
}
export const assessmentStatusLabels = {
	to_evaluate: 'À évaluer',
	graded: 'Noté',
	absent_unjustified: 'Absent injustifié',
	absent_justified: 'Absent justifié / rattrapage'
} as const;
