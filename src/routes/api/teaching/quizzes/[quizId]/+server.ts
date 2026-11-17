import { error } from '@sveltejs/kit';
import { quizDraftWriteSchema } from '#lib/domain/quiz-content.js';
import { requireTeacher } from '#lib/server/auth/access.js';
import { quizTeacherRead, quizTeacherWrite } from '#lib/server/quizzes/http.js';
import { teachingId } from '#lib/server/teaching/http.js';
import { getQuizDraft, saveQuizDraft } from '#lib/server/teaching/quizzes.js';

export const GET = quizTeacherRead((db, event) => getQuizDraft(db, teachingId(event.params.quizId)));
export const PATCH = quizTeacherWrite(quizDraftWriteSchema, (db, event, input) => {
	if (input.id !== teachingId(event.params.quizId)) error(422, 'Choisissez le quiz exact.');
	return saveQuizDraft(db, requireTeacher(event.locals).id, input);
});
