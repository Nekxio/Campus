import { requireTeacher } from '#lib/server/auth/access.js';
import { quizTeacherRead } from '#lib/server/quizzes/http.js';
import { getQuizRoomCandidates } from '#lib/server/teaching/quiz-rooms.js';

export const GET = quizTeacherRead((db, event) =>
	getQuizRoomCandidates(db, event.params.runId!, requireTeacher(event.locals).id)
);
