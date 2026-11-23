import { error } from '@sveltejs/kit';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../db/index.js';
import {
	assessments,
	corrections,
	lessons,
	quizDraftReceipts,
	quizDrafts,
	quizGradeReceipts,
	quizGradeReports,
	quizRuns,
	rubricLines,
	scores,
	students,
	teachingContexts
} from '../db/schema.js';
import {
	mergeQuizContentPatch,
	quizArchiveSchema,
	quizArchiveReceiptSchema,
	quizDraftPatchSchema,
	quizDraftReceiptSchema,
	quizDraftSchema,
	quizDraftWriteSchema,
	quizGradeReceiptSchema,
	quizGradeWriteSchema,
	type QuizArchive,
	type QuizArchiveReceipt,
	type QuizDraft,
	type QuizDraftPatch,
	type QuizDraftReceipt,
	type QuizDraftWrite,
	type QuizGradeReceipt,
	type QuizGradeWrite
} from '../../domain/quiz-content.js';
import { idSchema } from '../../domain/contracts.js';
import { importFingerprint } from '../../domain/module-import.js';
import { requireActiveYear } from './annual-access.js';
import { requireRosterEntry } from './roster.js';

type Store = Pick<Database, 'select' | 'insert' | 'update'>;
type DraftOptions = { markForReview?: boolean };
const conflict: () => never = () => error(409, 'Les références du quiz ont changé. Actualisez avant de réessayer.');
const unavailable: () => never = () => error(404, 'Ce quiz est indisponible.');
const validated = <S extends z.ZodType>(schema: S, value: unknown): z.output<S> => {
	const parsed = schema.safeParse(value);
	if (!parsed.success) error(422, 'Vérifiez les questions, les réponses et les références du quiz.');
	return parsed.data;
};

export const getQuizDraft = async (db: Pick<Database, 'select'>, id: string): Promise<QuizDraft> => {
	if (!idSchema.safeParse(id).success) unavailable();
	const [record] = await db.select().from(quizDrafts).where(eq(quizDrafts.id, id));
	if (!record) unavailable();
	return quizDraftSchema.parse({
		id: record.id,
		moduleId: record.moduleId,
		contextId: record.contextId,
		lessonId: record.lessonId,
		assessmentId: record.assessmentId,
		lineId: record.lineId,
		revision: record.revision,
		needsReview: record.needsReview,
		archived: record.archived,
		content: record.content
	});
};

export const listQuizDrafts = async (
	db: Pick<Database, 'select'>,
	moduleId: string,
	contextId?: string
): Promise<QuizDraft[]> => {
	validated(idSchema, moduleId);
	if (contextId) validated(idSchema, contextId);
	const records = await db
		.select({ id: quizDrafts.id })
		.from(quizDrafts)
		.where(and(eq(quizDrafts.moduleId, moduleId), ...(contextId ? [eq(quizDrafts.contextId, contextId)] : [])))
		.orderBy(asc(quizDrafts.createdAt), asc(quizDrafts.id));
	return Promise.all(records.map((record) => getQuizDraft(db, record.id)));
};

const requireQuizContext = async (db: Store, contextId: string, moduleId: string) => {
	const [context] = await db.select().from(teachingContexts).where(eq(teachingContexts.id, contextId));
	if (!context || context.moduleId !== moduleId) error(422, 'Choisissez le contexte exact de ce module.');
	if (context.archivedAt || !context.classId) conflict();
	await requireActiveYear(db, context.academicYear);
	return context;
};

const requireQuizLine = async (
	db: Store,
	quiz: Pick<QuizDraftWrite, 'moduleId' | 'assessmentId' | 'lineId'>,
	maxPoints: number,
	status = 422
) => {
	const [row] = await db
		.select({ line: rubricLines, assessment: assessments })
		.from(rubricLines)
		.innerJoin(assessments, eq(assessments.id, rubricLines.assessmentId))
		.where(
			and(
				eq(rubricLines.id, quiz.lineId),
				eq(assessments.id, quiz.assessmentId),
				eq(assessments.moduleId, quiz.moduleId)
			)
		);
	if (
		!row ||
		row.line.retiredAt ||
		row.assessment.retiredAt ||
		row.assessment.kind !== 'quiz' ||
		row.assessment.purpose !== 'graded' ||
		row.line.maxPoints !== maxPoints
	)
		error(status, 'La ligne du quiz doit appartenir à sa section notée et avoir un point par question.');
	return row;
};

