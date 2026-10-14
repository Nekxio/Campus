import { error } from '@sveltejs/kit';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
	classes,
	modules,
	assessments,
	students,
	teachingContexts,
	correctionProposals,
	proposalDecisions
} from '../db/schema.js';
import { getGradeGrid, saveCorrection, saveSemesterComment } from './grading.js';
import { requireRosterEntry } from './roster.js';
import { blankCorrection } from '../../domain/grading.js';
import { importFingerprint } from '../../domain/module-import.js';
import {
	createProposalSchema,
	proposalDecisionSchema,
	type CreateProposal,
	type ProposalDecision,
	type ProposalDecisionReceipt,
	type ProposalReviewData,
	type ProposalReviewSelection,
	type ProposalReceipt,
	type CorrectionContext
} from '../../domain/proposals.js';

type Store = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;
const unavailable = (): never =>
	error(404, 'Cette proposition ou ce rattachement n’est plus disponible.');
const conflict = (): never =>
	error(
		409,
		'Les données ont changé. Vos saisies sont conservées ; relisez la version actuelle avant de réessayer.'
	);

async function contextData(db: Store, moduleId: string, contextId: string, studentId?: string) {
	const [context] = await db
		.select()
		.from(teachingContexts)
		.innerJoin(classes, eq(teachingContexts.classId, classes.id))
		.where(
			and(
				eq(teachingContexts.id, contextId),
				eq(teachingContexts.moduleId, moduleId),
				isNull(teachingContexts.archivedAt)
			)
		);
	if (!context) unavailable();
	if (studentId) await requireRosterEntry(db, contextId, studentId);
	const grid = await getGradeGrid(db, moduleId, contextId);
	return { context: context.teaching_context, rubric: grid.rubric!, members: grid.students };
}

// Only the roster and the selected student's corrections leave this read boundary.
export async function getCorrectionContext(
	db: Store,
	moduleId: string,
	contextId: string,
	studentId?: string
): Promise<CorrectionContext> {
	const { context, rubric, members } = await contextData(db, moduleId, contextId, studentId);
	const selected = members.find((s) => s.id === studentId);
	return {
		version: 1,
		moduleId,
		contextId,
		className: context.className,
		academicYear: context.academicYear,
		contextRevision: context.revision,
		rubricRevision: rubric.module.revision,
		assessments: rubric.assessments.map((a) => ({
			id: a.id,
			title: a.title,
			kind: a.kind,
			purpose: a.purpose,
			lines: a.lines.map((l) => ({
				...l,
				groupTitle: a.groups.find((g) => g.id === l.groupId)?.title ?? ''
			})),
			deadline:
				rubric.contexts
					.find((c) => c.id === contextId)
					?.deadlines.find((d) => d.assessmentId === a.id)?.dueAt ?? null
		})),
		students: members.map(({ id, name }) => ({ id, name })),
		student: selected
			? {
					id: selected.id,
					name: selected.name,
					corrections: selected.corrections,
					comment: selected.comment
				}
			: null
	};
}

function issues(selection: Omit<ProposalReviewSelection, 'pointsIssues' | 'commentIssues'>) {
	const { proposal, rubric, student, contextId, assessmentId } = selection;
	const payload = proposal.payload;
	if (!payload)
		return {
			pointsIssues: ['Cette ancienne proposition doit être régénérée avec le contexte actuel.'],
			commentIssues: ['Cette ancienne proposition ne peut être appliquée.']
		};
	const shared: string[] = [];
	if (payload.rubricRevision !== rubric.module.revision)
		shared.push('Le barème a changé depuis cette proposition.');
	if (payload.contextRevision !== rubric.contexts.find((c) => c.id === contextId)?.expectedRevision)
		shared.push('Le calendrier ou le rattachement de la classe a changé.');
	const assessment = rubric.assessments.find((a) => a.id === assessmentId);
	if (!assessment) shared.push('Cette évaluation a été retirée du barème.');
	else if (
		payload.scores.some(
			(s) =>
				!assessment.lines.some(
					(l) => l.id === s.lineId && (s.points === null || s.points <= l.maxPoints)
				)
		)
	)
		shared.push('Des critères ou leurs maxima ne correspondent plus.');
	const currentRevision =
		student.corrections.find((c) => c.assessmentId === assessmentId)?.revision ?? 0;
	const pointsIssues = [...shared];
	if (currentRevision !== payload.correctionRevision)
		pointsIssues.push('La correction enregistrée a changé depuis cette proposition.');
	const commentIssues = [...shared];
	if (currentRevision !== (proposal.appliedCorrectionRevision ?? payload.correctionRevision))
		commentIssues.push('La correction utilisée pour ce commentaire a changé.');
	if (payload.commentRevision !== undefined && student.comment.revision !== payload.commentRevision)
		commentIssues.push('Le commentaire enregistré a changé depuis cette proposition.');
	return {
		pointsIssues: proposal.state === 'pending' ? pointsIssues : [],
		commentIssues: proposal.commentState === 'pending' ? commentIssues : []
	};
}

