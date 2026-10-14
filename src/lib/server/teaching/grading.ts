import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
	modules,
	classes,
	students,
	teachingContexts,
	assessments,
	rubricGroups,
	rubricLines,
	resultDefinitions,
	assessmentDeadlines,
	corrections,
	scores,
	semesterComments
} from '../db/schema.js';
import {
	correctionWriteSchema,
	rubricUpdateSchema,
	semesterCommentWriteSchema,
	type RubricData,
	type RubricDraft,
	type GradeGridData,
	type StudentGrading,
	type CorrectionWrite
} from '../../domain/grading.js';
import { calculateAssessment } from '../../domain/grade-calculation.js';
import { requireRosterEntry } from './roster.js';
import type { z } from 'zod';

type Store = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;
const unavailable: () => never = () => error(404, 'Cet élément n’est plus disponible.');
const conflict: () => never = () =>
	error(
		409,
		'Les données ont changé depuis l’ouverture. Vos saisies sont conservées ; rechargez la version actuelle avant de réessayer.'
	);
function validated<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
	const result = schema.safeParse(value);
	if (!result.success) error(422, 'Vérifiez les champs et les règles du barème.');
	return result.data;
}
async function activeContext(db: Store, id: string, includeArchived = false) {
	const [row] = await db
		.select()
		.from(teachingContexts)
		.where(
			and(
				eq(teachingContexts.id, id),
				...(includeArchived ? [] : [isNull(teachingContexts.archivedAt)])
			)
		);
	if (!row || !row.classId) unavailable();
	return row;
}
export async function getRubric(
	db: Store,
	moduleId: string,
	includeArchived = false
): Promise<RubricData> {
	const [module] = await db
		.select({ id: modules.id, title: modules.title, revision: modules.revision })
		.from(modules)
		.where(eq(modules.id, moduleId));
	if (!module) unavailable();
	const [evaluationRows, outputs, contextRows] = await Promise.all([
		db
			.select()
			.from(assessments)
			.where(and(eq(assessments.moduleId, moduleId), isNull(assessments.retiredAt)))
			.orderBy(asc(assessments.position)),
		db
			.select()
			.from(resultDefinitions)
			.where(eq(resultDefinitions.moduleId, moduleId))
			.orderBy(asc(resultDefinitions.position)),
		db
			.select()
			.from(teachingContexts)
			.where(
				and(
					eq(teachingContexts.moduleId, moduleId),
					...(includeArchived ? [] : [isNull(teachingContexts.archivedAt)])
				)
			)
			.orderBy(desc(teachingContexts.academicYear), asc(teachingContexts.className))
	]);
	const evaluationIds = evaluationRows.map((v) => v.id);
	const contextIds = contextRows.filter((v) => v.classId).map((v) => v.id);
	const [groups, lines, deadlines] = await Promise.all([
		evaluationIds.length
			? db
					.select()
					.from(rubricGroups)
					.where(
						and(inArray(rubricGroups.assessmentId, evaluationIds), isNull(rubricGroups.retiredAt))
					)
					.orderBy(asc(rubricGroups.position))
			: [],
		evaluationIds.length
			? db
					.select()
					.from(rubricLines)
					.where(
						and(inArray(rubricLines.assessmentId, evaluationIds), isNull(rubricLines.retiredAt))
					)
					.orderBy(asc(rubricLines.position))
			: [],
		contextIds.length
			? db
					.select()
					.from(assessmentDeadlines)
					.where(inArray(assessmentDeadlines.contextId, contextIds))
			: []
	]);
	return {
		module,
		assessments: evaluationRows.map(({ id, title, kind, purpose }) => ({
			id,
			title,
			kind,
			purpose,
			groups: groups.filter((g) => g.assessmentId === id).map(({ id, title }) => ({ id, title })),
			lines: lines
				.filter((l) => l.assessmentId === id)
				.map(({ id, groupId, label, description, maxPoints }) => ({
					id,
					groupId,
					label,
					description,
					maxPoints
				}))
		})),
		results: outputs.map(({ id, title, rule }) => ({ id, title, rule })),
		contexts: contextRows
			.filter((v) => v.classId)
			.map(({ id, className, academicYear, revision }) => ({
				id,
				className,
				academicYear,
				expectedRevision: revision,
				deadlines: deadlines
					.filter((d) => d.contextId === id && evaluationIds.includes(d.assessmentId))
					.map(({ assessmentId, dueAt, submissionInstructions }) => ({
						assessmentId,
						dueAt: dueAt.toISOString(),
						submissionInstructions
					}))
			}))
	};
}
async function checkIdentities(db: Store, moduleId: string, draft: RubricDraft) {
	for (const assessment of draft.assessments) {
		const [existing] = await db.select().from(assessments).where(eq(assessments.id, assessment.id));
		if (existing && existing.moduleId !== moduleId)
			error(422, 'Identifiant d’évaluation invalide.');
		for (const [table, ids] of [
			[rubricGroups, assessment.groups.map((v) => v.id)],
			[rubricLines, assessment.lines.map((v) => v.id)]
		] as const) {
			for (let offset = 0; offset < ids.length; offset += 200) {
				const found = await db
					.select({ assessmentId: table.assessmentId })
					.from(table)
					.where(inArray(table.id, ids.slice(offset, offset + 200)));
				if (found.some((row) => row.assessmentId !== assessment.id))
					error(422, 'Identifiant de critère ou de groupe invalide.');
			}
		}
	}
	if (draft.results.length) {
		const found = await db
			.select()
			.from(resultDefinitions)
			.where(
				inArray(
					resultDefinitions.id,
					draft.results.map((v) => v.id)
				)
			);
		if (found.some((row) => row.moduleId !== moduleId))
			error(422, 'Identifiant de résultat invalide.');
	}
}
export async function replaceRubric(
	db: Pick<Database, 'transaction'>,
	moduleId: string,
	value: RubricDraft & { expectedRevision: number }
) {
	const draft = validated(rubricUpdateSchema, value);
	return db.transaction(async (tx) => {
		const [claimed] = await tx
			.update(modules)
			.set({ revision: sql`${modules.revision} + 1` })
			.where(and(eq(modules.id, moduleId), eq(modules.revision, draft.expectedRevision)))
			.returning();
		if (!claimed) conflict();
		await checkIdentities(tx, moduleId, draft);
		const now = new Date();
		const activeIds = draft.assessments.map((v) => v.id);
		await tx
			.update(assessments)
			.set({ retiredAt: now, rubricRevision: claimed.revision })
			.where(
				and(
					eq(assessments.moduleId, moduleId),
					isNull(assessments.retiredAt),
					...(activeIds.length ? [notInArray(assessments.id, activeIds)] : [])
				)
			);
		for (const [position, assessment] of draft.assessments.entries()) {
			const { id, title, kind, purpose } = assessment;
			await tx
				.insert(assessments)
				.values({ id, moduleId, title, kind, purpose, position, rubricRevision: claimed.revision })
				.onConflictDoUpdate({
					target: assessments.id,
					set: { title, kind, purpose, position, retiredAt: null, rubricRevision: claimed.revision }
				});
			const groupIds = assessment.groups.map((v) => v.id);
			const lineIds = assessment.lines.map((v) => v.id);
			await tx
				.update(rubricLines)
				.set({ retiredAt: now })
				.where(
					and(
						eq(rubricLines.assessmentId, id),
						isNull(rubricLines.retiredAt),
						notInArray(rubricLines.id, lineIds)
					)
				);
			await tx
				.update(rubricGroups)
				.set({ retiredAt: now })
				.where(
					and(
						eq(rubricGroups.assessmentId, id),
						isNull(rubricGroups.retiredAt),
						notInArray(rubricGroups.id, groupIds)
					)
				);
			for (const [position, group] of assessment.groups.entries())
				await tx
					.insert(rubricGroups)
					.values({ ...group, assessmentId: id, position })
					.onConflictDoUpdate({
						target: rubricGroups.id,
						set: { title: group.title, position, retiredAt: null }
					});
			for (const [position, line] of assessment.lines.entries())
				await tx
					.insert(rubricLines)
					.values({ ...line, assessmentId: id, position })
					.onConflictDoUpdate({
						target: rubricLines.id,
						set: {
							groupId: line.groupId,
							label: line.label,
							description: line.description,
							maxPoints: line.maxPoints,
							position,
							retiredAt: null
						}
					});
		}
		const resultIds = draft.results.map((v) => v.id);
		await tx
			.delete(resultDefinitions)
			.where(
				and(
					eq(resultDefinitions.moduleId, moduleId),
					...(resultIds.length ? [notInArray(resultDefinitions.id, resultIds)] : [])
				)
			);
		for (const [position, result] of draft.results.entries())
			await tx
				.insert(resultDefinitions)
				.values({ ...result, moduleId, position })
				.onConflictDoUpdate({
					target: resultDefinitions.id,
					set: { title: result.title, rule: result.rule, position }
				});
		for (const context of draft.contexts) {
			const current = await activeContext(tx, context.id);
			if (current.moduleId !== moduleId) error(422, 'Rattachement de classe invalide.');
			const changed = await tx
				.update(teachingContexts)
				.set({ revision: sql`${teachingContexts.revision} + 1` })
				.where(
					and(
						eq(teachingContexts.id, context.id),
						eq(teachingContexts.revision, context.expectedRevision)
					)
				)
				.returning({ id: teachingContexts.id });
			if (!changed.length) conflict();
			await tx.delete(assessmentDeadlines).where(eq(assessmentDeadlines.contextId, context.id));
			for (const deadline of context.deadlines)
				await tx.insert(assessmentDeadlines).values({
					...deadline,
					moduleId,
					contextId: context.id,
					dueAt: new Date(deadline.dueAt)
				});
		}
		return getRubric(tx, moduleId);
	});
}

