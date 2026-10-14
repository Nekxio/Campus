import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { drizzle } from 'drizzle-orm/libsql/web';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import * as tables from '../db/schema.js';
import {
	getCorrectionContext,
	createCorrectionProposal,
	getProposalReview,
	decideCorrectionProposal
} from './proposals.js';
import {
	getGradeGrid,
	saveCorrection,
	saveSemesterComment,
	getRubric,
	replaceRubric
} from './grading.js';
import type { CreateProposal, ProposalDecision } from '../../domain/proposals.js';

let client: Client,
	db: Database,
	ids: Awaited<ReturnType<typeof seedFoundationFixtures>>,
	input: CreateProposal;
let queries: string[];
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	queries = [];
	db = drizzle(client, { schema: tables, logger: { logQuery: (query) => queries.push(query) } });
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedFoundationFixtures(db);
	const context = await getCorrectionContext(db, ids.module, ids.currentContext, ids.students[0]);
	input = {
		requestId: crypto.randomUUID(),
		proposalId: crypto.randomUUID(),
		payload: {
			version: 2,
			moduleId: ids.module,
			contextId: ids.currentContext,
			studentId: ids.students[0],
			assessmentId: ids.project,
			rubricRevision: context.rubricRevision,
			contextRevision: context.contextRevision,
			correctionRevision: context.student!.corrections.find((c) => c.assessmentId === ids.project)!
				.revision,
			scores: [{ lineId: ids.firstLine, points: 9 }],
			semesterComment: 'Proposition privée.',
			commentRevision: 0
		}
	};
});
afterEach(() => client.close());
const deposit = () => createCorrectionProposal(db, ids.teacher, input);
const decision = (action: ProposalDecision['action'], expectedRevision = 1): ProposalDecision => {
	const base = { requestId: crypto.randomUUID(), expectedRevision };
	return action === 'accept_points'
		? {
				...base,
				action,
				status: 'graded',
				scores: [
					{ lineId: ids.firstLine, points: 9 },
					{ lineId: ids.secondLine, points: 7 }
				]
			}
		: action === 'accept_comment'
			? { ...base, action, content: 'Commentaire ajusté.' }
			: { ...base, action };
};
async function current() {
	return (await getGradeGrid(db, ids.module, ids.currentContext)).students[0];
}
async function manuallyChange(points = 6) {
	const student = await current();
	const c = student.corrections.find((c) => c.assessmentId === ids.project)!;
	const { assessmentId, revision, ...fields } = c;
	return saveCorrection(db, ids.currentContext, student.id, assessmentId, {
		...fields,
		expectedRevision: revision,
		scores: c.scores.map((s) => ({ ...s, points }))
	});
}

const queueDate = new Date('2026-10-13T12:00:00Z');
async function measuredReview(proposalId = input.proposalId, contextId?: string) {
	queries = [];
	const review = await getProposalReview(db, proposalId, contextId);
	return { review, selects: queries.filter((query) => /^\s*select\b/i.test(query)).length };
}
async function additionalModuleProposal(index: number) {
	const moduleId = index === 1 ? ids.secondModule : crypto.randomUUID();
	const contextId = index === 1 ? ids.secondContext : crypto.randomUUID();
	if (index !== 1) {
		await db.insert(tables.modules).values({ id: moduleId, title: `Module fictif ${index}` });
		await db.insert(tables.teachingContexts).values({
			id: contextId,
			moduleId,
			classId: ids.currentClass,
			className: 'B2 Demo',
			academicYear: '2026-2027'
		});
	}
	const rubric = await getRubric(db, moduleId);
	const assessmentId = crypto.randomUUID(),
		groupId = crypto.randomUUID(),
		lineId = crypto.randomUUID();
	await replaceRubric(db, moduleId, {
		expectedRevision: rubric.module.revision,
		assessments: [
			{
				id: assessmentId,
				title: `Évaluation fictive ${index}`,
				kind: 'other',
				purpose: 'graded',
				groups: [{ id: groupId, title: 'Points' }],
				lines: [{ id: lineId, groupId, label: 'Critère fictif', description: '', maxPoints: 10 }]
			}
		],
		results: [],
		contexts: rubric.contexts.map(({ id, expectedRevision }) => ({
			id,
			expectedRevision,
			deadlines: []
		}))
	});
	const context = await getCorrectionContext(db, moduleId, contextId, ids.students[0]);
	const proposalId = crypto.randomUUID();
	await createCorrectionProposal(db, ids.teacher, {
		proposalId,
		requestId: crypto.randomUUID(),
		payload: {
			version: 2,
			moduleId,
			contextId,
			studentId: ids.students[0],
			assessmentId,
			rubricRevision: context.rubricRevision,
			contextRevision: context.contextRevision,
			correctionRevision: 0,
			scores: [{ lineId, points: 5 }]
		}
	});
	return { moduleId, contextId, assessmentId, proposalId };
}

