import { error } from '@sveltejs/kit';
import { and, asc, eq, inArray, or, sql, isNull, ne } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import * as t from '../db/schema.js';
import { academicYearSchema } from '../../domain/contracts.js';
import {
	annualActionSchema,
	type AnnualAction,
	type AnnualCounts,
	type AnnualPreview,
	type AnnualReceipt,
	type AnnualHistory
} from '../../domain/annual.js';
import { getGradeGrid } from './grading.js';
import type { GradeGridData } from '../../domain/grading.js';
import { gradeExportStatus } from '../../domain/grade-export.js';
import { requireActiveYear } from './annual-access.js';

type Store = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;
export type AnnualQuizCleanup = {
	purgeQuizRuns?: (runIds: readonly string[]) => Promise<readonly string[]>;
};
const emptyCounts = (): AnnualCounts => ({
	classes: 0,
	students: 0,
	corrections: 0,
	scores: 0,
	comments: 0,
	proposals: 0,
	decisions: 0
});
export function annualYear(value: string | undefined) {
	const parsed = academicYearSchema.safeParse(value);
	if (!parsed.success) error(404, 'Année scolaire introuvable.');
	return parsed.data;
}
const conflict = () =>
	error(409, 'Le dossier annuel a changé. Actualisez-le, vérifiez le récapitulatif puis confirmez à nouveau.');
