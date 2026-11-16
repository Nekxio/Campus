import { afterEach, describe, expect, it, vi } from 'vitest';
import type { authClient } from '../auth-client.js';
import type { RubricData, StudentGrading } from '../domain/grading.js';
import { savedDeadlineDates, rubricToInput } from '../grading/rubric-form.js';
import { correctionInput, mergeSavedAssessment, submissionMetadata } from '../grading/correction-form.js';
import { saveTeaching } from './api.js';
import {
	identityResponse,
	rosterReceiptSchema,
	attachmentReceiptSchema,
	commentReceiptSchema,
	rubricResponse,
	studentGradingResponse,
	consentRedirectResponse,
	revocationReceiptSchema,
	passkeySignInSchema,
	passkeyActivationSchema,
	annualHistorySchema
} from './action-responses.js';

const id = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const line = '10000000-0000-4000-8000-000000000003';
const rubric: RubricData = {
	module: { id, title: 'Module fictif', revision: 3 },
	assessments: [
		{
			id: other,
			title: 'Projet',
			kind: 'project',
			purpose: 'graded',
			groups: [{ id, title: 'Critères' }],
			lines: [{ id: line, groupId: id, label: 'Critère', description: '', maxPoints: 2 }]
		}
	],
	results: [
		{
			id,
			title: 'Résultat',
			rule: {
				kind: 'weighted',
				components: [{ assessmentIds: [other], weight: 100 }],
				sectionPoints: { quizMaxima: [] }
			}
		}
	],
	contexts: [
		{
			id,
			classId: null,
			className: 'Classe fictive',
			academicYear: '2026-2027',
			expectedRevision: 2,
			deadlines: [{ assessmentId: other, dueAt: '2026-10-15T10:00:00Z', submissionInstructions: '' }]
		}
	]
};
const student: StudentGrading = {
	id,
	name: 'Étudiant fictif',
	corrections: [
		{
			assessmentId: other,
			revision: 4,
			rubricRevision: 1,
			status: 'absent_justified',
			submissionUrl: null,
			submittedAt: null,
			latenessDecision: 'exempt',
			scores: [
				{ lineId: line, points: 1200000 },
				{ lineId: id, points: null }
			]
		}
	],
	comment: { revision: 0, content: '' },
	retiredScores: [
		{ assessmentTitle: 'Retirée', label: 'Ancien critère', points: 42, maxPoints: 1 },
		{ assessmentTitle: '', label: '', points: null, maxPoints: 5 }
	]
};

afterEach(() => vi.unstubAllGlobals());

const invalidTimestamps = [
	'not-a-date',
	'',
	'2026-10-26',
	'2026-10-26T10:00:00',
	'2026-02-30T10:00:00Z',
	'2026-13-01T10:00:00Z',
	'2026-10-26T25:00:00Z',
	'2026-10-26T10:00:00+25:00'
];