describe('Proposal queue metadata and query growth', () => {
	it('keeps SELECT count constant for one and twelve proposals sharing a module', async () => {
		await deposit();
		const one = await measuredReview();
		const proposalIds = [input.proposalId];
		for (let index = 1; index < 12; index++) {
			const proposalId = crypto.randomUUID();
			await createCorrectionProposal(db, ids.teacher, {
				...input,
				proposalId,
				requestId: crypto.randomUUID()
			});
			proposalIds.push(proposalId);
		}
		await db.update(tables.correctionProposals).set({ createdAt: queueDate });
		const earlier = proposalIds[7];
		await db
			.update(tables.correctionProposals)
			.set({ createdAt: new Date(queueDate.getTime() - 1000) })
			.where(eq(tables.correctionProposals.id, earlier));
		const twelve = await measuredReview();
		expect(twelve.review.queue.map((proposal) => proposal.id)).toEqual([
			earlier,
			...proposalIds.filter((id) => id !== earlier).sort()
		]);
		expect(twelve.review.selected!.proposal.id).toBe(input.proposalId);
		expect(twelve.selects - one.selects).toBe(0);
	});
	it('keeps SELECT count constant across twelve distinct modules', async () => {
		await deposit();
		const one = await measuredReview();
		for (let index = 1; index < 12; index++) await additionalModuleProposal(index);
		const twelve = await measuredReview();
		expect(new Set(twelve.review.queue.map((proposal) => proposal.moduleId)).size).toBe(12);
		expect(twelve.selects - one.selects).toBe(0);
	});
	it('preserves the exact queue projection, comment-only pending rows and context isolation', async () => {
		await deposit();
		await decideCorrectionProposal(db, input.proposalId, decision('accept_points'));
		const foreign = await additionalModuleProposal(1);
		await db.update(tables.correctionProposals).set({ createdAt: queueDate });
		const review = await getProposalReview(db, input.proposalId, ids.currentContext);
		expect(review.queue).toEqual([
			{
				id: input.proposalId,
				revision: 2,
				state: 'accepted',
				commentState: 'pending',
				studentId: ids.students[0],
				studentName: 'Student Demo 1',
				assessmentId: ids.project,
				assessmentTitle: 'Project Demo',
				moduleId: ids.module,
				moduleTitle: 'Demo · Application web',
				contextId: ids.currentContext,
				className: 'B2 Demo',
				academicYear: '2026-2027',
				createdAt: queueDate.toISOString()
			}
		]);
		const other = await getProposalReview(db, foreign.proposalId, foreign.contextId);
		expect(other.queue.map((proposal) => proposal.id)).toEqual([foreign.proposalId]);
		await expect(
			getProposalReview(db, foreign.proposalId, ids.currentContext)
		).rejects.toMatchObject({ status: 404 });
	});
	it('retains the removed assessment fallback and its selected-proposal warning', async () => {
		await deposit();
		await db
			.update(tables.assessments)
			.set({ retiredAt: queueDate })
			.where(eq(tables.assessments.id, ids.project));
		const review = await getProposalReview(db, input.proposalId);
		expect(review.queue[0].assessmentTitle).toBe('Évaluation retirée');
		expect(review.selected!.pointsIssues).toContain('Cette évaluation a été retirée du barème.');
	});
	it('never borrows an assessment title from another module', async () => {
		await deposit();
		const foreign = await additionalModuleProposal(1);
		await db
			.update(tables.correctionProposals)
			.set({
				payload: { ...input.payload, assessmentId: foreign.assessmentId }
			})
			.where(eq(tables.correctionProposals.id, input.proposalId));
		const review = await getProposalReview(db, input.proposalId);
		expect(review.queue.find((proposal) => proposal.id === input.proposalId)).toMatchObject({
			moduleId: ids.module,
			assessmentId: foreign.assessmentId,
			assessmentTitle: 'Évaluation retirée'
		});
		expect(
			review.queue.find((proposal) => proposal.id === foreign.proposalId)!.assessmentTitle
		).toBe('Évaluation fictive 1');
		expect(review.selected!.pointsIssues).toContain('Cette évaluation a été retirée du barème.');
	});
	it('returns an empty queue and still selects an explicit already-decided proposal', async () => {
		expect(await getProposalReview(db)).toEqual({ queue: [], selected: null });
		expect(await getProposalReview(db, undefined, crypto.randomUUID())).toEqual({
			queue: [],
			selected: null
		});
		await deposit();
		await decideCorrectionProposal(db, input.proposalId, decision('reject'));
		expect(await getProposalReview(db)).toEqual({ queue: [], selected: null });
		const review = await getProposalReview(db, input.proposalId);
		expect(review.queue).toEqual([]);
		expect(review.selected!.proposal).toMatchObject({
			id: input.proposalId,
			state: 'rejected',
			commentState: 'kept'
		});
		await expect(getProposalReview(db, crypto.randomUUID())).rejects.toMatchObject({ status: 404 });
	});
	it.each(['module', 'roster', 'context'] as const)(
		'preserves selected-proposal rejection for invalid %s scope',
		async (kind) => {
			await deposit();
			if (kind === 'module')
				await db
					.update(tables.correctionProposals)
					.set({ payload: { ...input.payload, moduleId: ids.secondModule } })
					.where(eq(tables.correctionProposals.id, input.proposalId));
			if (kind === 'roster')
				await db
					.update(tables.correctionProposals)
					.set({ studentId: ids.oldStudent })
					.where(eq(tables.correctionProposals.id, input.proposalId));
			if (kind === 'context')
				await db
					.update(tables.correctionProposals)
					.set({ contextId: ids.oldContext })
					.where(eq(tables.correctionProposals.id, input.proposalId));
			await expect(getProposalReview(db, input.proposalId)).rejects.toMatchObject({ status: 404 });
		}
	);
	it('fails closed for a missing queue module instead of silently omitting its proposal', async () => {
		await deposit();
		// Deliberately corrupt only this isolated fictional database to exercise the read boundary.
		await client.execute('PRAGMA foreign_keys = OFF');
		await db.delete(tables.modules).where(eq(tables.modules.id, ids.module));
		await expect(getProposalReview(db)).rejects.toMatchObject({ status: 404 });
	});
});

