import { quizDraftWriteSchema } from '#lib/domain/quiz-content.js';
import { requireTeacher } from '#lib/server/auth/access.js';
import { quizTeacherRead, quizTeacherWrite } from '#lib/server/quizzes/http.js';
import { teachingId } from '#lib/server/teaching/http.js';
import { listQuizDrafts, saveQuizDraft } from '#lib/server/teaching/quizzes.js';

export const GET = quizTeacherRead(async (db, event) => ({
	quizzes: await listQuizDrafts(
		db,
		teachingId(event.url.searchParams.get('moduleId') ?? undefined),
		event.url.searchParams.has('contextId') ? teachingId(event.url.searchParams.get('contextId')!) : undefined
	)
}));
export const POST = quizTeacherWrite(quizDraftWriteSchema, (db, event, input) =>
	saveQuizDraft(db, requireTeacher(event.locals).id, input)
);