async function selection(db: Store, id: string): Promise<ProposalReviewSelection> {
	const [row] = await db.select().from(correctionProposals).where(eq(correctionProposals.id, id));
	if (!row) unavailable();
	const [context] = await db
		.select()
		.from(teachingContexts)
		.where(eq(teachingContexts.id, row.contextId));
	if (!context || (row.payload.version === 2 && row.payload.moduleId !== context.moduleId))
		unavailable();
	const { rubric, members } = await contextData(db, context.moduleId, row.contextId, row.studentId);
	const student = members.find((s) => s.id === row.studentId)!;
	const value = {
		proposal: {
			id: row.id,
			revision: row.revision,
			state: row.state,
			commentState: row.commentState,
			createdAt: row.createdAt.toISOString(),
			payload: row.payload.version === 2 ? row.payload : null,
			legacy: row.payload.version !== 2,
			appliedCorrectionRevision: row.appliedCorrectionRevision
		},
		rubric,
		student,
		contextId: row.contextId,
		assessmentId: row.payload.assessmentId
	};
	return { ...value, ...issues(value) };
}

export async function getProposalReview(
	db: Store,
	proposalId?: string,
	contextId?: string
): Promise<ProposalReviewData> {
	const assessmentId = sql<string>`json_extract(${correctionProposals.payload}, ${'$.assessmentId'})`;
	const rows = await db
		.select({
			proposal: {
				id: correctionProposals.id,
				revision: correctionProposals.revision,
				state: correctionProposals.state,
				commentState: correctionProposals.commentState,
				createdAt: correctionProposals.createdAt
			},
			student: { id: students.id, name: students.name },
			context: {
				id: teachingContexts.id,
				moduleId: teachingContexts.moduleId,
				className: teachingContexts.className,
				academicYear: teachingContexts.academicYear
			},
			assessmentId,
			assessmentTitle: assessments.title,
			moduleTitle: modules.title
		})
		.from(correctionProposals)
		.innerJoin(students, and(eq(correctionProposals.studentId, students.id)))
		.innerJoin(
			teachingContexts,
			and(
				eq(correctionProposals.contextId, teachingContexts.id),
				eq(students.classId, teachingContexts.classId)
			)
		)
		.leftJoin(modules, eq(teachingContexts.moduleId, modules.id))
		.leftJoin(
			assessments,
			and(
				eq(assessments.id, assessmentId),
				eq(assessments.moduleId, teachingContexts.moduleId),
				isNull(assessments.retiredAt)
			)
		)
		.where(
			and(
				isNull(teachingContexts.archivedAt),
				...(contextId ? [eq(teachingContexts.id, contextId)] : []),
				or(
					eq(correctionProposals.state, 'pending'),
					eq(correctionProposals.commentState, 'pending')
				)
			)
		)
		.orderBy(asc(correctionProposals.createdAt), asc(correctionProposals.id));
	const queue = rows.map(
		({ proposal: p, student, context, assessmentId, assessmentTitle, moduleTitle }) => {
			const currentModuleTitle = moduleTitle ?? unavailable();
			return {
				id: p.id,
				revision: p.revision,
				state: p.state,
				commentState: p.commentState,
				studentId: student.id,
				studentName: student.name,
				assessmentId,
				assessmentTitle: assessmentTitle ?? 'Évaluation retirée',
				moduleId: context.moduleId,
				moduleTitle: currentModuleTitle,
				contextId: context.id,
				className: context.className,
				academicYear: context.academicYear,
				createdAt: p.createdAt.toISOString()
			};
		}
	);
	const chosen = proposalId ?? queue[0]?.id;
	const selected = chosen ? await selection(db, chosen) : null;
	if (selected && contextId && selected.contextId !== contextId) unavailable();
	return { queue, selected };
}

