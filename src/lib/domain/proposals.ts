import { z } from 'zod';
import { idSchema, revisionSchema, assessmentStatusSchema } from './contracts.js';
import type { RubricData, StudentGrading } from './grading.js';
const score = z.strictObject({
	lineId: idSchema,
	points: z.int().nonnegative().max(1000000).nullable()
});
export const agentProposalPayloadSchema = z
	.strictObject({
		version: z.literal(2),
		moduleId: idSchema,
		contextId: idSchema,
		studentId: idSchema,
		assessmentId: idSchema,
		rubricRevision: revisionSchema,
		contextRevision: revisionSchema,
		correctionRevision: z.int().nonnegative(),
		scores: z.array(score).min(1).max(1000),
		semesterComment: z.string().max(10000).optional(),
		commentRevision: z.int().nonnegative().optional()
	})
	.superRefine((value, ctx) => {
		if (new Set(value.scores.map((s) => s.lineId)).size !== value.scores.length)
			ctx.addIssue({
				code: 'custom',
				path: ['scores'],
				message: 'Chaque critère ne peut figurer qu’une fois.'
			});
		if ((value.semesterComment !== undefined) !== (value.commentRevision !== undefined))
			ctx.addIssue({
				code: 'custom',
				path: ['commentRevision'],
				message: 'La proposition de commentaire nécessite sa révision de référence.'
			});
	});
export type AgentProposalPayload = z.infer<typeof agentProposalPayloadSchema>;
export const createProposalSchema = z.strictObject({
	requestId: idSchema,
	proposalId: idSchema,
	payload: agentProposalPayloadSchema
});
export type CreateProposal = z.infer<typeof createProposalSchema>;
export const proposalReceiptSchema = z.strictObject({
	version: z.literal(1),
	requestId: idSchema,
	proposalId: idSchema,
	editorPath: z.string().regex(/^\/enseignant\/propositions\?proposition=[a-f\d-]+$/i)
});
export type ProposalReceipt = z.infer<typeof proposalReceiptSchema>;
const decisionBase = { requestId: idSchema, expectedRevision: revisionSchema };
export const proposalDecisionSchema = z
	.discriminatedUnion('action', [
		z.strictObject({
			...decisionBase,
			action: z.literal('accept_points'),
			status: assessmentStatusSchema,
			scores: z.array(score).min(1).max(1000)
		}),
		z.strictObject({ ...decisionBase, action: z.literal('reject') }),
		z.strictObject({
			...decisionBase,
			action: z.literal('accept_comment'),
			content: z.string().max(10000)
		}),
		z.strictObject({ ...decisionBase, action: z.literal('keep_comment') })
	])
	.superRefine((value, ctx) => {
		if (
			value.action === 'accept_points' &&
			new Set(value.scores.map((s) => s.lineId)).size !== value.scores.length
		)
			ctx.addIssue({
				code: 'custom',
				path: ['scores'],
				message: 'Chaque critère ne peut figurer qu’une fois.'
			});
	});
export type ProposalDecision = z.infer<typeof proposalDecisionSchema>;
export const proposalDecisionReceiptSchema = z.strictObject({
	id: idSchema,
	revision: revisionSchema,
	state: z.enum(['pending', 'accepted', 'rejected']),
	commentState: z.enum(['none', 'pending', 'accepted', 'kept'])
});
export type ProposalDecisionReceipt = z.infer<typeof proposalDecisionReceiptSchema>;
export type ProposalSummary = ProposalDecisionReceipt & {
	studentId: string;
	studentName: string;
	assessmentId: string;
	assessmentTitle: string;
	moduleId: string;
	moduleTitle: string;
	contextId: string;
	className: string;
	academicYear: string;
	createdAt: string;
};
export type ProposalRecord = ProposalDecisionReceipt & {
	createdAt: string;
	payload: AgentProposalPayload | null;
	legacy: boolean;
	appliedCorrectionRevision: number | null;
};
export type ProposalReviewSelection = {
	proposal: ProposalRecord;
	rubric: RubricData;
	student: StudentGrading;
	contextId: string;
	assessmentId: string;
	pointsIssues: string[];
	commentIssues: string[];
};
export type ProposalReviewData = {
	queue: ProposalSummary[];
	selected: ProposalReviewSelection | null;
};
// Agent responses are scoped to one linked module and one exact teaching context.
const recordSchema = z.strictObject({
	assessmentId: idSchema,
	rubricRevision: revisionSchema,
	revision: z.int().nonnegative(),
	status: assessmentStatusSchema,
	submissionUrl: z.string().nullable(),
	submittedAt: z.string().nullable(),
	latenessDecision: z.enum(['automatic', 'exempt', 'refused']),
	scores: z.array(score)
});
export const correctionContextSchema = z.strictObject({
	version: z.literal(1),
	moduleId: idSchema,
	contextId: idSchema,
	className: z.string(),
	academicYear: z.string(),
	contextRevision: revisionSchema,
	rubricRevision: revisionSchema,
	assessments: z.array(
		z.strictObject({
			id: idSchema,
			title: z.string(),
			kind: z.string(),
			purpose: z.enum(['graded', 'formative']),
			lines: z.array(
				z.strictObject({
					id: idSchema,
					groupId: idSchema,
					groupTitle: z.string(),
					label: z.string(),
					description: z.string(),
					maxPoints: z.int().positive()
				})
			),
			deadline: z.string().nullable()
		})
	),
	students: z.array(z.strictObject({ id: idSchema, name: z.string() })),
	student: z
		.strictObject({
			id: idSchema,
			name: z.string(),
			corrections: z.array(recordSchema),
			comment: z.strictObject({ revision: z.int().nonnegative(), content: z.string() })
		})
		.nullable()
});
export type CorrectionContext = z.infer<typeof correctionContextSchema>;
export const proposalAgentPermissions = { 'correction-proposals': ['read', 'create'] };
export type ProposalAgentAction = 'proposal_read' | 'proposal_create';