const writeDraft = async (
	db: Store,
	teacherId: string,
	input: QuizDraftWrite,
	fingerprint: string,
	options: DraftOptions
): Promise<QuizDraftReceipt> => {
	const [previous] = await db.select().from(quizDrafts).where(eq(quizDrafts.id, input.id));
	if ((previous?.revision ?? 0) !== input.expectedRevision) conflict();
	if (previous?.archived) error(409, 'Restaurez ce quiz avant de le modifier.');
	await requireQuizContext(db, input.contextId, input.moduleId);
	const [lesson] = await db.select().from(lessons).where(eq(lessons.id, input.lessonId));
	if (!lesson || lesson.contextId !== input.contextId) error(422, 'Choisissez une séance de ce contexte.');
	await requireQuizLine(db, input, input.content.questions.length);
	const [other] = await db
		.select({ id: quizDrafts.id })
		.from(quizDrafts)
		.where(and(eq(quizDrafts.contextId, input.contextId), eq(quizDrafts.lineId, input.lineId)));
	if (other && other.id !== input.id) conflict();
	if (previous) {
		const [run] = await db.select({ id: quizRuns.id }).from(quizRuns).where(eq(quizRuns.quizId, input.id)).limit(1);
		if (run) conflict();
	}
	const values = {
		moduleId: input.moduleId,
		contextId: input.contextId,
		lessonId: input.lessonId,
		assessmentId: input.assessmentId,
		lineId: input.lineId,
		content: input.content,
		needsReview: options.markForReview ?? false,
		revision: input.expectedRevision + 1
	};
	if (previous) {
		const changed = await db
			.update(quizDrafts)
			.set(values)
			.where(and(eq(quizDrafts.id, input.id), eq(quizDrafts.revision, input.expectedRevision)))
			.returning({ id: quizDrafts.id });
		if (!changed.length) conflict();
	} else {
		await db.insert(quizDrafts).values({ id: input.id, ...values });
	}
	const receipt = quizDraftReceiptSchema.parse({
		requestId: input.requestId,
		quizId: input.id,
		revision: values.revision
	});
	await db
		.insert(quizDraftReceipts)
		.values({ teacherId, requestId: input.requestId, quizId: input.id, fingerprint, receipt });
	return receipt;
};

const replayDraft = async <T>(
	db: Store,
	teacherId: string,
	requestId: string,
	fingerprint: string,
	schema: z.ZodType<T>
) => {
	const [saved] = await db
		.select()
		.from(quizDraftReceipts)
		.where(and(eq(quizDraftReceipts.teacherId, teacherId), eq(quizDraftReceipts.requestId, requestId)));
	if (!saved) return null;
	if (saved.fingerprint !== fingerprint) conflict();
	return schema.parse(saved.receipt);
};

export const saveQuizDraft = async (
	db: Pick<Database, 'transaction'>,
	teacherId: string,
	value: QuizDraftWrite,
	options: DraftOptions = {}
): Promise<QuizDraftReceipt> => {
	const input = validated(quizDraftWriteSchema, value);
	const fingerprint = await importFingerprint({
		action: 'save-quiz',
		input,
		markForReview: options.markForReview ?? false
	});
	return db.transaction(
		async (tx) =>
			(await replayDraft(tx, teacherId, input.requestId, fingerprint, quizDraftReceiptSchema)) ??
			writeDraft(tx, teacherId, input, fingerprint, options)
	);
};

