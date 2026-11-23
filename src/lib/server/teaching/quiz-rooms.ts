import { error, isHttpError } from '@sveltejs/kit';
import { and, eq, ne } from 'drizzle-orm';
import type { z } from 'zod';
import { idSchema } from '../../domain/contracts.js';
import type { QuizGradeReceipt, QuizGradeWrite } from '../../domain/quiz-content.js';
import { importFingerprint } from '../../domain/module-import.js';
import { quizRoomOpenSchema } from '../../domain/quiz-session.js';
import type {
	QuizRetakeCreate,
	QuizSessionActor,
	QuizSessionCommand,
	QuizSessionCreate,
	QuizTeacherProjection,
	QuizSessionReceipt
} from '../../domain/quiz-session.js';
import type { Database } from '../db/index.js';
import { publicModuleLinks, quizGradeReports, quizRuns, teachingContexts } from '../db/schema.js';
import { requireActiveYear } from './annual-access.js';
import { getPublicModule } from './publications.js';
import { applyQuizGrade, getQuizDraft, getQuizGradeBaselines } from './quizzes.js';

export { quizRoomOpenSchema } from '../../domain/quiz-session.js';

type QuizRoomPort = {
	initialize: (input: QuizSessionCreate) => Promise<QuizTeacherProjection>;
	teacherState: () => Promise<QuizTeacherProjection>;
	command: (
		actor: QuizSessionActor,
		command: QuizSessionCommand
	) => Promise<{
		receipt: QuizSessionReceipt;
		view: unknown;
	}>;
	createRetake: (input: QuizRetakeCreate) => Promise<QuizTeacherProjection>;
	reportGrade: (input: QuizGradeWrite) => Promise<QuizGradeReceipt>;
};
export type QuizRoomResolver = (id: string) => QuizRoomPort;
type QuizRun = typeof quizRuns.$inferSelect;
type GradeBaseline = Awaited<ReturnType<typeof getQuizGradeBaselines>>[number];
type FollowUpCandidate = { baseline: GradeBaseline; kind: 'ungraded' | 'absence' };
const conflict: () => never = () => error(409, 'La salle ou les notes ont changé. Actualisez avant de réessayer.');

const requirePublishedQuizContext = async (db: Pick<Database, 'select'>, contextId: string) => {
	const [link] = await db
		.select({ id: publicModuleLinks.id, publishedContextId: publicModuleLinks.publishedContextId })
		.from(publicModuleLinks)
		.where(eq(publicModuleLinks.contextId, contextId));
	const unavailable: () => never = () => error(422, 'Publiez ce module pour cette classe avant de lancer le quiz.');
	if (link && link.publishedContextId !== contextId) unavailable();
	try {
		await getPublicModule(db, link?.id ?? contextId);
	} catch (cause) {
		if (isHttpError(cause) && cause.status === 404) unavailable();
		throw cause;
	}
};

const followUpCandidates = async (
	db: Pick<Database, 'select'>,
	source: Pick<QuizRun, 'id' | 'quizId'>,
	baselines: GradeBaseline[],
	excludedRunId?: string
) => {
	const reports = await db.select().from(quizGradeReports).where(eq(quizGradeReports.quizId, source.quizId));
	const runs = await db
		.select({ gradeBaselines: quizRuns.gradeBaselines })
		.from(quizRuns)
		.where(and(eq(quizRuns.quizId, source.quizId), excludedRunId ? ne(quizRuns.id, excludedRunId) : undefined));
	const previousStudents = new Set(runs.flatMap((run) => run.gradeBaselines.map((entry) => entry.studentId)));
	return baselines.flatMap<FollowUpCandidate>((baseline) => {
		if (baseline.correctionStatus?.startsWith('absent_')) return [];
		const report = reports.find((entry) => entry.studentId === baseline.studentId);
		if (baseline.points === null && !report && !previousStudents.has(baseline.studentId))
			return [{ baseline, kind: 'ungraded' as const }];
		if (
			report?.runId === source.id &&
			report.source === 'absence' &&
			report.points === 0 &&
			report.correctionRevision === baseline.correctionRevision &&
			baseline.points === 0
		)
			return [{ baseline, kind: 'absence' as const }];
		return [];
	});
};

