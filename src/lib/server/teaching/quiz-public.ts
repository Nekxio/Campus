import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { idSchema } from '../../domain/contracts.js';
import { lessons, publicModuleLinks, quizDrafts, quizRuns, teachingContexts } from '../db/schema.js';
import { getPublicModule } from './publications.js';
import { requireQuizRun } from './quiz-rooms.js';

type Store = Pick<Database, 'select'>;
const publicQuizContext = async (db: Store, publicId: string) => {
	if (!idSchema.safeParse(publicId).success) error(404, 'Quiz indisponible.');
	await getPublicModule(db, publicId);
	const [link] = await db
		.select({ contextId: publicModuleLinks.contextId })
		.from(publicModuleLinks)
		.where(eq(publicModuleLinks.id, publicId));
	const contextId = link?.contextId ?? publicId;
	const [context] = await db
		.select({ id: teachingContexts.id, archivedAt: teachingContexts.archivedAt, classId: teachingContexts.classId })
		.from(teachingContexts)
		.where(eq(teachingContexts.id, contextId));
	if (!context || context.archivedAt || !context.classId) error(404, 'Quiz indisponible.');
	return context;
};

export const listPublicQuizzes = async (db: Store, publicId: string) => {
	const context = await publicQuizContext(db, publicId);
	const quizzes = await db
		.select({
			id: quizDrafts.id,
			title: sql<string>`json_extract(${quizDrafts.content}, '$.title')`,
			lessonId: lessons.id,
			durationSeconds: sql<number>`json_extract(${quizDrafts.content}, '$.durationSeconds')`
		})
		.from(quizDrafts)
		.innerJoin(lessons, and(eq(quizDrafts.lessonId, lessons.id), eq(lessons.contextId, quizDrafts.contextId)))
		.where(and(eq(quizDrafts.contextId, context.id), eq(quizDrafts.archived, false), eq(quizDrafts.needsReview, false)))
		.orderBy(asc(lessons.startsAt), asc(lessons.id), asc(quizDrafts.id));
	const runs = await db
		.select({ id: quizRuns.id, quizId: quizRuns.quizId, status: quizRuns.status })
		.from(quizRuns)
		.where(eq(quizRuns.contextId, context.id))
		.orderBy(desc(quizRuns.createdAt), desc(quizRuns.id));
	return quizzes.map((quiz) => {
		const run = runs.find((entry) => entry.quizId === quiz.id);
		return {
			id: quiz.id,
			title: quiz.title,
			lessonId: quiz.lessonId,
			durationSeconds: quiz.durationSeconds,
			status: run?.status ?? 'locked',
			runId: run?.id ?? null
		};
	});
};

export const requirePublicQuizRun = async (db: Store, publicId: string, runId: string) => {
	const context = await publicQuizContext(db, publicId);
	if (!idSchema.safeParse(runId).success) error(404, 'Quiz indisponible.');
	const [scopedRun] = await db
		.select({ id: quizRuns.id })
		.from(quizRuns)
		.innerJoin(quizDrafts, and(eq(quizDrafts.id, quizRuns.quizId), eq(quizDrafts.contextId, quizRuns.contextId)))
		.where(
			and(
				eq(quizRuns.id, runId),
				eq(quizRuns.contextId, context.id),
				eq(quizDrafts.archived, false),
				eq(quizDrafts.needsReview, false)
			)
		);
	if (!scopedRun) error(404, 'Quiz indisponible.');
	return requireQuizRun(db, scopedRun.id);
};