export const patchQuizDraft = async (
	db: Pick<Database, 'transaction'>,
	teacherId: string,
	value: QuizDraftPatch,
	options: DraftOptions = {}
): Promise<QuizDraftReceipt> => {
	const input = validated(quizDraftPatchSchema, value);
	const fingerprint = await importFingerprint({
		action: 'patch-quiz',
		input,
		markForReview: options.markForReview ?? false
	});
	return db.transaction(async (tx) => {
		const replay = await replayDraft(tx, teacherId, input.requestId, fingerprint, quizDraftReceiptSchema);
		if (replay) return replay;
		const current = await getQuizDraft(tx, input.id);
		if (!current.lessonId) conflict();
		let content;
		try {
			content = mergeQuizContentPatch(current.content, input.patch, input.removeQuestionIds, input.removeOptionIds);
		} catch {
			error(422, 'La modification doit conserver un quiz valide et nommer précisément les suppressions.');
		}
		return writeDraft(
			tx,
			teacherId,
			{
				id: current.id,
				moduleId: current.moduleId,
				contextId: current.contextId,
				lessonId: current.lessonId,
				assessmentId: current.assessmentId,
				lineId: current.lineId,
				requestId: input.requestId,
				expectedRevision: input.expectedRevision,
				content
			},
			fingerprint,
			options
		);
	});
};

export const setQuizArchive = async (
	db: Pick<Database, 'transaction'>,
	teacherId: string,
	value: QuizArchive
): Promise<QuizArchiveReceipt> => {
	const input = validated(quizArchiveSchema, value);
	const fingerprint = await importFingerprint({ action: 'set-quiz-archive', input });
	return db.transaction(async (tx) => {
		const replay = await replayDraft(tx, teacherId, input.requestId, fingerprint, quizArchiveReceiptSchema);
		if (replay) return replay;
		const [quiz] = await tx
			.select({ revision: quizDrafts.revision, archived: quizDrafts.archived })
			.from(quizDrafts)
			.where(
				and(
					eq(quizDrafts.id, input.id),
					eq(quizDrafts.moduleId, input.moduleId),
					eq(quizDrafts.contextId, input.contextId)
				)
			);
		if (!quiz) return unavailable();
		const context = await requireQuizContext(tx, input.contextId, input.moduleId);
		if (
			quiz.revision !== input.expectedRevision ||
			context.revision !== input.expectedContextRevision ||
			quiz.archived === input.archived
		)
			conflict();
		const [open] = await tx
			.select({ id: quizRuns.id })
			.from(quizRuns)
			.where(and(eq(quizRuns.quizId, input.id), ne(quizRuns.status, 'closed')))
			.limit(1);
		if (open) error(409, 'Fermez la salle en cours avant d’archiver ce quiz.');
		// Visibility affects the reviewed publication. Frozen sittings retain the content revision.
		const [updated] = await tx
			.update(teachingContexts)
			.set({ revision: sql`${teachingContexts.revision} + 1` })
			.where(
				and(eq(teachingContexts.id, input.contextId), eq(teachingContexts.revision, input.expectedContextRevision))
			)
			.returning({ revision: teachingContexts.revision });
		if (!updated) return conflict();
		await tx.update(quizDrafts).set({ archived: input.archived }).where(eq(quizDrafts.id, input.id));
		const receipt = {
			requestId: input.requestId,
			quizId: input.id,
			contextRevision: updated.revision,
			archived: input.archived
		};
		await tx
			.insert(quizDraftReceipts)
			.values({ teacherId, requestId: input.requestId, quizId: input.id, fingerprint, receipt });
		return receipt;
	});
};