async function hash(value: unknown) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
const calendarSnapshot = async (db: Store, teacherId: string) => {
	const [subscription] = await db
		.select()
		.from(t.calendarSubscriptions)
		.where(eq(t.calendarSubscriptions.teacherId, teacherId));
	const mappings = await db
		.select()
		.from(t.calendarMappings)
		.where(eq(t.calendarMappings.teacherId, teacherId))
		.orderBy(asc(t.calendarMappings.id));
	const importedLessons = await db
		.select({ lesson: t.lessons, metadata: t.calendarLessons, context: t.teachingContexts })
		.from(t.calendarLessons)
		.innerJoin(t.calendarMappings, eq(t.calendarMappings.id, t.calendarLessons.mappingId))
		.innerJoin(t.lessons, eq(t.lessons.id, t.calendarLessons.lessonId))
		.innerJoin(t.teachingContexts, eq(t.teachingContexts.id, t.lessons.contextId))
		.where(eq(t.calendarMappings.teacherId, teacherId))
		.orderBy(asc(t.lessons.id));
	return { subscription: subscription ?? null, mappings, importedLessons };
};
async function snapshot(db: Store, academicYear: string, teacherId: string) {
	const [state] = await db.select().from(t.academicYears).where(eq(t.academicYears.academicYear, academicYear));
	const classRows = await db
		.select()
		.from(t.classes)
		.where(eq(t.classes.academicYear, academicYear))
		.orderBy(asc(t.classes.id));
	const classIds = classRows.map((row) => row.id);
	const contexts = await db
		.select()
		.from(t.teachingContexts)
		.where(
			or(
				eq(t.teachingContexts.academicYear, academicYear),
				...(classIds.length ? [inArray(t.teachingContexts.classId, classIds)] : [])
			)
		)
		.orderBy(asc(t.teachingContexts.id));
	// An inconsistent legacy association must never broaden a destructive year scope silently.
	for (const context of contexts) {
		if (context.academicYear !== academicYear || (context.classId && !classIds.includes(context.classId))) conflict();
	}
	const contextIds = contexts.map((row) => row.id);
	const moduleIds = [...new Set(contexts.map((row) => row.moduleId))];
	const members = classIds.length
		? await db.select().from(t.students).where(inArray(t.students.classId, classIds)).orderBy(asc(t.students.id))
		: [];
	// Follow student ownership as well as context ownership, matching the actual cascade scope.
	const studentScope = db.select({ id: t.students.id }).from(t.students).where(eq(t.students.classId, ''));
	const ownedStudents = classIds.length
		? db.select({ id: t.students.id }).from(t.students).where(inArray(t.students.classId, classIds))
		: studentScope;
	const correctionRows = await db
		.select()
		.from(t.corrections)
		.where(
			or(
				inArray(t.corrections.studentId, ownedStudents),
				...(contextIds.length ? [inArray(t.corrections.contextId, contextIds)] : [])
			)
		)
		.orderBy(asc(t.corrections.id));
	const selectedCorrections = db
		.select({ id: t.corrections.id })
		.from(t.corrections)
		.where(
			or(
				inArray(t.corrections.studentId, ownedStudents),
				...(contextIds.length ? [inArray(t.corrections.contextId, contextIds)] : [])
			)
		);
	const points = await db
		.select()
		.from(t.scores)
		.where(inArray(t.scores.correctionId, selectedCorrections))
		.orderBy(asc(t.scores.id));
	const comments = await db
		.select()
		.from(t.semesterComments)
		.where(
			or(
				inArray(t.semesterComments.studentId, ownedStudents),
				...(contextIds.length ? [inArray(t.semesterComments.contextId, contextIds)] : [])
			)
		)
		.orderBy(asc(t.semesterComments.id));
	const proposals = await db
		.select()
		.from(t.correctionProposals)
		.where(
			or(
				inArray(t.correctionProposals.studentId, ownedStudents),
				...(contextIds.length ? [inArray(t.correctionProposals.contextId, contextIds)] : [])
			)
		)
		.orderBy(asc(t.correctionProposals.id));
	const selectedProposals = db
		.select({ id: t.correctionProposals.id })
		.from(t.correctionProposals)
		.where(
			or(
				inArray(t.correctionProposals.studentId, ownedStudents),
				...(contextIds.length ? [inArray(t.correctionProposals.contextId, contextIds)] : [])
			)
		);
	const decisions = await db
		.select()
		.from(t.proposalDecisions)
		.where(inArray(t.proposalDecisions.proposalId, selectedProposals))
		.orderBy(asc(t.proposalDecisions.id));
	const moduleRows = moduleIds.length
		? await db.select().from(t.modules).where(inArray(t.modules.id, moduleIds)).orderBy(asc(t.modules.id))
		: [];
	const resources = moduleIds.length
		? await db.select().from(t.resources).where(inArray(t.resources.moduleId, moduleIds)).orderBy(asc(t.resources.id))
		: [];
	const assessments = moduleIds.length
		? await db
				.select()
				.from(t.assessments)
				.where(inArray(t.assessments.moduleId, moduleIds))
				.orderBy(asc(t.assessments.id))
		: [];
	const selectedAssessments = db
		.select({ id: t.assessments.id })
		.from(t.assessments)
		.where(moduleIds.length ? inArray(t.assessments.moduleId, moduleIds) : eq(t.assessments.moduleId, ''));
	const groups = await db
		.select()
		.from(t.rubricGroups)
		.where(inArray(t.rubricGroups.assessmentId, selectedAssessments))
		.orderBy(asc(t.rubricGroups.id));
	const lines = await db
		.select()
		.from(t.rubricLines)
		.where(inArray(t.rubricLines.assessmentId, selectedAssessments))
		.orderBy(asc(t.rubricLines.id));
	const results = moduleIds.length
		? await db
				.select()
				.from(t.resultDefinitions)
				.where(inArray(t.resultDefinitions.moduleId, moduleIds))
				.orderBy(asc(t.resultDefinitions.id))
		: [];
	const lessons = contextIds.length
		? await db.select().from(t.lessons).where(inArray(t.lessons.contextId, contextIds)).orderBy(asc(t.lessons.id))
		: [];
	const deadlines = contextIds.length
		? await db
				.select()
				.from(t.assessmentDeadlines)
				.where(inArray(t.assessmentDeadlines.contextId, contextIds))
				.orderBy(asc(t.assessmentDeadlines.id))
		: [];
	const publications = contextIds.length
		? await db
				.select()
				.from(t.modulePublications)
				.where(inArray(t.modulePublications.contextId, contextIds))
				.orderBy(asc(t.modulePublications.id))
		: [];
	const quizRuns = contextIds.length
		? await db.select().from(t.quizRuns).where(inArray(t.quizRuns.contextId, contextIds)).orderBy(asc(t.quizRuns.id))
		: [];
	const source = {
		calendar: await calendarSnapshot(db, teacherId),
		state: state ?? null,
		classRows,
		contexts,
		members,
		correctionRows,
		points,
		comments,
		proposals,
		decisions,
		moduleRows,
		resources,
		assessments,
		groups,
		lines,
		results,
		lessons,
		deadlines,
		publications,
		quizRuns,
		publicModuleLinks: moduleIds.length
			? await db
					.select()
					.from(t.publicModuleLinks)
					.where(inArray(t.publicModuleLinks.moduleId, moduleIds))
					.orderBy(asc(t.publicModuleLinks.id))
			: [],
		publicClassLinks: classIds.length
			? await db
					.select()
					.from(t.publicClassLinks)
					.where(inArray(t.publicClassLinks.classId, classIds))
					.orderBy(asc(t.publicClassLinks.id))
			: []
	};
	return { ...source, token: await hash(source) };
}
const requireClosedAnnualQuizzes = (source: Awaited<ReturnType<typeof snapshot>>, action: AnnualAction['action']) => {
	if (action === 'reopen') return;
	if (source.quizRuns.some((run) => run.status !== 'closed'))
		error(409, 'Clôturez tous les quiz de cette année avant de l’archiver ou de la clôturer.');
};
const confirmAnnualQuizCleanup = async (
	db: Store,
	source: Awaited<ReturnType<typeof snapshot>>,
	cleanup?: AnnualQuizCleanup
) => {
	const runIds = new Set(source.quizRuns.map((run) => run.id));
	if (!runIds.size) return;
	const dependents = await db
		.select({ id: t.quizRuns.id })
		.from(t.quizRuns)
		.where(inArray(t.quizRuns.sourceRunId, [...runIds]));
	if (dependents.some((run) => !runIds.has(run.id)))
		error(409, 'Un rattrapage dépend de cette année dans un autre dossier. Aucun quiz n’a été supprimé.');
	if (!cleanup?.purgeQuizRuns)
		error(409, 'Le nettoyage des données de chaque quiz doit être confirmé avant la clôture annuelle.');
	const confirmed = await cleanup.purgeQuizRuns([...runIds]);
	if (
		!Array.isArray(confirmed) ||
		new Set(confirmed).size !== confirmed.length ||
		confirmed.length !== runIds.size ||
		confirmed.some((id) => !runIds.has(id))
	)
		error(409, 'Le nettoyage des données de chaque quiz doit être confirmé avant la clôture annuelle.');
};
// Project the already consistent snapshot once, instead of rereading every module's entire roster.
function snapshotGrid(
	source: Awaited<ReturnType<typeof snapshot>>,
	context: Awaited<ReturnType<typeof snapshot>>['contexts'][number]
): GradeGridData {
	const module = source.moduleRows.find((row) => row.id === context.moduleId)!;
	const assessments = source.assessments
		.filter((row) => row.moduleId === module.id && !row.retiredAt)
		.sort((a, b) => a.position - b.position);
	const active = new Set(assessments.map((row) => row.id));
	return {
		modules: [{ id: module.id, title: module.title }],
		contexts: [
			{
				id: context.id,
				moduleId: module.id,
				className: context.className,
				academicYear: context.academicYear
			}
		],
		contextId: context.id,
		rubric: {
			module: { id: module.id, title: module.title, revision: module.revision },
			assessments: assessments.map(({ id, title, kind, purpose }) => ({
				id,
				title,
				kind,
				purpose,
				groups: source.groups
					.filter((row) => row.assessmentId === id && !row.retiredAt)
					.sort((a, b) => a.position - b.position)
					.map(({ id, title }) => ({ id, title })),
				lines: source.lines
					.filter((row) => row.assessmentId === id && !row.retiredAt)
					.sort((a, b) => a.position - b.position)
					.map(({ id, groupId, label, description, maxPoints }) => ({
						id,
						groupId,
						label,
						description,
						maxPoints
					}))
			})),
			results: source.results
				.filter((row) => row.moduleId === module.id)
				.sort((a, b) => a.position - b.position)
				.map(({ id, title, rule }) => ({ id, title, rule })),
			contexts: [
				{
					id: context.id,
					classId: context.classId,
					className: context.className,
					academicYear: context.academicYear,
					expectedRevision: context.revision,
					deadlines: source.deadlines
						.filter((row) => row.contextId === context.id && active.has(row.assessmentId))
						.map(({ assessmentId, dueAt, submissionInstructions }) => ({
							assessmentId,
							dueAt: dueAt.toISOString(),
							submissionInstructions
						}))
				}
			]
		},
		students: source.members
			.filter((row) => row.classId === context.classId)
			.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
			.map((student) => {
				const records = source.correctionRows.filter(
					(row) => row.contextId === context.id && row.studentId === student.id
				);
				const comment = source.comments.find((row) => row.contextId === context.id && row.studentId === student.id);
				return {
					id: student.id,
					name: student.name,
					corrections: records.map((row) => ({
						assessmentId: row.assessmentId,
						revision: row.revision,
						rubricRevision: module.revision,
						status: row.status,
						needsReview: row.needsReview,
						submittedAt: row.submittedAt?.toISOString() ?? null,
						submissionUrl: row.submissionUrl,
						latenessDecision: row.latenessDecision,
						scores: source.points
							.filter(
								(point) =>
									point.correctionId === row.id &&
									source.lines.some(
										(line) => line.id === point.lineId && !line.retiredAt && active.has(line.assessmentId)
									)
							)
							.map(({ lineId, points }) => ({ lineId, points }))
					})),
					comment: { revision: comment?.revision ?? 0, content: comment?.content ?? '' },
					retiredScores: []
				};
			})
	};
}
async function preview(db: Store, academicYear: string, teacherId: string): Promise<AnnualPreview> {
	const source = await snapshot(db, academicYear, teacherId);
	const contexts: AnnualPreview['contexts'] = [];
	for (const context of source.contexts) {
		const retained = !!context.classId && source.classRows.some((row) => row.id === context.classId);
		const status = retained
			? gradeExportStatus(snapshotGrid(source, context))
			: {
					ready: false,
					reason: 'Données étudiantes supprimées : aucun PDF ne peut être régénéré.',
					complete: 0,
					total: 0
				};
		contexts.push({
			id: context.id,
			moduleId: context.moduleId,
			moduleTitle: source.moduleRows.find((row) => row.id === context.moduleId)!.title,
			className: context.className,
			archived: !!context.archivedAt,
			rosterRetained: retained,
			pdf: {
				ready: status.ready,
				reason: status.reason,
				complete: status.complete,
				total: status.total
			}
		});
	}
	return {
		academicYear,
		status: source.state?.purgedAt ? 'purged' : source.state?.archivedAt ? 'archived' : 'active',
		reviewToken: source.token,
		classes: source.classRows.map((row) => ({
			id: row.id,
			name: row.name,
			studentCount: source.members.filter((member) => member.classId === row.id).length
		})),
		removed: {
			classes: source.classRows.length,
			students: source.members.length,
			corrections: source.correctionRows.length,
			scores: source.points.length,
			comments: source.comments.length,
			proposals: source.proposals.length,
			decisions: source.decisions.length
		},
		calendarCleanup: {
			connection: !!source.calendar.subscription,
			lessons: source.calendar.importedLessons.length,
			otherYearLessons: source.calendar.importedLessons.filter(({ context }) => context.academicYear !== academicYear)
				.length
		},
		preserved: {
			modules: source.moduleRows.length,
			contexts: source.contexts.length,
			lessons: source.lessons.length,
			deadlines: source.deadlines.length,
			publications: source.publications.filter((row) => !row.unpublishedAt).length
		},
		contexts
	};
}
export function getAnnualData(db: Pick<Database, 'transaction'>, teacherId: string, selectedYear?: string) {
	return db.transaction(async (tx) => {
		const [classes, contexts, states] = await Promise.all([
			tx.select({ year: t.classes.academicYear }).from(t.classes),
			tx.select({ year: t.teachingContexts.academicYear }).from(t.teachingContexts),
			tx.select({ year: t.academicYears.academicYear }).from(t.academicYears)
		]);
		const years = [...new Set([...classes, ...contexts, ...states].map((row) => row.year))].sort().reverse();
		if (selectedYear && !years.includes(selectedYear)) error(404, 'Cette année n’est plus disponible.');
		return { years, selected: selectedYear ? await preview(tx, annualYear(selectedYear), teacherId) : null };
	});
}
export async function decideAnnualYear(
	db: Pick<Database, 'transaction'>,
	teacherId: string,
	value: AnnualAction,
	quizCleanup?: AnnualQuizCleanup
): Promise<AnnualReceipt> {
	const parsed = annualActionSchema.safeParse(value);
	if (!parsed.success) error(422, 'Vérifiez la confirmation de l’année et les PDF nécessaires.');
	const input = parsed.data;
	return db.transaction(async (tx) => {
		const fingerprint = await hash(input);
		const [previous] = await tx
			.select()
			.from(t.annualReceipts)
			.where(and(eq(t.annualReceipts.teacherId, teacherId), eq(t.annualReceipts.requestId, input.requestId)));
		if (previous) {
			if (previous.fingerprint !== fingerprint) conflict();
			return previous.receipt;
		}
		const source = await snapshot(tx, input.academicYear, teacherId);
		if (source.token !== input.reviewToken || source.state?.purgedAt) conflict();
		if (input.action === 'reopen' && !source.state?.archivedAt) conflict();
		if (input.action === 'archive' && source.state?.archivedAt) conflict();
		if (!source.classRows.length && !source.contexts.length) conflict();
		requireClosedAnnualQuizzes(source, input.action);
		if (input.action === 'purge') {
			const moduleIds = source.moduleRows.map((module) => module.id);
			const choices = input.moduleChoices ?? [];
			if (
				choices.length !== moduleIds.length ||
				new Set(choices.map((choice) => choice.moduleId)).size !== moduleIds.length ||
				choices.some((choice) => !moduleIds.includes(choice.moduleId))
			)
				error(422, 'Choisissez explicitement Reprendre ou Mettre de côté pour chaque module.');
			if (input.nextAcademicYear) await requireActiveYear(tx, input.nextAcademicYear);
			for (const moduleId of moduleIds) {
				if (source.contexts.filter((context) => context.moduleId === moduleId && context.classId).length > 1)
					error(422, 'Un ancien module est partagé entre plusieurs classes. Isolez les copies avant de clôturer.');
			}
		}
		// Reject every continuation collision before changing the reviewed year or public links.
		if (input.action === 'purge' && input.nextAcademicYear) {
			const targetClasses = await tx
				.select({ name: t.classes.name })
				.from(t.classes)
				.where(eq(t.classes.academicYear, input.nextAcademicYear));
			const names = new Set(targetClasses.map((item) => item.name.toLocaleLowerCase('fr')));
			for (const annualClass of source.classRows) {
				const continued = source.contexts.some(
					(context) =>
						context.classId === annualClass.id &&
						input.moduleChoices?.some(
							(choice) => choice.moduleId === context.moduleId && choice.decision === 'continue'
						)
				);
				if (!continued) continue;
				const name = annualClass.name.toLocaleLowerCase('fr');
				if (names.has(name))
					error(
						409,
						'Une classe de même nom existe déjà dans l’année de reprise. Aucun rapprochement automatique n’est effectué.'
					);
				names.add(name);
			}
		}
		if (input.action === 'purge') {
			for (const choice of input.moduleChoices ?? []) {
				if (choice.decision !== 'continue') continue;
				if (!source.contexts.some((context) => context.moduleId === choice.moduleId && context.classId))
					error(422, 'Ce module ne possède plus de classe à reprendre.');
				const [otherActive] = await tx
					.select({ id: t.teachingContexts.id })
					.from(t.teachingContexts)
					.where(
						and(
							eq(t.teachingContexts.moduleId, choice.moduleId),
							ne(t.teachingContexts.academicYear, input.academicYear),
							isNull(t.teachingContexts.archivedAt)
						)
					)
					.limit(1);
				if (otherActive)
					error(
						422,
						'Un ancien module possède une autre classe active : créez une copie indépendante avant la reprise.'
					);
			}
			await confirmAnnualQuizCleanup(tx, source, quizCleanup);
		}
		const now = new Date();
		await tx
			.insert(t.academicYears)
			.values({
				academicYear: input.academicYear,
				archivedAt: input.action === 'reopen' ? null : now,
				purgedAt: input.action === 'purge' ? now : null
			})
			.onConflictDoUpdate({
				target: t.academicYears.academicYear,
				set: {
					archivedAt: input.action === 'reopen' ? null : (source.state?.archivedAt ?? now),
					purgedAt: input.action === 'purge' ? now : null,
					revision: sql`${t.academicYears.revision} + 1`
				}
			});
		const contextIds = source.contexts.map((row) => row.id);
		const moduleIds = source.moduleRows.map((row) => row.id);
		if (contextIds.length)
			await tx
				.update(t.teachingContexts)
				.set({
					archivedAt: input.action === 'reopen' ? null : now,
					revision: sql`${t.teachingContexts.revision} + 1`
				})
				.where(inArray(t.teachingContexts.id, contextIds));
		// Invalidate older module/MCP drafts even when they omitted the just-archived context.
		if (moduleIds.length)
			await tx
				.update(t.modules)
				.set({ revision: sql`${t.modules.revision} + 1` })
				.where(inArray(t.modules.id, moduleIds));
		const removed =
			input.action === 'purge'
				? {
						classes: source.classRows.length,
						students: source.members.length,
						corrections: source.correctionRows.length,
						scores: source.points.length,
						comments: source.comments.length,
						proposals: source.proposals.length,
						decisions: source.decisions.length
					}
				: emptyCounts();
		if (input.action === 'purge') {
			const continuedClasses = new Map<string, string>();
			for (const oldClass of source.classRows) {
				const [link] = await tx.select().from(t.publicClassLinks).where(eq(t.publicClassLinks.classId, oldClass.id));
				if (!link) await tx.insert(t.publicClassLinks).values({ id: oldClass.id, classId: oldClass.id });
				const shouldContinue = source.contexts.some(
					(context) =>
						context.classId === oldClass.id &&
						input.moduleChoices?.some(
							(choice) => choice.moduleId === context.moduleId && choice.decision === 'continue'
						)
				);
				if (shouldContinue) {
					if (!input.nextAcademicYear) error(422, 'Choisissez l’année de reprise.');
					const newClassId = crypto.randomUUID();
					await tx
						.insert(t.classes)
						.values({ id: newClassId, name: oldClass.name, academicYear: input.nextAcademicYear });
					continuedClasses.set(oldClass.id, newClassId);
					await tx
						.update(t.publicClassLinks)
						.set({ classId: newClassId })
						.where(eq(t.publicClassLinks.id, link?.id ?? oldClass.id));
				}
			}
			for (const choice of input.moduleChoices ?? []) {
				const [otherActive] = await tx
					.select()
					.from(t.teachingContexts)
					.where(
						and(
							eq(t.teachingContexts.moduleId, choice.moduleId),
							ne(t.teachingContexts.academicYear, input.academicYear),
							isNull(t.teachingContexts.archivedAt)
						)
					)
					.limit(1);
				if (otherActive && choice.decision === 'continue')
					error(
						422,
						'Un ancien module possède une autre classe active : créez une copie indépendante avant la reprise.'
					);
				const old = source.contexts.find((context) => context.moduleId === choice.moduleId && context.classId);
				const moduleContexts = source.contexts.filter((context) => context.moduleId === choice.moduleId);
				for (const context of moduleContexts) {
					const [link] = await tx
						.select()
						.from(t.publicModuleLinks)
						.where(eq(t.publicModuleLinks.contextId, context.id));
					const publication = source.publications.find((item) => item.contextId === context.id);
					if (!link)
						await tx.insert(t.publicModuleLinks).values({
							id: context.id,
							moduleId: choice.moduleId,
							contextId: context.id,
							publishedContextId: publication ? context.id : null,
							enabled: !!publication && !publication.unpublishedAt
						});
				}
				if (choice.decision === 'continue') {
					const newClassId = old?.classId ? continuedClasses.get(old.classId) : undefined;
					if (!newClassId || !input.nextAcademicYear) error(422, 'Ce module ne possède plus de classe à reprendre.');
					const newContextId = crypto.randomUUID();
					await tx.insert(t.teachingContexts).values({
						id: newContextId,
						moduleId: choice.moduleId,
						classId: newClassId,
						className: old!.className,
						academicYear: input.nextAcademicYear
					});
					await tx
						.update(t.publicModuleLinks)
						.set({ contextId: newContextId })
						.where(eq(t.publicModuleLinks.contextId, old!.id));
					await tx
						.update(t.modules)
						.set({
							pausedAt: null,
							needsReview: true,
							agentChanges: [
								'Nouvelle promotion : planning et échéances à renseigner ; publication précédente conservée jusqu’à votre décision'
							]
						})
						.where(eq(t.modules.id, choice.moduleId));
				} else {
					if (!otherActive)
						await tx
							.update(t.modules)
							.set({ pausedAt: now, needsReview: true })
							.where(eq(t.modules.id, choice.moduleId));
					await tx
						.update(t.publicModuleLinks)
						.set({ enabled: false })
						.where(
							and(
								eq(t.publicModuleLinks.moduleId, choice.moduleId),
								inArray(
									t.publicModuleLinks.contextId,
									moduleContexts.map((context) => context.id)
								)
							)
						);
				}
			}
			// The feed changes every school year: closing any year retires this teacher's entire connection.
			const calendarLessonIds = tx
				.select({ id: t.calendarLessons.lessonId })
				.from(t.calendarLessons)
				.innerJoin(t.calendarMappings, eq(t.calendarMappings.id, t.calendarLessons.mappingId))
				.where(eq(t.calendarMappings.teacherId, teacherId));
			await tx.delete(t.lessons).where(inArray(t.lessons.id, calendarLessonIds));
			await tx.delete(t.calendarMappings).where(eq(t.calendarMappings.teacherId, teacherId));
			await tx.delete(t.calendarSubscriptions).where(eq(t.calendarSubscriptions.teacherId, teacherId));
			const changedCalendarContexts = [
				...new Set(source.calendar.importedLessons.map(({ context }) => context.id))
			].filter((id) => !contextIds.includes(id));
			const changedCalendarModules = [
				...new Set(source.calendar.importedLessons.map(({ context }) => context.moduleId))
			].filter((id) => !moduleIds.includes(id));
			if (changedCalendarContexts.length)
				await tx
					.update(t.teachingContexts)
					.set({ revision: sql`${t.teachingContexts.revision} + 1` })
					.where(inArray(t.teachingContexts.id, changedCalendarContexts));
			if (changedCalendarModules.length)
				await tx
					.update(t.modules)
					.set({ revision: sql`${t.modules.revision} + 1` })
					.where(inArray(t.modules.id, changedCalendarModules));
			// Explicitly remove context-owned private records, including malformed legacy roster links.
			if (contextIds.length) {
				await tx.delete(t.quizRuns).where(inArray(t.quizRuns.contextId, contextIds));
				await tx.delete(t.quizGradeReports).where(inArray(t.quizGradeReports.contextId, contextIds));
				await tx.delete(t.quizGradeReceipts).where(inArray(t.quizGradeReceipts.contextId, contextIds));
				await tx.delete(t.correctionProposals).where(inArray(t.correctionProposals.contextId, contextIds));
				await tx.delete(t.semesterComments).where(inArray(t.semesterComments.contextId, contextIds));
				await tx.delete(t.corrections).where(inArray(t.corrections.contextId, contextIds));
			}
			await tx.delete(t.classes).where(eq(t.classes.academicYear, input.academicYear));
		} else
			await tx
				.update(t.classes)
				.set({ revision: sql`${t.classes.revision} + 1` })
				.where(eq(t.classes.academicYear, input.academicYear));
		const receipt: AnnualReceipt = {
			version: 1,
			requestId: input.requestId,
			academicYear: input.academicYear,
			action: input.action,
			completedAt: now.toISOString(),
			removed,
			...(input.action === 'purge'
				? { calendar: { connection: !!source.calendar.subscription, lessons: source.calendar.importedLessons.length } }
				: {})
		};
		await tx.insert(t.annualReceipts).values({ teacherId, requestId: input.requestId, fingerprint, receipt });
		return receipt;
	});
}
export function getAnnualHistory(
	db: Pick<Database, 'transaction'>,
	academicYear: string,
	contextId: string
): Promise<AnnualHistory> {
	return db.transaction(async (tx) => {
		const [context] = await tx
			.select()
			.from(t.teachingContexts)
			.where(and(eq(t.teachingContexts.id, contextId), eq(t.teachingContexts.academicYear, academicYear)));
		if (!context) error(404, 'Historique indisponible pour cette année.');
		const [module] = await tx.select().from(t.modules).where(eq(t.modules.id, context.moduleId));
		const schedule = await tx
			.select()
			.from(t.lessons)
			.where(eq(t.lessons.contextId, contextId))
			.orderBy(asc(t.lessons.startsAt));
		const deadlines = await tx
			.select({ deadline: t.assessmentDeadlines, title: t.assessments.title })
			.from(t.assessmentDeadlines)
			.innerJoin(t.assessments, eq(t.assessmentDeadlines.assessmentId, t.assessments.id))
			.where(eq(t.assessmentDeadlines.contextId, contextId));
		const grid = context.classId ? await getGradeGrid(tx, context.moduleId, contextId, true) : null;
		if (grid) {
			grid.modules = grid.modules.filter((row) => row.id === context.moduleId);
			grid.contexts = grid.contexts.filter((row) => row.id === contextId);
			grid.rubric!.contexts = grid.rubric!.contexts.filter((row) => row.id === contextId);
		}
		return {
			academicYear,
			className: context.className,
			moduleTitle: module.title,
			preparation: context.preparation,
			lessons: schedule.map(({ id, title, startsAt, endsAt, recap, toDo }) => ({
				id,
				title,
				startsAt: startsAt.toISOString(),
				endsAt: endsAt.toISOString(),
				recap,
				toDo
			})),
			deadlines: deadlines.map(({ deadline, title }) => ({
				id: deadline.id,
				title,
				dueAt: deadline.dueAt.toISOString(),
				submissionInstructions: deadline.submissionInstructions
			})),
			grid
		};
	});
}
