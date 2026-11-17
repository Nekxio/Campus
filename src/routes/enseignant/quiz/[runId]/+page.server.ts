import { quizRoomOpenSchema } from '#lib/domain/quiz-session.js';
import { requireTeacher } from '#lib/server/auth/access.js';
import { quizRoomStub } from '#lib/server/quizzes/http.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { teacherFormAction } from '#lib/server/teaching/form-actions.js';
import { openQuizRoom } from '#lib/server/teaching/quiz-rooms.js';
import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { teachingId } from '#lib/server/teaching/http.js';
import { quizRoomPageSchema } from '#lib/quizzes/teacher-room.js';

export const load: PageServerLoad = async ({ locals, params, fetch, setHeaders }) => {
	requireTeacherPage(locals);
	setHeaders({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' });
	const id = teachingId(params.runId);
	const response = await fetch(`/api/teaching/quiz-rooms/${id}`);
	if (!response.ok) error(response.status, 'Cette salle est indisponible. Réessayez depuis le module.');
	const data = quizRoomPageSchema.safeParse(await response.json());
	if (!data.success || data.data.run.id !== id || data.data.view.id !== id)
		error(503, 'État de la salle indisponible.');
	return data.data;
};

export const actions = {
	createRetake: teacherFormAction(quizRoomOpenSchema, (input, event) => {
		if (input.sourceRunId !== teachingId(event.params.runId)) error(422, 'Choisissez la salle exacte à rattraper.');
		return withTeacherDatabase(event.locals, (db) =>
			openQuizRoom(db, (id) => quizRoomStub(event, id), requireTeacher(event.locals).id, input)
		);
	})
} satisfies Actions;