const selectRetakeBaselines = async (
	db: Pick<Database, 'select'>,
	run: Pick<QuizRun, 'quizId' | 'sourceRunId'>,
	participantIds: readonly string[],
	baselines: GradeBaseline[],
	excludedRunId?: string
) => {
	const candidates = await followUpCandidates(
		db,
		{ id: run.sourceRunId!, quizId: run.quizId },
		baselines,
		excludedRunId
	);
	return participantIds.map((id) => {
		const candidate = candidates.find((entry) => entry.baseline.studentId === id);
		if (!candidate) conflict();
		return candidate.baseline;
	});
};

export const requireQuizRun = async (db: Pick<Database, 'select'>, runId: string, teacherId?: string) => {
	if (!idSchema.safeParse(runId).success) error(404, 'Salle indisponible.');
	const [run] = await db.select().from(quizRuns).where(eq(quizRuns.id, runId));
	if (!run || (teacherId && run.teacherId !== teacherId)) error(404, 'Salle indisponible.');
	const [context] = await db.select().from(teachingContexts).where(eq(teachingContexts.id, run.contextId));
	if (!context || context.archivedAt || !context.classId) error(409, 'Cette classe est archivée.');
	await requireActiveYear(db, context.academicYear);
	return run;
};

export const getQuizRoomCandidates = async (db: Database, runId: string, teacherId: string) => {
	const source = await requireQuizRun(db, runId, teacherId);
	if (source.status !== 'closed') conflict();
	const candidates = await followUpCandidates(db, source, await getQuizGradeBaselines(db, source.quizId));
	return candidates.map(({ baseline, kind }) => ({ id: baseline.studentId, name: baseline.name, kind }));
};

