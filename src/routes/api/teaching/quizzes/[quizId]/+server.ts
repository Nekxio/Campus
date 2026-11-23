import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { quizArchiveSchema, quizDraftWriteSchema } from '#lib/domain/quiz-content.js';
import { requireTeacher } from '#lib/server/auth/access.js';
import { quizTeacherRead, quizTeacherWrite } from '#lib/server/quizzes/http.js';
import { teachingId } from '#lib/server/teaching/http.js';
import { getQuizDraft, saveQuizDraft, setQuizArchive } from '#lib/server/teaching/quizzes.js';

export const GET = quizTeacherRead((db, event) => getQuizDraft(db, teachingId(event.params.quizId)));
export const PATCH = quizTeacherWrite(z.union([quizDraftWriteSchema, quizArchiveSchema]), (db, event, input) => {
	if (input.id !== teachingId(event.params.quizId)) error(422, 'Choisissez le quiz exact.');
	const teacher = requireTeacher(event.locals);
	return 'archived' in input ? setQuizArchive(db, teacher.id, input) : saveQuizDraft(db, teacher.id, input);
});
