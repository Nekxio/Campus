import { error, isHttpError } from '@sveltejs/kit';
import { quizDraftWriteSchema } from '#lib/domain/quiz-content.js';
import { quizRoomOpenSchema } from '#lib/domain/quiz-session.js';
import { requireTeacher } from '#lib/server/auth/access.js';
import { quizRoomStub } from '#lib/server/quizzes/http.js';
import { teacherFormAction } from '#lib/server/teaching/form-actions.js';
import { getQuizRoomCandidates, openQuizRoom } from '#lib/server/teaching/quiz-rooms.js';
import { and, desc, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { getModule } from '#lib/server/teaching/service.js';
import { getRubric } from '#lib/server/teaching/grading.js';
import { teachingId } from '#lib/server/teaching/http.js';
import { getQuizDraft, listQuizDrafts, saveQuizDraft } from '#lib/server/teaching/quizzes.js';
import { quizDrafts, quizRuns } from '#lib/server/db/schema.js';
import { currentAcademicYear } from '#lib/domain/academic-year.js';

export const load: PageServerLoad = ({ locals, params, url, setHeaders }) => {
	const teacher = requireTeacherPage(locals);
	const moduleId = teachingId(params.moduleId);
	const academicYear = currentAcademicYear();
	setHeaders({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' });
	return withTeacherDatabase(locals, async (db) => {
		const [module, rubric, quizzes, runs] = await Promise.all([
			getModule(db, moduleId),
			getRubric(db, moduleId),
			listQuizDrafts(db, moduleId),
			db
				.select({
					id: quizRuns.id,
					quizId: quizRuns.quizId,
					status: quizRuns.status,
					sourceRunId: quizRuns.sourceRunId,
					createdAt: quizRuns.createdAt
				})
				.from(quizRuns)
				.innerJoin(quizDrafts, eq(quizDrafts.id, quizRuns.quizId))
				.where(and(eq(quizDrafts.moduleId, moduleId), eq(quizRuns.teacherId, teacher.id)))
				.orderBy(desc(quizRuns.createdAt))
		]);
		const currentContexts = module.contexts.filter((context) =>
			rubric.contexts.some((item) => item.id === context.id && item.academicYear === academicYear)
		);
		const currentQuizzes = quizzes.filter((quiz) => currentContexts.some((context) => context.id === quiz.contextId));
		const currentRuns = runs.filter((run) => currentQuizzes.some((quiz) => quiz.id === run.quizId));
		const selectedContextId =
			currentContexts.find((context) => context.id === url.searchParams.get('contexte'))?.id ??
			currentContexts[0]?.id ??
			'';
		const latestRuns = currentQuizzes.map((quiz) => currentRuns.find((run) => run.quizId === quiz.id));
		const availableRuns = await Promise.all(
			currentRuns.map(async (run) => {
				if (
					run.status !== 'closed' ||
					!latestRuns.includes(run) ||
					module.paused ||
					runs.some((entry) => entry.quizId === run.quizId && entry.status !== 'closed')
				)
					return { ...run, canOpenFollowUp: false };
				try {
					return { ...run, canOpenFollowUp: (await getQuizRoomCandidates(db, run.id, teacher.id)).length > 0 };
				} catch (cause) {
					if (isHttpError(cause) && cause.status === 409) return { ...run, canOpenFollowUp: false };
					throw cause;
				}
			})
		);
		return { module, rubric, quizzes: currentQuizzes, runs: availableRuns, selectedContextId, academicYear };
	});
};

export const actions = {
	saveQuiz: teacherFormAction(quizDraftWriteSchema, (input, event) => {
		if (input.moduleId !== teachingId(event.params.moduleId)) error(422, 'Choisissez le module exact.');
		return withTeacherDatabase(event.locals, (db) => saveQuizDraft(db, requireTeacher(event.locals).id, input));
	}),
	openRoom: teacherFormAction(quizRoomOpenSchema, (input, event) =>
		withTeacherDatabase(event.locals, async (db) => {
			const quiz = await getQuizDraft(db, input.quizId);
			if (quiz.moduleId !== teachingId(event.params.moduleId)) error(422, 'Choisissez le module exact.');
			if (input.sourceRunId) error(422, 'Ouvrez le rattrapage depuis sa salle de référence.');
			return openQuizRoom(db, (id) => quizRoomStub(event, id), requireTeacher(event.locals).id, input);
		})
	)
} satisfies Actions;
