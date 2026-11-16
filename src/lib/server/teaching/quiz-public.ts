import { error } from '@sveltejs/kit';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { idSchema } from '../../domain/contracts.js';
import { publicModuleLinks, quizDrafts, quizRuns, teachingContexts } from '../db/schema.js';
import { getPublicModule } from './publications.js';
import { requireQuizRun } from './quiz-rooms.js';

type Store = Pick<Database, 'select'>;
const publicQuizContext = async (db: Store, publicId: string) => {
	if (!idSchema.safeParse(publicId).success) error(404, 'Quiz indisponible.');
	await getPublicModule(db, publicId);
	const [link] = await db.select().from(publicModuleLinks).where(eq(publicModuleLinks.id, publicId));
	const contextId = link?.contextId ?? publicId;
	const [context] = await db.select().from(teachingContexts).where(eq(teachingContexts.id, contextId));
	if (!context || context.archivedAt || !context.classId) error(404, 'Quiz indisponible.');
	return context;
};

export const listPublicQuizzes = async (db: Store, publicId: string) => {
	const context = await publicQuizContext(db, publicId);
	const quizzes = await db
		.select()
		.from(quizDrafts)
		.where(eq(quizDrafts.contextId, context.id))
		.orderBy(asc(quizDrafts.createdAt));
	const runs = await db
		.select()
		.from(quizRuns)
		.where(eq(quizRuns.contextId, context.id))
		.orderBy(desc(quizRuns.createdAt), desc(quizRuns.id));
	return quizzes
		.filter((quiz) => quiz.lessonId && !quiz.needsReview)
		.map((quiz) => {
			const run = runs.find((entry) => entry.quizId === quiz.id);
			return {
				id: quiz.id,
				title: quiz.content.title,
				lessonId: quiz.lessonId,
				durationSeconds: quiz.content.durationSeconds,
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
		.where(and(eq(quizRuns.id, runId), eq(quizRuns.contextId, context.id)));
	if (!scopedRun) error(404, 'Quiz indisponible.');
	const run = await requireQuizRun(db, scopedRun.id);
	const [quiz] = await db
		.select({ id: quizDrafts.id })
		.from(quizDrafts)
		.where(and(eq(quizDrafts.id, run.quizId), eq(quizDrafts.contextId, context.id), eq(quizDrafts.needsReview, false)));
	if (!quiz) error(404, 'Quiz indisponible.');
	return run;
};