describe('read-only action receipt contracts', () => {
	it('validates exact class/student identities without requiring an attachment copy to keep the source module', () => {
		expect(identityResponse()({ id })).toEqual({ id });
		expect(identityResponse(id)({ id })).toEqual({ id });
		expect(() => identityResponse(id)({ id: other })).toThrow();
		expect(attachmentReceiptSchema.parse({ id, moduleId: other })).toEqual({ id, moduleId: other });
	});
	it.each([{}, { id: 'bad' }, { id: null }])('refuses an invalid identity before a caller can close: %j', (value) => {
		expect(() => identityResponse()(value)).toThrow();
	});
	it('validates integer counts including zero, not arbitrary 200 objects', () => {
		expect(rosterReceiptSchema.parse({ added: 0, skipped: 2 })).toEqual({ added: 0, skipped: 2 });
		for (const value of [
			{},
			{ added: 1 },
			{ added: -1, skipped: 0 },
			{ added: 1.5, skipped: 0 },
			{ added: '1', skipped: 0 }
		])
			expect(rosterReceiptSchema.safeParse(value).success).toBe(false);
	});
	it('requires the complete independent comment receipt before reset', () => {
		expect(commentReceiptSchema.parse({ revision: 1, content: '' })).toEqual({
			revision: 1,
			content: ''
		});
		for (const value of [{}, { revision: 1 }, { content: 'texte' }, { revision: '1', content: '' }])
			expect(commentReceiptSchema.safeParse(value).success).toBe(false);
	});
	it('reads rubric structure without revalidating authoring rules or transforming content', () => {
		expect(rubricResponse(id)(rubric)).toEqual(rubric);
		expect(() => rubricResponse(other)(rubric)).toThrow();
		const historical = {
			...rubric,
			results: [
				{
					id,
					title: '',
					rule: { kind: 'weighted', components: [{ assessmentIds: [], weight: 0 }] }
				}
			]
		};
		expect(rubricResponse(id)(historical)).toEqual(historical);
		for (const value of [{}, { ...rubric, assessments: [{}] }, { ...rubric, contexts: [{ id }] }])
			expect(() => rubricResponse(id)(value)).toThrow();
	});
	it('preserves historical excess points, nulls, omitted lines, optional needsReview and retired scores', () => {
		expect(studentGradingResponse(id, other)(student)).toEqual(student);
		const partial = {
			...student,
			corrections: [{ ...student.corrections[0], needsReview: true, scores: [] }]
		};
		expect(studentGradingResponse(id, other)(partial)).toEqual(partial);
	});
	it.each([
		'1960-01-01T00:00:00Z',
		'2024-02-29T10:00:00.123Z',
		'2026-10-26T10:00:00+02:00',
		'2026-10-26T10:00:00-04:30'
	])('preserves valid ISO receipt timestamps without UTC conversion: %s', (instant) => {
		const withDeadline = structuredClone(rubric);
		withDeadline.contexts[0].deadlines[0].dueAt = instant;
		const decodedRubric = rubricResponse(id)(withDeadline);
		expect(decodedRubric).toEqual(withDeadline);
		expect(() => savedDeadlineDates(decodedRubric)).not.toThrow();
		const withSubmission = structuredClone(student);
		withSubmission.corrections[0].submittedAt = instant;
		const decodedStudent = studentGradingResponse(id, other)(withSubmission);
		expect(decodedStudent).toEqual(withSubmission);
		expect(() => submissionMetadata(decodedStudent)).not.toThrow();
	});
	it.each(invalidTimestamps)(
		'rejects a malformed rubric dueAt in HTTP 200 before applySaved, baseline or reset: %j',
		async (dueAt) => {
			const receipt = structuredClone(rubric);
			receipt.module.revision++;
			receipt.contexts[0].deadlines[0].dueAt = dueAt;
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(receipt)));
			let saved = rubric;
			let dates = savedDeadlineDates(saved);
			let baseline = JSON.stringify(rubricToInput(saved));
			const initialDates = dates;
			const initialBaseline = baseline;
			const reset = vi.fn();
			const applySaved = vi.fn((value: RubricData) => {
				saved = value;
				dates = savedDeadlineDates(value);
				const input = rubricToInput(value);
				reset(input);
				baseline = JSON.stringify(input);
			});
			const request = saveTeaching('/rubric', {}, 'PATCH', undefined, rubricResponse(id)).then(applySaved);
			await expect(request).rejects.toMatchObject({ status: 200, decodedServerError: false });
			expect(applySaved).not.toHaveBeenCalled();
			expect(reset).not.toHaveBeenCalled();
			expect(saved).toBe(rubric);
			expect(dates).toBe(initialDates);
			expect(baseline).toBe(initialBaseline);
		}
	);
	it.each(invalidTimestamps)(
		'rejects a malformed submittedAt in HTTP 200 before merging, comment reset or baseline: %j',
		async (submittedAt) => {
			const receipt = structuredClone(student);
			receipt.corrections[0].revision++;
			receipt.corrections[0].submittedAt = submittedAt;
			receipt.comment = { revision: 1, content: 'Ne doit pas remplacer le commentaire.' };
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(receipt)));
			let savedStudent = student;
			let dates = submissionMetadata(savedStudent);
			let baseline = JSON.stringify(correctionInput(rubric, savedStudent));
			const initialDates = dates;
			const initialBaseline = baseline;
			const resetComment = vi.fn();
			const resetCorrection = vi.fn();
			const applySaved = vi.fn((value: StudentGrading) => {
				savedStudent = mergeSavedAssessment(savedStudent, value, other);
				resetComment(value.comment);
				dates = submissionMetadata(savedStudent);
				const input = correctionInput(rubric, savedStudent);
				resetCorrection(input);
				baseline = JSON.stringify(input);
			});
			const request = saveTeaching('/correction', {}, 'PATCH', undefined, studentGradingResponse(id, other)).then(
				applySaved
			);
			await expect(request).rejects.toMatchObject({ status: 200, decodedServerError: false });
			expect(applySaved).not.toHaveBeenCalled();
			expect(resetComment).not.toHaveBeenCalled();
			expect(resetCorrection).not.toHaveBeenCalled();
			expect(savedStudent).toBe(student);
			expect(dates).toBe(initialDates);
			expect(baseline).toBe(initialBaseline);
		}
	);
	it('rejects a wrong student, missing saved assessment or malformed nested record before any merge', () => {
		for (const value of [
			{},
			{ ...student, id: other },
			{ ...student, corrections: [] },
			{ ...student, comment: {} },
			{ ...student, retiredScores: [{}] },
			{
				...student,
				corrections: [{ ...student.corrections[0], scores: [{ lineId: 'bad', points: 1 }] }]
			}
		])
			expect(() => studentGradingResponse(id, other)(value)).toThrow();
	});
	it('validates history recursively, including historical grid points, before rendering it', () => {
		const history = {
			academicYear: '2026-2027',
			className: 'Classe',
			moduleTitle: 'Module',
			preparation: { framing: '', nextSteps: '', sourceLinks: [] },
			lessons: [
				{
					id,
					title: 'Séance fictive',
					startsAt: '2026-10-26T10:00:00Z',
					endsAt: '2026-10-26T11:00:00Z',
					recap: '',
					toDo: ''
				}
			],
			deadlines: [{ id, title: 'Projet', dueAt: '2026-10-26T11:00:00Z', submissionInstructions: '' }],
			grid: {
				modules: [{ id, title: 'Module' }],
				contexts: [{ id, moduleId: id, className: 'Classe', academicYear: '2026-2027' }],
				contextId: id,
				rubric,
				students: [student]
			}
		};
		expect(annualHistorySchema.parse(history)).toEqual(history);
		expect(annualHistorySchema.safeParse({ ...history, lessons: [{}] }).success).toBe(false);
		expect(annualHistorySchema.safeParse({ ...history, grid: {} }).success).toBe(false);
		for (const field of ['startsAt', 'endsAt'] as const) {
			const invalid = structuredClone(history);
			invalid.lessons[0][field] = '2026-02-30T10:00:00Z';
			expect(annualHistorySchema.safeParse(invalid).success).toBe(false);
		}
		const invalid = structuredClone(history);
		invalid.deadlines[0].dueAt = 'not-a-date';
		expect(annualHistorySchema.safeParse(invalid).success).toBe(false);
	});
});