export const openQuizRoom = async (
	db: Database,
	roomFor: QuizRoomResolver,
	teacherId: string,
	value: z.input<typeof quizRoomOpenSchema>,
	now = Date.now()
): Promise<QuizTeacherProjection> => {
	const checked = quizRoomOpenSchema.safeParse(value);
	if (!checked.success) error(422, 'Vérifiez les références de la salle.');
	const input = checked.data;
	const fingerprint = await importFingerprint(input);
	const run = await db.transaction(async (tx) => {
		const [existing] = await tx.select().from(quizRuns).where(eq(quizRuns.id, input.id));
		if (existing) {
			if (existing.teacherId !== teacherId || existing.openingFingerprint !== fingerprint) conflict();
			await requireQuizRun(tx, existing.id, teacherId);
			return existing;
		}
		const quiz = await getQuizDraft(tx, input.quizId);
		if (quiz.archived) error(409, 'Restaurez ce quiz avant d’ouvrir une salle.');
		if (quiz.revision !== input.expectedQuizRevision || quiz.needsReview || !quiz.lessonId) conflict();
		await requirePublishedQuizContext(tx, quiz.contextId);
		const baselines = await getQuizGradeBaselines(tx, quiz.id);
		const [active] = await tx
			.select({ id: quizRuns.id })
			.from(quizRuns)
			.where(and(eq(quizRuns.quizId, quiz.id), ne(quizRuns.status, 'closed')))
			.limit(1);
		if (active) conflict();
		if (!baselines.length) error(422, 'Ajoutez les étudiants de cette classe avant d’ouvrir la salle.');
		let selected = baselines;
		if (input.sourceRunId) {
			const source = await requireQuizRun(tx, input.sourceRunId, teacherId);
			if (source.quizId !== quiz.id || source.status !== 'closed') conflict();
			selected = await selectRetakeBaselines(
				tx,
				{ quizId: quiz.id, sourceRunId: source.id },
				input.participantIds!,
				baselines
			);
		} else {
			const [previous] = await tx
				.select({ id: quizRuns.id })
				.from(quizRuns)
				.where(eq(quizRuns.quizId, quiz.id))
				.limit(1);
			if (previous) conflict();
		}
		const [created] = await tx
			.insert(quizRuns)
			.values({
				id: input.id,
				quizId: quiz.id,
				contextId: quiz.contextId,
				teacherId,
				quizRevision: quiz.revision,
				openingFingerprint: fingerprint,
				shuffleSeed: crypto.randomUUID(),
				gradeBaselines: selected.map((entry) => ({
					studentId: entry.studentId,
					name: entry.name,
					correctionRevision: entry.correctionRevision,
					requestId: crypto.randomUUID()
				})),
				sourceRunId: input.sourceRunId ?? null,
				createdAt: new Date(now)
			})
			.returning();
		return created;
	});
	const quiz = await getQuizDraft(db, run.quizId);
	if (
		quiz.revision !== run.quizRevision ||
		quiz.contextId !== run.contextId ||
		quiz.archived ||
		quiz.needsReview ||
		!quiz.lessonId
	)
		conflict();
	try {
		return await roomFor(run.id).teacherState();
	} catch (cause) {
		if (!(cause instanceof Error) || !cause.message.includes('quiz_room_not_initialized') || run.status !== 'lobby')
			throw cause;
	}
	if (run.sourceRunId) {
		const source = await requireQuizRun(db, run.sourceRunId, teacherId);
		const previousStudents = new Set(source.gradeBaselines.map((entry) => entry.studentId));
		const newParticipants = run.gradeBaselines
			.filter((entry) => !previousStudents.has(entry.studentId))
			.map((entry) => ({ id: entry.studentId, name: entry.name }));
		return roomFor(run.sourceRunId).createRetake({
			id: run.id,
			...(newParticipants.length ? { newParticipants } : {}),
			participantIds: run.gradeBaselines.map((entry) => entry.studentId),
			protectedParticipantIds: [],
			shuffleSeed: run.shuffleSeed,
			createdAt: run.createdAt.getTime()
		});
	}
	return roomFor(run.id).initialize({
		id: run.id,
		content: quiz.content,
		roster: run.gradeBaselines.map((entry) => ({ id: entry.studentId, name: entry.name })),
		shuffleSeed: run.shuffleSeed,
		createdAt: run.createdAt.getTime()
	});
};

const participantGrade = (
	run: QuizRun,
	participant: QuizTeacherProjection['participants'][number]
): QuizGradeWrite | null => {
	const baseline = run.gradeBaselines.find((entry) => entry.studentId === participant.id);
	if (!baseline || participant.points === null) return null;
	return {
		requestId: baseline.requestId,
		quizId: run.quizId,
		runId: run.id,
		studentId: participant.id,
		expectedCorrectionRevision: baseline.correctionRevision,
		points: participant.points,
		source: participant.status === 'absent' ? 'absence' : participant.status === 'interrupted' ? 'stopped' : 'attempt'
	};
};

export const reportQuizRoomGrade = async (
	db: Database,
	teacherId: string,
	view: QuizTeacherProjection,
	input: QuizGradeWrite
) => {
	if (view.id !== input.runId || view.status !== 'closed') conflict();
	const participant = view.participants.find((entry) => entry.id === input.studentId);
	if (!participant) conflict();
	const run = await requireQuizRun(db, input.runId, teacherId);
	const expected = participantGrade(run, participant);
	if (
		!expected ||
		expected.requestId !== input.requestId ||
		expected.quizId !== input.quizId ||
		expected.expectedCorrectionRevision !== input.expectedCorrectionRevision ||
		expected.points !== input.points ||
		expected.source !== input.source
	)
		conflict();
	return applyQuizGrade(db, teacherId, input);
};