async function readStudents(
	db: Store,
	contextId: string,
	studentId?: string,
	includeArchived = false
): Promise<StudentGrading[]> {
	const context = await activeContext(db, contextId, includeArchived);
	if (studentId) await requireRosterEntry(db, contextId, studentId);
	const roster = await db
		.select({ id: students.id, name: students.name })
		.from(students)
		.where(
			and(
				eq(students.classId, context.classId!),
				...(studentId ? [eq(students.id, studentId)] : [])
			)
		)
		.orderBy(asc(students.position), asc(students.name));
	if (!roster.length) return [];
	const ids = roster.map((v) => v.id);
	const [records, comments] = await Promise.all([
		db
			.select()
			.from(corrections)
			.where(and(eq(corrections.contextId, contextId), inArray(corrections.studentId, ids))),
		db
			.select()
			.from(semesterComments)
			.where(
				and(eq(semesterComments.contextId, contextId), inArray(semesterComments.studentId, ids))
			)
	]);
	const correctionIds = records.map((v) => v.id);
	const allScores = correctionIds.length
		? await db
				.select()
				.from(scores)
				.innerJoin(rubricLines, eq(scores.lineId, rubricLines.id))
				.innerJoin(assessments, eq(scores.assessmentId, assessments.id))
				.where(inArray(scores.correctionId, correctionIds))
		: [];
	return roster.map(({ id, name }) => {
		const own = records.filter((v) => v.studentId === id);
		const ownIds = new Set(own.map((v) => v.id));
		const comment = comments.find((v) => v.studentId === id);
		return {
			id,
			name,
			corrections: own.map(
				({
					id: correctionId,
					assessmentId,
					revision,
					status,
					submittedAt,
					submissionUrl,
					latenessDecision
				}) => ({
					assessmentId,
					revision,
					rubricRevision: 1,
					status,
					submittedAt: submittedAt?.toISOString() ?? null,
					submissionUrl,
					latenessDecision,
					scores: allScores
						.filter(
							(v) =>
								v.score.correctionId === correctionId &&
								!v.rubric_line.retiredAt &&
								!v.assessment.retiredAt
						)
						.map((v) => ({ lineId: v.score.lineId, points: v.score.points }))
				})
			),
			comment: { revision: comment?.revision ?? 0, content: comment?.content ?? '' },
			retiredScores: allScores
				.filter(
					(v) =>
						ownIds.has(v.score.correctionId) && (v.rubric_line.retiredAt || v.assessment.retiredAt)
				)
				.map((v) => ({
					assessmentTitle: v.assessment.title,
					label: v.rubric_line.label,
					points: v.score.points,
					maxPoints: v.rubric_line.maxPoints
				}))
		};
	});
}
export async function getGradeGrid(
	db: Store,
	moduleId?: string,
	contextId?: string,
	includeArchived = false
): Promise<GradeGridData> {
	const [moduleList, contextList] = await Promise.all([
		db.select({ id: modules.id, title: modules.title }).from(modules).orderBy(asc(modules.title)),
		db
			.select({
				id: teachingContexts.id,
				moduleId: teachingContexts.moduleId,
				className: teachingContexts.className,
				academicYear: teachingContexts.academicYear
			})
			.from(teachingContexts)
			.innerJoin(classes, eq(teachingContexts.classId, classes.id))
			.where(includeArchived ? undefined : isNull(teachingContexts.archivedAt))
			.orderBy(desc(teachingContexts.academicYear), asc(teachingContexts.className))
	]);
	const chosen = moduleId
		? moduleList.find((v) => v.id === moduleId)
		: (moduleList.find((v) => contextList.some((c) => c.moduleId === v.id)) ?? moduleList[0]);
	if (moduleId && !chosen) unavailable();
	if (!chosen)
		return {
			modules: moduleList,
			contexts: contextList,
			rubric: null,
			contextId: null,
			students: []
		};
	const context = contextId
		? contextList.find((v) => v.id === contextId && v.moduleId === chosen.id)
		: contextList.find((v) => v.moduleId === chosen.id);
	if (contextId && !context) unavailable();
	const rubric = await getRubric(db, chosen.id, includeArchived);
	const members = context ? await readStudents(db, context.id, undefined, includeArchived) : [];
	for (const student of members)
		for (const correction of student.corrections)
			correction.rubricRevision = rubric.module.revision;
	return {
		modules: moduleList,
		contexts: contextList,
		rubric,
		contextId: context?.id ?? null,
		students: members
	};
}
export async function getDetailedCorrection(db: Store, contextId: string, studentId: string) {
	const context = await activeContext(db, contextId);
	await requireRosterEntry(db, contextId, studentId);
	const grid = await getGradeGrid(db, context.moduleId, contextId);
	return { rubric: grid.rubric!, contextId, students: grid.students, studentId };
}
export async function saveCorrection(
	db: Pick<Database, 'transaction'>,
	contextId: string,
	studentId: string,
	assessmentId: string,
	value: CorrectionWrite
): Promise<StudentGrading> {
	const input = validated(correctionWriteSchema, value);
	return db.transaction(async (tx) => {
		const context = await activeContext(tx, contextId);
		await requireRosterEntry(tx, contextId, studentId);
		const rubric = await getRubric(tx, context.moduleId);
		if (rubric.module.revision !== input.rubricRevision) conflict();
		const assessment = rubric.assessments.find((v) => v.id === assessmentId);
		if (!assessment) unavailable();
		if (assessment.kind !== 'project' && input.latenessDecision !== 'automatic')
			error(422, 'Les décisions de retard concernent uniquement les projets.');
		const activeLines = new Set(assessment.lines.map((v) => v.id));
		if (
			input.scores.length !== activeLines.size ||
			input.scores.some((v) => !activeLines.has(v.lineId))
		)
			error(422, 'Les critères ne correspondent plus à ce barème.');
		const absent = input.status.startsWith('absent_');
		if (
			!absent &&
			input.scores.some(
				(v) =>
					v.points !== null && v.points > assessment.lines.find((l) => l.id === v.lineId)!.maxPoints
			)
		)
			error(422, 'Des points dépassent le maximum du critère.');
		const grade = calculateAssessment(
			assessment,
			{ ...input, assessmentId, revision: input.expectedRevision },
			rubric.contexts
				.find((c) => c.id === contextId)
				?.deadlines.find((d) => d.assessmentId === assessmentId)?.dueAt
		);
		if (input.status === 'graded' && grade.state !== 'ready')
			error(422, grade.issues[0] ?? 'Complétez cette correction avant de la marquer comme notée.');
		const [existing] = await tx
			.select()
			.from(corrections)
			.where(
				and(
					eq(corrections.contextId, contextId),
					eq(corrections.studentId, studentId),
					eq(corrections.assessmentId, assessmentId)
				)
			);
		if ((existing?.revision ?? 0) !== input.expectedRevision) conflict();
		const values = {
			status: input.status,
			submissionUrl: input.submissionUrl,
			submittedAt: input.submittedAt ? new Date(input.submittedAt) : null,
			latenessDecision: input.latenessDecision
		};
		let correctionId: string;
		if (existing) {
			const changed = await tx
				.update(corrections)
				.set({ ...values, revision: sql`${corrections.revision} + 1` })
				.where(
					and(eq(corrections.id, existing.id), eq(corrections.revision, input.expectedRevision))
				)
				.returning({ id: corrections.id });
			if (!changed.length) conflict();
			correctionId = existing.id;
		} else {
			const [created] = await tx
				.insert(corrections)
				.values({ ...values, contextId, moduleId: context.moduleId, studentId, assessmentId })
				.returning({ id: corrections.id });
			correctionId = created.id;
		}
		// Disabled absence inputs must not overwrite previously recorded raw scores.
		if (!absent)
			for (const score of input.scores)
				await tx
					.insert(scores)
					.values({ ...score, assessmentId, correctionId })
					.onConflictDoUpdate({
						target: [scores.correctionId, scores.lineId],
						set: { points: score.points }
					});
		const [saved] = await readStudents(tx, contextId, studentId);
		for (const correction of saved.corrections) correction.rubricRevision = rubric.module.revision;
		return saved;
	});
}
export async function saveSemesterComment(
	db: Pick<Database, 'transaction'>,
	contextId: string,
	studentId: string,
	value: { expectedRevision: number; content: string }
) {
	const input = validated(semesterCommentWriteSchema, value);
	return db.transaction(async (tx) => {
		await activeContext(tx, contextId);
		await requireRosterEntry(tx, contextId, studentId);
		const [existing] = await tx
			.select()
			.from(semesterComments)
			.where(
				and(eq(semesterComments.contextId, contextId), eq(semesterComments.studentId, studentId))
			);
		if ((existing?.revision ?? 0) !== input.expectedRevision) conflict();
		if (!existing)
			await tx.insert(semesterComments).values({ contextId, studentId, content: input.content });
		else {
			const changed = await tx
				.update(semesterComments)
				.set({ content: input.content, revision: sql`${semesterComments.revision} + 1` })
				.where(
					and(
						eq(semesterComments.id, existing.id),
						eq(semesterComments.revision, input.expectedRevision)
					)
				)
				.returning();
			if (!changed.length) conflict();
		}
		return { content: input.content, revision: input.expectedRevision + 1 };
	});
}
