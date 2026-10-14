import type { PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { getRubric } from '#lib/server/teaching/grading.js';
import { teachingId } from '#lib/server/teaching/http.js';
export const load: PageServerLoad = ({ locals, params }) => {
	requireTeacherPage(locals);
	return withTeacherDatabase(locals, async (db) => ({
		rubric: await getRubric(db, teachingId(params.moduleId))
	}));
};
