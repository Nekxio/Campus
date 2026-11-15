import { error } from '@sveltejs/kit';
import { requireTeacher } from '#lib/server/auth/access.js';
import { quizRoomStub, quizTeacherWrite } from '#lib/server/quizzes/http.js';
import { teachingId } from '#lib/server/teaching/http.js';
import { openQuizRoom, quizRoomOpenSchema } from '#lib/server/teaching/quiz-rooms.js';

export const POST = quizTeacherWrite(quizRoomOpenSchema, (db, event, input) => {
	if (input.quizId !== teachingId(event.params.quizId)) error(422, 'Choisissez le quiz exact.');
	return openQuizRoom(db, (id) => quizRoomStub(event, id), requireTeacher(event.locals).id, input);
});