export async function createCorrectionProposal(
	db: Pick<Database, 'transaction'>,
	teacherId: string,
	value: CreateProposal
): Promise<ProposalReceipt> {
	const parsed = createProposalSchema.safeParse(value);
	if (!parsed.success) error(422, 'Vérifiez les points et les références de la proposition.');
	const input = parsed.data;
	const fingerprint = await importFingerprint(input);
	return db.transaction(async (tx) => {
		const [replay] = await tx
			.select()
			.from(correctionProposals)
			.where(
				and(
					eq(correctionProposals.teacherId, teacherId),
					eq(correctionProposals.requestId, input.requestId)
				)
			);
		if (replay) {
			if (replay.fingerprint !== fingerprint || !replay.receipt) conflict();
			return replay.receipt!;
		}
		if (
			(
				await tx
					.select({ id: correctionProposals.id })
					.from(correctionProposals)
					.where(eq(correctionProposals.id, input.proposalId))
			).length
		)
			conflict();
		const p = input.payload;
		const { context, rubric, members } = await contextData(
			tx,
			p.moduleId,
			p.contextId,
			p.studentId
		);
		const student = members.find((s) => s.id === p.studentId)!;
		const assessment = rubric.assessments.find((a) => a.id === p.assessmentId);
		if (
			!assessment ||
			p.scores.some(
				(s) =>
					!assessment.lines.some(
						(l) => l.id === s.lineId && (s.points === null || s.points <= l.maxPoints)
					)
			)
		)
			error(422, 'Les critères ou leurs points ne correspondent pas à cette évaluation.');
		if (
			rubric.module.revision !== p.rubricRevision ||
			context.revision !== p.contextRevision ||
			(student.corrections.find((c) => c.assessmentId === p.assessmentId)?.revision ?? 0) !==
				p.correctionRevision ||
			(p.commentRevision !== undefined && student.comment.revision !== p.commentRevision)
		)
			conflict();
		const receipt = {
			version: 1 as const,
			requestId: input.requestId,
			proposalId: input.proposalId,
			editorPath: '/enseignant/propositions?proposition=' + input.proposalId
		};
		await tx.insert(correctionProposals).values({
			id: input.proposalId,
			contextId: p.contextId,
			studentId: p.studentId,
			payload: p,
			teacherId,
			requestId: input.requestId,
			fingerprint,
			receipt,
			commentState: p.semesterComment === undefined ? 'none' : 'pending'
		});
		return receipt;
	});
}

export async function decideCorrectionProposal(
	db: Pick<Database, 'transaction'>,
	proposalId: string,
	value: ProposalDecision
): Promise<ProposalDecisionReceipt> {
	const parsed = proposalDecisionSchema.safeParse(value);
	if (!parsed.success) error(422, 'Vérifiez les champs de la décision.');
	const input = parsed.data;
	const fingerprint = await importFingerprint(input);
	return db.transaction(async (tx) => {
		const [replay] = await tx
			.select()
			.from(proposalDecisions)
			.where(
				and(
					eq(proposalDecisions.proposalId, proposalId),
					eq(proposalDecisions.requestId, input.requestId)
				)
			);
		if (replay) {
			if (replay.fingerprint !== fingerprint) conflict();
			return replay.receipt;
		}
		const current = await selection(tx, proposalId);
		const { proposal, student, rubric, contextId, assessmentId } = current;
		if (proposal.revision !== input.expectedRevision) conflict();
		let state = proposal.state,
			commentState = proposal.commentState;
		let appliedCorrectionRevision = proposal.appliedCorrectionRevision;
		if (input.action === 'accept_points') {
			if (state !== 'pending' || current.pointsIssues.length) conflict();
			if (input.status.startsWith('absent_'))
				error(
					422,
					'Pour retenir ces points, choisissez « À évaluer » ou « Noté ». Les absences conservent les points enregistrés.'
				);
			const baseline =
				student.corrections.find((c) => c.assessmentId === assessmentId) ??
				blankCorrection(assessmentId, rubric.module.revision);
			const saved = await saveCorrection(tx, contextId, student.id, assessmentId, {
				expectedRevision: baseline.revision,
				rubricRevision: rubric.module.revision,
				status: input.status,
				scores: input.scores,
				submissionUrl: baseline.submissionUrl,
				submittedAt: baseline.submittedAt,
				latenessDecision: baseline.latenessDecision
			});
			appliedCorrectionRevision = saved.corrections.find(
				(c) => c.assessmentId === assessmentId
			)!.revision;
			state = 'accepted';
		} else if (input.action === 'reject') {
			if (state !== 'pending') conflict();
			state = 'rejected';
			if (commentState === 'pending') commentState = 'kept';
		} else if (input.action === 'accept_comment') {
			if (commentState !== 'pending' || current.commentIssues.length) conflict();
			await saveSemesterComment(tx, contextId, student.id, {
				expectedRevision: student.comment.revision,
				content: input.content
			});
			commentState = 'accepted';
		} else {
			if (commentState !== 'pending') conflict();
			commentState = 'kept';
		}
		const receipt = { id: proposalId, revision: proposal.revision + 1, state, commentState };
		const claimed = await tx
			.update(correctionProposals)
			.set({ state, commentState, revision: receipt.revision, appliedCorrectionRevision })
			.where(
				and(
					eq(correctionProposals.id, proposalId),
					eq(correctionProposals.revision, proposal.revision)
				)
			)
			.returning({ id: correctionProposals.id });
		if (!claimed.length) conflict();
		await tx
			.insert(proposalDecisions)
			.values({ proposalId, requestId: input.requestId, fingerprint, receipt });
		return receipt;
	});
}