export const getQuizGradeBaselines = async (db: Store, quizId: string) => {
	const quiz = await getQuizDraft(db, quizId);
	if (quiz.archived) return [];
	const context = await requireQuizContext(db, quiz.contextId, quiz.moduleId);
	const records = await db
		.select({
			studentId: students.id,
			name: students.name,
			correctionRevision: corrections.revision,
			correctionStatus: corrections.status,
			points: scores.points
		})
		.from(students)
		.leftJoin(
			corrections,
			and(
				eq(corrections.studentId, students.id),
				eq(corrections.contextId, quiz.contextId),
				eq(corrections.assessmentId, quiz.assessmentId)
			)
		)
		.leftJoin(scores, and(eq(scores.correctionId, corrections.id), eq(scores.lineId, quiz.lineId)))
		.where(eq(students.classId, context.classId!))
		.orderBy(asc(students.position));
	return records.map((record) => ({
		...record,
		correctionRevision: record.correctionRevision ?? 0
	}));
};

const requireUnrelatedQuizTransfers = async (
	db: Store,
	correction: typeof corrections.$inferSelect,
	input: QuizGradeWrite,
	lineId: string
) => {
	if (input.expectedCorrectionRevision > correction.revision) conflict();
	const records = await db
		.select({
			receipt: quizGradeReceipts.receipt,
			requestId: quizGradeReceipts.requestId,
			quizId: quizGradeReports.quizId
		})
		.from(quizGradeReceipts)
		.innerJoin(
			quizGradeReports,
			eq(quizGradeReports.id, sql<string>`json_extract(${quizGradeReceipts.receipt}, '$.reportId')`)
		)
		.where(
			and(
				eq(quizGradeReceipts.contextId, correction.contextId),
				eq(quizGradeReceipts.studentId, correction.studentId),
				eq(quizGradeReports.correctionId, correction.id),
				ne(quizGradeReports.lineId, lineId)
			)
		);
	const revisions = new Set<number>();
	for (const record of records) {
		const parsed = quizGradeReceiptSchema.safeParse(record.receipt);
		if (!parsed.success) continue;
		const receipt = parsed.data;
		if (
			receipt.requestId === record.requestId &&
			receipt.quizId === record.quizId &&
			receipt.studentId === correction.studentId &&
			receipt.correctionRevision > input.expectedCorrectionRevision &&
			receipt.correctionRevision <= correction.revision
		)
			revisions.add(receipt.correctionRevision);
	}
	// Every manual save leaves a gap, including edits that restore the previous values.
	if (revisions.size !== correction.revision - input.expectedCorrectionRevision) conflict();
};