describe('installed authentication response contracts', () => {
	const origin = 'http://localhost:5173';
	const query = new URLSearchParams({ redirect_uri: 'http://127.0.0.1:47913/callback' }).toString();
	it('confirms revocation only for revoked:true', () => {
		expect(revocationReceiptSchema.parse({ revoked: true })).toEqual({ revoked: true });
		for (const value of [{}, { revoked: false }, { revoked: 1 }])
			expect(revocationReceiptSchema.safeParse(value).success).toBe(false);
	});
	it('accepts only the existing internal/callback redirect contract', () => {
		for (const url of [
			'/autoriser?next=fictitious',
			'/connexion/application',
			'http://127.0.0.1:47913/callback?error=access_denied'
		])
			expect(consentRedirectResponse({ url }, origin, query)).toBe(new URL(url, origin).href);
		for (const value of [
			{},
			{ url: '' },
			{ url: 'javascript:alert(1)' },
			{ url: 'https://example.test/' },
			{ url: '/enseignant/compte' },
			{ url: 'http://user:password@127.0.0.1:47913/callback' },
			{ url: 'http://127.0.0.1:47913/callback#fragment' }
		])
			expect(() => consentRedirectResponse(value, origin, query)).toThrow();
	});
	const now = new Date('2026-10-26T10:00:00Z');
	const signIn = {
		session: {
			id: 'sdk-session',
			userId: 'sdk-user',
			token: 'fictional-token',
			expiresAt: now,
			createdAt: now,
			updatedAt: now
		},
		user: {
			id: 'sdk-user',
			name: 'Teacher Demo',
			email: 'teacher@example.test',
			emailVerified: true,
			createdAt: now,
			updatedAt: now
		}
	} satisfies NonNullable<Awaited<ReturnType<typeof authClient.signIn.passkey>>['data']>;
	const activation = {
		id: 'sdk-passkey',
		userId: 'sdk-user',
		publicKey: 'fictional-public-key',
		credentialID: 'fictional-credential',
		counter: 0,
		deviceType: 'singleDevice',
		backedUp: false,
		createdAt: now,
		...signIn
	} satisfies NonNullable<Awaited<ReturnType<typeof authClient.passkey.addPasskey>>['data']>;
	it('accepts actual SDK success shapes, with wire timestamps and optional activation session fields', () => {
		expect(passkeySignInSchema.safeParse(signIn).success).toBe(true);
		expect(passkeySignInSchema.safeParse(JSON.parse(JSON.stringify(signIn))).success).toBe(true);
		expect(passkeyActivationSchema.safeParse(activation).success).toBe(true);
		const { session: _session, user: _user, ...withoutOptionalSession } = activation;
		void _session;
		void _user;
		expect(passkeyActivationSchema.safeParse(withoutOptionalSession).success).toBe(true);
	});
	it.each([{}, null, { success: true }, { session: {}, user: {} }, { id: 'sdk-passkey' }])(
		'does not confirm an empty or malformed SDK result: %j',
		(value) => {
			expect(passkeySignInSchema.safeParse(value).success).toBe(false);
			expect(passkeyActivationSchema.safeParse(value).success).toBe(false);
		}
	);
});
