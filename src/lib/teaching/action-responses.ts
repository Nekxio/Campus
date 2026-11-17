import { z } from 'zod';
import { assessmentKindSchema, assessmentStatusSchema, idSchema, preparationSchema } from '../domain/contracts.js';
import type { RubricData, StudentGrading } from '../domain/grading.js';
import type { AnnualHistory } from '../domain/annual.js';

const revision = z.int().nonnegative();
// Date formatters consume these instants after decoding, so reject unusable dates before state changes.
const receiptTimestamp = z.iso.datetime({ offset: true }).refine((value) => Number.isFinite(Date.parse(value)));
const identityReceiptSchema = z.object({ id: idSchema });
export function identityResponse(expectedId?: string) {
	return (payload: unknown) => {
		const receipt = identityReceiptSchema.parse(payload);
		if (expectedId !== undefined && receipt.id !== expectedId) throw new Error('Unexpected identity');
		return receipt;
	};
}
export const rosterReceiptSchema = z.object({
	added: z.int().nonnegative(),
	skipped: z.int().nonnegative()
});
export const attachmentReceiptSchema = z.object({ id: idSchema, moduleId: idSchema });
export const commentReceiptSchema = z.object({ revision, content: z.string() });

// Read contracts check structure, not today's authoring rules. Historical points and
// incomplete/retired references must reach the existing review and calculation code unchanged.
const scoreSchema = z.object({ lineId: idSchema, points: z.number().nullable() });
const studentSchema = z.object({
	id: idSchema,
	name: z.string(),
	corrections: z.array(
		z.object({
			assessmentId: idSchema,
			revision,
			rubricRevision: revision,
			status: assessmentStatusSchema,
			submissionUrl: z.string().nullable(),
			submittedAt: receiptTimestamp.nullable(),
			latenessDecision: z.enum(['automatic', 'exempt', 'refused']),
			needsReview: z.boolean().optional(),
			scores: z.array(scoreSchema)
		})
	),
	comment: commentReceiptSchema,
	retiredScores: z.array(
		z.object({
			assessmentTitle: z.string(),
			label: z.string(),
			points: z.number().nullable(),
			maxPoints: z.number()
		})
	)
});
const resultRuleReadSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('points_ratio'), assessmentIds: z.array(idSchema) }),
	z.object({
		kind: z.literal('weighted'),
		components: z.array(z.object({ assessmentIds: z.array(idSchema), weight: z.number() })),
		sectionPoints: z
			.object({ quizMaxima: z.array(z.object({ assessmentId: idSchema, maxPoints: z.number() })) })
			.optional()
	})
]);
const rubricSchema = z.object({
	module: z.object({ id: idSchema, title: z.string(), revision }),
	assessments: z.array(
		z.object({
			id: idSchema,
			title: z.string(),
			kind: assessmentKindSchema,
			purpose: z.enum(['graded', 'formative']),
			groups: z.array(z.object({ id: idSchema, title: z.string() })),
			lines: z.array(
				z.object({
					id: idSchema,
					groupId: idSchema,
					label: z.string(),
					description: z.string(),
					maxPoints: z.number()
				})
			)
		})
	),
	results: z.array(z.object({ id: idSchema, title: z.string(), rule: resultRuleReadSchema })),
	contexts: z.array(
		z.object({
			id: idSchema,
			classId: idSchema.nullable(),
			className: z.string(),
			academicYear: z.string(),
			expectedRevision: revision,
			deadlines: z.array(
				z.object({
					assessmentId: idSchema,
					dueAt: receiptTimestamp,
					submissionInstructions: z.string()
				})
			)
		})
	)
});
export function rubricResponse(moduleId: string) {
	return (payload: unknown): RubricData => {
		const rubric = rubricSchema.parse(payload);
		if (rubric.module.id !== moduleId) throw new Error('Unexpected module');
		return rubric;
	};
}
export function studentGradingResponse(studentId: string, assessmentId?: string) {
	return (payload: unknown): StudentGrading => {
		const student = studentSchema.parse(payload);
		if (
			student.id !== studentId ||
			(assessmentId !== undefined && !student.corrections.some((record) => record.assessmentId === assessmentId))
		)
			throw new Error('Unexpected correction');
		return student;
	};
}
export const annualHistorySchema = z.object({
	academicYear: z.string(),
	className: z.string(),
	moduleTitle: z.string(),
	preparation: preparationSchema,
	lessons: z.array(
		z.object({
			id: idSchema,
			title: z.string(),
			startsAt: receiptTimestamp,
			endsAt: receiptTimestamp,
			recap: z.string(),
			toDo: z.string()
		})
	),
	deadlines: z.array(
		z.object({
			id: idSchema,
			title: z.string(),
			dueAt: receiptTimestamp,
			submissionInstructions: z.string()
		})
	),
	grid: z
		.object({
			modules: z.array(z.object({ id: idSchema, title: z.string() })),
			contexts: z.array(
				z.object({
					id: idSchema,
					moduleId: idSchema,
					className: z.string(),
					academicYear: z.string()
				})
			),
			rubric: rubricSchema.nullable(),
			contextId: idSchema.nullable(),
			students: z.array(studentSchema)
		})
		.nullable()
}) satisfies z.ZodType<AnnualHistory>;

export const revocationReceiptSchema = z.object({ revoked: z.literal(true) });
export function consentRedirectResponse(payload: unknown, origin: string, oauthQuery: string) {
	try {
		const { url } = z.object({ url: z.string().min(1).max(16000), redirect: z.boolean().optional() }).parse(payload);
		const target = new URL(url, origin);
		const expected = new URL(new URLSearchParams(oauthQuery).get('redirect_uri') ?? '');
		const internal = target.origin === origin && ['/autoriser', '/connexion/application'].includes(target.pathname);
		const callback = target.origin === expected.origin && target.pathname === expected.pathname;
		if (target.username || target.password || target.hash || (!internal && !callback))
			throw new Error('Unexpected redirect');
		return target.href;
	} catch {
		throw new Error('Redirection indisponible. Réessayez.');
	}
}

// Better Auth 1.7.7 returns dates as Date or wire strings. Registration returns
// a Passkey, not {success:true}; its session/user are optional in the installed SDK.
const timestamp = z.union([z.date(), z.iso.datetime({ offset: true })]);
const sdkIdentity = z.string().min(1);
const sessionSchema = z.object({
	id: sdkIdentity,
	userId: sdkIdentity,
	token: sdkIdentity,
	expiresAt: timestamp,
	createdAt: timestamp,
	updatedAt: timestamp
});
const userSchema = z.object({
	id: sdkIdentity,
	name: z.string(),
	email: z.string(),
	emailVerified: z.boolean(),
	createdAt: timestamp,
	updatedAt: timestamp,
	image: z.string().nullable().optional()
});
export const passkeySignInSchema = z.object({ session: sessionSchema, user: userSchema });
export const passkeyActivationSchema = z.object({
	id: sdkIdentity,
	userId: sdkIdentity,
	publicKey: sdkIdentity,
	credentialID: sdkIdentity,
	counter: z.number(),
	deviceType: z.enum(['singleDevice', 'multiDevice']),
	backedUp: z.boolean(),
	name: z.string().optional(),
	transports: z.string().optional(),
	createdAt: timestamp,
	aaguid: z.string().optional(),
	session: sessionSchema.optional(),
	user: userSchema.optional()
});