const reportQuizGrade = async (
	db: Store,
	teacherId: string,
	input: QuizGradeWrite,
	fingerprint: string
): Promise<QuizGradeReceipt> => {
	const quiz = await getQuizDraft(db, input.quizId);
	await requireQuizContext(db, quiz.contextId, quiz.moduleId);
	await requireRosterEntry(db, quiz.contextId, input.studentId);
	await requireQuizLine(db, quiz, quiz.content.questions.length, 409);
	if (input.points > quiz.content.questions.length) error(422, 'Les points dépassent le nombre de questions.');
	const [run] = await db.select().from(quizRuns).where(eq(quizRuns.id, input.runId));
	if (!run || run.quizId !== quiz.id || run.contextId !== quiz.contextId || run.teacherId !== teacherId)
		error(422, 'Cette passation ne correspond pas au quiz sélectionné.');
	const [correction] = await db
		.select()
		.from(corrections)
		.where(
			and(
				eq(corrections.contextId, quiz.contextId),
				eq(corrections.studentId, input.studentId),
				eq(corrections.assessmentId, quiz.assessmentId)
			)
		);
	if (correction?.status.startsWith('absent_')) conflict();
	const currentRevision = correction?.revision ?? 0;
	if (currentRevision !== input.expectedCorrectionRevision) {
		if (!correction) conflict();
		await requireUnrelatedQuizTransfers(db, correction, input, quiz.lineId);
	}
	const [target] = correction
		? await db
				.select()
				.from(scores)
				.where(and(eq(scores.correctionId, correction.id), eq(scores.lineId, quiz.lineId)))
		: [];
	const [previous] = await db
		.select()
		.from(quizGradeReports)
		.where(
			and(
				eq(quizGradeReports.contextId, quiz.contextId),
				eq(quizGradeReports.studentId, input.studentId),
				eq(quizGradeReports.lineId, quiz.lineId)
			)
		);
	if (previous) {
		if (
			previous.source !== 'absence' ||
			previous.points !== 0 ||
			target?.points !== 0 ||
			previous.correctionRevision !== correction?.revision ||
			run.sourceRunId !== previous.runId
		)
			conflict();
	} else if (target?.points != null) conflict();
	const correctionId = correction?.id ?? crypto.randomUUID();
	const correctionRevision = currentRevision + 1;
	if (correction) {
		const changed = await db
			.update(corrections)
			.set({ revision: correctionRevision })
			.where(and(eq(corrections.id, correctionId), eq(corrections.revision, currentRevision)))
			.returning({ id: corrections.id });
		if (!changed.length) conflict();
	} else {
		await db.insert(corrections).values({
			id: correctionId,
			moduleId: quiz.moduleId,
			contextId: quiz.contextId,
			studentId: input.studentId,
			assessmentId: quiz.assessmentId,
			revision: correctionRevision
		});
	}
	await db
		.insert(scores)
		.values({
			correctionId,
			assessmentId: quiz.assessmentId,
			lineId: quiz.lineId,
			points: input.points
		})
		.onConflictDoUpdate({
			target: [scores.correctionId, scores.lineId],
			set: { points: input.points }
		});
	await db
		.update(quizGradeReports)
		.set({ correctionRevision })
		.where(
			and(eq(quizGradeReports.correctionId, correctionId), eq(quizGradeReports.correctionRevision, currentRevision))
		);
	const activeLines = await db
		.select({ maxPoints: rubricLines.maxPoints, points: scores.points })
		.from(rubricLines)
		.leftJoin(scores, and(eq(scores.lineId, rubricLines.id), eq(scores.correctionId, correctionId)))
		.where(and(eq(rubricLines.assessmentId, quiz.assessmentId), isNull(rubricLines.retiredAt)));
	if (
		!correction?.needsReview &&
		activeLines.every(
			(line) =>
				line.points !== null && Number.isInteger(line.points) && line.points >= 0 && line.points <= line.maxPoints
		)
	)
		await db.update(corrections).set({ status: 'graded' }).where(eq(corrections.id, correctionId));
	const reportId = previous?.id ?? crypto.randomUUID();
	const reportValues = {
		runId: run.id,
		correctionId,
		points: input.points,
		source: input.source,
		correctionRevision
	};
	if (previous) await db.update(quizGradeReports).set(reportValues).where(eq(quizGradeReports.id, reportId));
	else
		await db.insert(quizGradeReports).values({
			id: reportId,
			quizId: quiz.id,
			contextId: quiz.contextId,
			studentId: input.studentId,
			lineId: quiz.lineId,
			...reportValues
		});
	const receipt = quizGradeReceiptSchema.parse({
		requestId: input.requestId,
		quizId: quiz.id,
		runId: run.id,
		studentId: input.studentId,
		reportId,
		correctionRevision
	});
	await db.insert(quizGradeReceipts).values({
		teacherId,
		requestId: input.requestId,
		studentId: input.studentId,
		contextId: quiz.contextId,
		fingerprint,
		receipt
	});
	return receipt;
};

export const applyQuizGrade = async (
	db: Pick<Database, 'transaction'>,
	teacherId: string,
	value: QuizGradeWrite
): Promise<QuizGradeReceipt> => {
	const input = validated(quizGradeWriteSchema, value);
	const fingerprint = await importFingerprint(input);
	return db.transaction(async (tx) => {
		const [previous] = await tx
			.select()
			.from(quizGradeReceipts)
			.where(and(eq(quizGradeReceipts.teacherId, teacherId), eq(quizGradeReceipts.requestId, input.requestId)));
		if (previous) {
			if (previous.fingerprint !== fingerprint) conflict();
			return quizGradeReceiptSchema.parse(previous.receipt);
		}
		return reportQuizGrade(tx, teacherId, input, fingerprint);
	});
};