describe('Correction proposals remain separate from teacher results', () => {
	it('returns exact roster and only the selected student’s results, excluding archived years and unrelated modules', async () => {
		const roster = await getCorrectionContext(db, ids.module, ids.currentContext);
		expect(roster.students).toHaveLength(12);
		expect(roster.student).toBeNull();
		expect(JSON.stringify(roster)).not.toContain(ids.oldStudent);
		await expect(
			getCorrectionContext(db, ids.secondModule, ids.currentContext)
		).rejects.toMatchObject({ status: 404 });
		await expect(
			getCorrectionContext(db, ids.module, ids.oldContext, ids.oldStudent)
		).rejects.toMatchObject({ status: 404 });
		await expect(
			getCorrectionContext(db, ids.module, ids.currentContext, ids.oldStudent)
		).rejects.toMatchObject({ status: 404 });
	});
	it('deposits partial points and optional comment without modifying any score, submission or comment', async () => {
		const before = await current();
		const receipt = await deposit();
		expect(receipt.editorPath).toContain(input.proposalId);
		expect(await current()).toEqual(before);
		const review = await getProposalReview(db, input.proposalId);
		expect(review.queue).toHaveLength(1);
		expect(review.selected!.pointsIssues).toEqual([]);
		expect(review.selected!.proposal).toMatchObject({
			state: 'pending',
			commentState: 'pending',
			revision: 1
		});
	});
	it('recovers the original receipt after acceptance and a rubric change, refusing reused IDs with a different body', async () => {
		const receipt = await deposit();
		await decideCorrectionProposal(db, input.proposalId, decision('accept_points'));
		await db.update(tables.modules).set({ revision: 2 }).where(eq(tables.modules.id, ids.module));
		expect(await deposit()).toEqual(receipt);
		await expect(
			createCorrectionProposal(db, ids.teacher, {
				...input,
				payload: { ...input.payload, scores: [{ lineId: ids.firstLine, points: 3 }] }
			})
		).rejects.toMatchObject({ status: 409 });
		await expect(
			createCorrectionProposal(db, ids.teacher, { ...input, requestId: crypto.randomUUID() })
		).rejects.toMatchObject({ status: 409 });
	});
	it.each([
		'decimal',
		'over_max',
		'foreign_line',
		'duplicate_line',
		'foreign_assessment',
		'foreign_student',
		'wrong_module'
	])('rejects %s without recording a proposal', async (kind) => {
		const p = structuredClone(input);
		if (kind === 'decimal') p.payload.scores[0].points = 1.5;
		if (kind === 'over_max') p.payload.scores[0].points = 11;
		if (kind === 'foreign_line') p.payload.scores[0].lineId = crypto.randomUUID();
		if (kind === 'duplicate_line') p.payload.scores.push({ ...p.payload.scores[0] });
		if (kind === 'foreign_assessment') p.payload.assessmentId = crypto.randomUUID();
		if (kind === 'foreign_student') p.payload.studentId = ids.oldStudent;
		if (kind === 'wrong_module') p.payload.moduleId = ids.secondModule;
		await expect(createCorrectionProposal(db, ids.teacher, p)).rejects.toMatchObject({
			status: ['foreign_student', 'wrong_module'].includes(kind) ? 404 : 422
		});
		expect(
			(await db.select().from(tables.correctionProposals)).filter((p) => p.id === input.proposalId)
		).toEqual([]);
	});
	it.each(['rubric', 'context', 'correction', 'comment'])(
		'blocks a stale %s baseline before deposit and on review/application',
		async (kind) => {
			await deposit();
			if (kind === 'rubric')
				await db
					.update(tables.modules)
					.set({ revision: 2 })
					.where(eq(tables.modules.id, ids.module));
			if (kind === 'context')
				await db
					.update(tables.teachingContexts)
					.set({ revision: 2 })
					.where(eq(tables.teachingContexts.id, ids.currentContext));
			if (kind === 'correction') await manuallyChange();
			if (kind === 'comment')
				await saveSemesterComment(db, ids.currentContext, ids.students[0], {
					expectedRevision: 0,
					content: 'Manuel'
				});
			const freshIds = {
				...input,
				requestId: crypto.randomUUID(),
				proposalId: crypto.randomUUID()
			};
			await expect(createCorrectionProposal(db, ids.teacher, freshIds)).rejects.toMatchObject({
				status: 409
			});
			const review = (await getProposalReview(db, input.proposalId)).selected!;
			expect(
				kind === 'comment' ? review.commentIssues.length : review.pointsIssues.length
			).toBeGreaterThan(0);
			await expect(
				decideCorrectionProposal(
					db,
					input.proposalId,
					decision(kind === 'comment' ? 'accept_comment' : 'accept_points')
				)
			).rejects.toMatchObject({ status: 409 });
			// Refusal remains possible, even when the underlying data changed.
			expect(
				await decideCorrectionProposal(db, input.proposalId, decision('reject'))
			).toMatchObject({ state: 'rejected' });
		}
	);
	it('accepts retained points then independently accepts an edited comment, preserving submission and other assessments', async () => {
		const before = await current();
		await deposit();
		const receipt = await decideCorrectionProposal(db, input.proposalId, decision('accept_points'));
		expect(receipt).toMatchObject({ revision: 2, state: 'accepted', commentState: 'pending' });
		const after = await current();
		const saved = after.corrections.find((c) => c.assessmentId === ids.project)!;
		expect(saved).toMatchObject({
			submissionUrl: before.corrections[0].submissionUrl,
			submittedAt: before.corrections[0].submittedAt,
			latenessDecision: before.corrections[0].latenessDecision
		});
		expect(saved.scores).toEqual(
			expect.arrayContaining([
				{ lineId: ids.firstLine, points: 9 },
				{ lineId: ids.secondLine, points: 7 }
			])
		);
		expect(after.comment).toEqual(before.comment);
		expect((await getProposalReview(db, input.proposalId)).selected!).toMatchObject({
			pointsIssues: [],
			commentIssues: []
		});
		await decideCorrectionProposal(db, input.proposalId, decision('accept_comment', 2));
		expect((await current()).comment).toEqual({ revision: 1, content: 'Commentaire ajusté.' });
	});
	it('can keep the comment separately, and refuse points without undoing an explicitly accepted comment', async () => {
		await deposit();
		await decideCorrectionProposal(db, input.proposalId, decision('accept_comment'));
		const before = await current();
		expect(
			await decideCorrectionProposal(db, input.proposalId, decision('reject', 2))
		).toMatchObject({ state: 'rejected', commentState: 'accepted' });
		expect(await current()).toEqual(before);
		const next = {
			...input,
			proposalId: crypto.randomUUID(),
			requestId: crypto.randomUUID(),
			payload: { ...input.payload, commentRevision: 1 }
		};
		await createCorrectionProposal(db, ids.teacher, next);
		expect(
			await decideCorrectionProposal(db, next.proposalId, decision('keep_comment'))
		).toMatchObject({ state: 'pending', commentState: 'kept' });
		expect(await current()).toEqual(before);
	});
	it('retries a decision without reapplying it after a later manual correction, and rejects altered replay bodies', async () => {
		await deposit();
		const action = decision('accept_points');
		const receipt = await decideCorrectionProposal(db, input.proposalId, action);
		await manuallyChange(4);
		const manuallySaved = await current();
		expect(await decideCorrectionProposal(db, input.proposalId, action)).toEqual(receipt);
		expect(await current()).toEqual(manuallySaved);
		await expect(
			decideCorrectionProposal(db, input.proposalId, { ...action, expectedRevision: 2 })
		).rejects.toMatchObject({ status: 409 });
		expect(
			(await getProposalReview(db, input.proposalId)).selected!.commentIssues.length
		).toBeGreaterThan(0);
	});
	it('rolls back malformed retained scores and rejects stale decisions, keeping the proposal pending', async () => {
		await deposit();
		const before = await current();
		const action = decision('accept_points');
		if (action.action !== 'accept_points') throw new Error();
		await expect(
			decideCorrectionProposal(db, input.proposalId, {
				...action,
				scores: [{ lineId: ids.firstLine, points: 9 }]
			})
		).rejects.toMatchObject({ status: 422 });
		await expect(
			decideCorrectionProposal(db, input.proposalId, { ...action, status: 'absent_justified' })
		).rejects.toMatchObject({ status: 422 });
		await expect(
			decideCorrectionProposal(db, input.proposalId, decision('reject', 2))
		).rejects.toMatchObject({ status: 409 });
		expect(await current()).toEqual(before);
		expect(await db.select().from(tables.proposalDecisions)).toHaveLength(0);
		expect((await getProposalReview(db, input.proposalId)).selected!.proposal.state).toBe(
			'pending'
		);
	});
	it('accepts a null draft against revision zero, with no comment decision', async () => {
		const p = {
			...input,
			payload: {
				...input.payload,
				studentId: ids.students[1],
				correctionRevision: 0,
				scores: [{ lineId: ids.firstLine, points: null }],
				semesterComment: undefined,
				commentRevision: undefined
			}
		};
		await createCorrectionProposal(db, ids.teacher, p);
		expect((await getProposalReview(db, p.proposalId)).selected!.proposal.commentState).toBe(
			'none'
		);
		const action = decision('accept_points');
		if (action.action !== 'accept_points') throw new Error();
		await decideCorrectionProposal(db, p.proposalId, {
			...action,
			status: 'to_evaluate',
			scores: [
				{ lineId: ids.firstLine, points: null },
				{ lineId: ids.secondLine, points: 6 }
			]
		});
		expect(
			(await getGradeGrid(db, ids.module, ids.currentContext)).students[1].corrections[0].scores
		).toEqual(expect.arrayContaining([{ lineId: ids.firstLine, points: null }]));
	});
	it('keeps legacy proposals consultable and refuses them without applying scores', async () => {
		const [legacy] = await db.select().from(tables.correctionProposals);
		await db
			.update(tables.correctionProposals)
			.set({
				contextId: ids.currentContext,
				studentId: ids.students[0],
				payload: {
					version: 1,
					contextId: ids.currentContext,
					studentId: ids.students[0],
					assessmentId: ids.project,
					rubricRevision: 1,
					correctionRevision: 1,
					scores: [{ lineId: ids.firstLine, points: 9 }]
				}
			})
			.where(eq(tables.correctionProposals.id, legacy.id));
		const before = await current();
		const review = (await getProposalReview(db, legacy.id)).selected!;
		expect(review.proposal.legacy).toBe(true);
		expect(review.proposal.payload).toBeNull();
		await expect(
			decideCorrectionProposal(db, legacy.id, decision('accept_points'))
		).rejects.toMatchObject({ status: 409 });
		expect(await decideCorrectionProposal(db, legacy.id, decision('reject'))).toMatchObject({
			state: 'rejected'
		});
		expect(await current()).toEqual(before);
	});
	it('purges proposals and decision receipts with the annual class, preserving the reusable module and rubric', async () => {
		await deposit();
		await decideCorrectionProposal(db, input.proposalId, decision('accept_points'));
		await db.delete(tables.classes).where(eq(tables.classes.id, ids.currentClass));
		expect(await db.select().from(tables.proposalDecisions)).toEqual([]);
		expect(
			(await db.select().from(tables.correctionProposals)).some((p) => p.id === input.proposalId)
		).toBe(false);
		expect((await getRubric(db, ids.module)).assessments).toHaveLength(3);
		await expect(getProposalReview(db, input.proposalId)).rejects.toMatchObject({ status: 404 });
	});
});
