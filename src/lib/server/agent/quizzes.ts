import { error } from '@sveltejs/kit';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { assessments, lessons, modules, quizDrafts, quizRuns, rubricLines, teachingContexts } from '../db/schema.js';
import {
	createAgentQuizSchema,
	patchAgentQuizSchema,
	quizContextRequestSchema,
	quizContextSchema,
	type AgentQuizPatch,
	type QuizContext,
	type QuizContextRequest
} from '../../domain/quiz-agent.js';
import type { QuizDraftWrite } from '../../domain/quiz-content.js';
import { getQuizDraft, patchQuizDraft, saveQuizDraft } from '../teaching/quizzes.js';

export const readQuizContext = async (db: Database, value: QuizContextRequest): Promise<QuizContext> => {
	const input = quizContextRequestSchema.parse(value);
	return db.transaction(async (tx) => {
		const [module] = await tx
			.select({ id: modules.id, title: modules.title, revision: modules.revision })
			.from(modules)
			.where(eq(modules.id, input.moduleId));
		if (!module) error(404, 'Ce module est indisponible.');
		const contexts = await tx
			.select({
				id: teachingContexts.id,
				classId: teachingContexts.classId,
				className: teachingContexts.className,
				academicYear: teachingContexts.academicYear,
				revision: teachingContexts.revision,
				archivedAt: teachingContexts.archivedAt
			})
			.from(teachingContexts)
			.where(
				and(
					eq(teachingContexts.moduleId, module.id),
					...(input.contextId ? [eq(teachingContexts.id, input.contextId)] : [])
				)
			)
			.orderBy(asc(teachingContexts.academicYear), asc(teachingContexts.id));
		if (input.contextId && !contexts.length) error(404, 'Ce contexte est indisponible.');
		const lessonRows = await tx
			.select({ id: lessons.id, contextId: lessons.contextId, title: lessons.title })
			.from(lessons)
			.innerJoin(teachingContexts, eq(lessons.contextId, teachingContexts.id))
			.where(
				and(
					eq(teachingContexts.moduleId, module.id),
					...(input.contextId ? [eq(lessons.contextId, input.contextId)] : [])
				)
			)
			.orderBy(asc(lessons.startsAt), asc(lessons.id));
		const scoringLines = await tx
			.select({
				assessmentId: assessments.id,
				assessmentTitle: assessments.title,
				lineId: rubricLines.id,
				label: rubricLines.label,
				maxPoints: rubricLines.maxPoints
			})
			.from(rubricLines)
			.innerJoin(assessments, eq(rubricLines.assessmentId, assessments.id))
			.where(
				and(
					eq(assessments.moduleId, module.id),
					eq(assessments.kind, 'quiz'),
					eq(assessments.purpose, 'graded'),
					isNull(assessments.retiredAt),
					isNull(rubricLines.retiredAt)
				)
			)
			.orderBy(asc(assessments.position), asc(rubricLines.position));
		const quizzes = await tx
			.select({
				id: quizDrafts.id,
				contextId: quizDrafts.contextId,
				lessonId: quizDrafts.lessonId,
				assessmentId: quizDrafts.assessmentId,
				lineId: quizDrafts.lineId,
				revision: quizDrafts.revision,
				needsReview: quizDrafts.needsReview,
				title: sql<string>`json_extract(${quizDrafts.content}, '$.title')`,
				durationSeconds: sql<number>`json_extract(${quizDrafts.content}, '$.durationSeconds')`,
				questionCount: sql<number>`json_array_length(${quizDrafts.content}, '$.questions')`,
				frozen: sql<number>`EXISTS (SELECT 1 FROM ${quizRuns} WHERE ${quizRuns.quizId} = ${quizDrafts.id})`.mapWith(
					Boolean
				)
			})
			.from(quizDrafts)
			.where(
				and(eq(quizDrafts.moduleId, module.id), ...(input.contextId ? [eq(quizDrafts.contextId, input.contextId)] : []))
			)
			.orderBy(asc(quizDrafts.createdAt), asc(quizDrafts.id));
		const quiz = input.quizId ? await getQuizDraft(tx, input.quizId) : null;
		if (quiz && (quiz.moduleId !== module.id || (input.contextId && quiz.contextId !== input.contextId)))
			error(404, 'Ce quiz est indisponible.');
		return quizContextSchema.parse({
			version: 1,
			module,
			contexts: contexts.map(({ archivedAt, ...context }) => ({
				...context,
				archived: archivedAt !== null,
				lessons: lessonRows.filter((lesson) => lesson.contextId === context.id).map(({ id, title }) => ({ id, title }))
			})),
			scoringLines,
			quizzes,
			quiz
		});
	});
};

export const createAgentQuizDraft = async (db: Database, teacherId: string, value: QuizDraftWrite) =>
	saveQuizDraft(db, teacherId, createAgentQuizSchema.parse(value), { markForReview: true });

export const patchAgentQuizDraft = async (db: Database, teacherId: string, value: AgentQuizPatch) => {
	const { moduleId, ...input } = patchAgentQuizSchema.parse(value);
	const quiz = await getQuizDraft(db, input.id);
	if (quiz.moduleId !== moduleId) error(404, 'Ce quiz est indisponible.');
	return patchQuizDraft(db, teacherId, input, { markForReview: true });
};
