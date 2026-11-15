import type { RequestEvent } from '@sveltejs/kit';
import { annualActionSchema } from '#lib/domain/annual.js';
import { requireTeacher } from '#lib/server/auth/access.js';
import { teacherFormAction } from '#lib/server/teaching/form-actions.js';
import type { Actions, PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { annualYear, decideAnnualYear, getAnnualData } from '#lib/server/teaching/annual.js';
const quizCleanup = (event: RequestEvent) => ({
	purgeQuizRuns: async (runIds: readonly string[]) => {
		const { quizRoomStub } = await import('#lib/server/quizzes/http.js');
		for (const id of runIds) await quizRoomStub(event, id).purge();
		return runIds;
	}
});
export const load: PageServerLoad = async (event) => {
	const { locals, url, setHeaders } = event;
	const teacher = requireTeacherPage(locals);
	setHeaders({ 'cache-control': 'private, no-store' });
	const selected = url.searchParams.get('annee');
	return withTeacherDatabase(locals, (db) =>
		getAnnualData(db, teacher.id, selected ? annualYear(selected) : undefined, quizCleanup(event))
	);
};

export const actions = {
	decideYear: teacherFormAction(annualActionSchema, (input, event) =>
		withTeacherDatabase(event.locals, (db) =>
			decideAnnualYear(db, requireTeacher(event.locals).id, input, quizCleanup(event))
		)
	)
} satisfies Actions;
