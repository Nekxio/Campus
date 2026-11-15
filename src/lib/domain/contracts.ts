import { z } from 'zod';

export const academicYearSchema = z
	.string()
	.regex(/^\d{4}-\d{4}$/)
	.refine((year) => {
		const [start, end] = year.split('-').map(Number);
		return end === start + 1;
	}, 'Expected two consecutive academic years.');
export const idSchema = z.uuid();
export const revisionSchema = z.int().positive();
const label = z.string().trim().min(1).max(200);
export const externalLinkSchema = z.url().refine((value) => {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	return url.protocol === 'https:' && !url.username && !url.password;
}, 'Use an HTTPS link without credentials.');
export const assessmentStatusSchema = z.enum(['to_evaluate', 'graded', 'absent_unjustified', 'absent_justified']);
export type AssessmentStatus = z.infer<typeof assessmentStatusSchema>;
export const assessmentKindSchema = z.enum(['quiz', 'project', 'oral', 'other']);
export const resourceKindSchema = z.enum(['course', 'instructions', 'rubric', 'resource']);
export const resourceSchema = z.strictObject({
	id: idSchema,
	label,
	url: externalLinkSchema,
	kind: resourceKindSchema
});
export type Resource = z.infer<typeof resourceSchema>;

export const preparationSchema = z.strictObject({
	framing: z.string().max(20000).default(''),
	nextSteps: z.string().max(20000).default(''),
	sourceLinks: z
		.array(z.strictObject({ label, url: externalLinkSchema }))
		.max(100)
		.default([])
});
export type Preparation = z.infer<typeof preparationSchema>;

// Formulas are structured data. No expressions or executable strings are accepted.
const componentSchema = z.strictObject({
	assessmentIds: z
		.array(idSchema)
		.min(1)
		.max(100)
		.refine((ids) => new Set(ids).size === ids.length),
	weight: z.number().positive().max(100)
});
export const resultRuleSchema = z.discriminatedUnion('kind', [
	z.strictObject({
		kind: z.literal('points_ratio'),
		assessmentIds: componentSchema.shape.assessmentIds
	}),
	z.strictObject({
		kind: z.literal('weighted'),
		components: z.array(componentSchema).min(1).max(100),
		// Optional authoring mode; existing weighted rules keep their exact meaning.
		sectionPoints: z
			.strictObject({
				quizMaxima: z
					.array(z.strictObject({ assessmentId: idSchema, maxPoints: z.int().positive().max(1000000) }))
					.max(100)
			})
			.optional()
	})
]);
export type ResultRule = z.infer<typeof resultRuleSchema>;

export const correctionProposalSchema = z
	.strictObject({
		version: z.literal(1),
		contextId: idSchema,
		studentId: idSchema,
		assessmentId: idSchema,
		rubricRevision: revisionSchema,
		correctionRevision: revisionSchema,
		scores: z.array(z.strictObject({ lineId: idSchema, points: z.int().nonnegative() })).max(1000),
		semesterComment: z.string().max(10000).optional()
	})
	.refine(
		(proposal) => new Set(proposal.scores.map((score) => score.lineId)).size === proposal.scores.length,
		'A scoring line can only appear once.'
	);
export type CorrectionProposal = z.infer<typeof correctionProposalSchema>;

// Explicit student-facing projection: private preparation, names and grades are never fields here.
export const modulePublicationSchema = z.strictObject({
	version: z.literal(1),
	title: label,
	description: z.string().max(20000),
	resources: z.array(resourceSchema).max(200),
	deadlines: z
		.array(
			z.strictObject({
				label,
				dueAt: z.iso.datetime({ offset: true }),
				submissionInstructions: z.string().max(10000)
			})
		)
		.max(100),
	recap: z.string().max(10000),
	toDo: z.string().max(10000)
});
export type ModulePublication = z.infer<typeof modulePublicationSchema>;