export const synchronizeQuizGrades = async (
	db: Database,
	roomFor: QuizRoomResolver,
	teacherId: string,
	runId: string
) => {
	const run = await requireQuizRun(db, runId, teacherId);
	const view = await roomFor(run.id).teacherState();
	if (view.status !== 'closed') conflict();
	const conflicts: string[] = [];
	let reported = 0;
	for (const participant of view.participants) {
		const input = participantGrade(run, participant);
		if (!input) {
			conflicts.push(participant.id);
			continue;
		}
		try {
			// Each Durable Object RPC has its own external-request budget on Workers Free.
			await roomFor(run.id).reportGrade(input);
			reported++;
		} catch (cause) {
			if (!isHttpError(cause) || cause.status !== 409) throw cause;
			conflicts.push(participant.id);
		}
	}
	await db.update(quizRuns).set({ status: 'closed' }).where(eq(quizRuns.id, run.id));
	return { reported, conflicts };
};

const freezeStartingCohort = async (db: Database, teacherId: string, runId: string) =>
	db.transaction(async (tx) => {
		const run = await requireQuizRun(tx, runId, teacherId);
		await requirePublishedQuizContext(tx, run.contextId);
		if (run.status !== 'lobby') return run;
		const quiz = await getQuizDraft(tx, run.quizId);
		if (quiz.revision !== run.quizRevision || quiz.archived || quiz.needsReview || !quiz.lessonId) conflict();
		const baselines = await getQuizGradeBaselines(tx, run.quizId);
		const expected = run.sourceRunId
			? await selectRetakeBaselines(
					tx,
					run,
					run.gradeBaselines.map((entry) => entry.studentId),
					baselines,
					run.id
				)
			: baselines;
		if (!expected.length) error(422, 'Ajoutez les étudiants de cette classe avant de lancer le quiz.');
		const [reserved] = await tx
			.update(quizRuns)
			.set({
				// Reserve the immutable first-start cohort before an RPC response can be lost.
				status: 'running',
				gradeBaselines: expected.map((entry) => ({
					studentId: entry.studentId,
					name: entry.name,
					correctionRevision: entry.correctionRevision,
					requestId:
						run.gradeBaselines.find((baseline) => baseline.studentId === entry.studentId)?.requestId ??
						crypto.randomUUID()
				}))
			})
			.where(and(eq(quizRuns.id, run.id), eq(quizRuns.status, 'lobby')))
			.returning();
		if (!reserved) conflict();
		return reserved;
	});

const rosterRequestId = async (requestId: string) => {
	const hash = await importFingerprint({ requestId, type: 'first_start_roster' });
	return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};

export const commandQuizRoom = async (
	db: Database,
	roomFor: QuizRoomResolver,
	teacherId: string,
	runId: string,
	command: QuizSessionCommand
) => {
	let run = await requireQuizRun(db, runId, teacherId);
	if (
		!['start', 'admit_late', 'add_time', 'interrupt', 'close', 'remove_lobby', 'remove_expected'].includes(command.type)
	)
		error(403, 'Cette commande ne relève pas du pilotage enseignant.');
	if (command.type === 'start') {
		const current = await roomFor(run.id).teacherState();
		if (current.status === 'lobby') {
			run = await freezeStartingCohort(db, teacherId, run.id);
			await roomFor(run.id).command(
				{ kind: 'teacher' },
				{
					type: 'set_roster',
					requestId: await rosterRequestId(command.requestId),
					roster: run.gradeBaselines.map((entry) => ({ id: entry.studentId, name: entry.name })),
					shuffleSeed: run.shuffleSeed
				}
			);
		}
	}
	const result = await roomFor(run.id).command({ kind: 'teacher' }, command);
	const view = await roomFor(run.id).teacherState();
	if (view.status === 'closed') {
		const grades = await synchronizeQuizGrades(db, roomFor, teacherId, runId);
		return { receipt: result.receipt, view, grades };
	}
	if (view.status === 'running')
		await db
			.update(quizRuns)
			.set({ status: 'running' })
			.where(and(eq(quizRuns.id, run.id), ne(quizRuns.status, 'closed')));
	return { receipt: result.receipt, view };
};
