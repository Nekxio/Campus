import type { PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { getDetailedCorrection } from '#lib/server/teaching/grading.js';
import { teachingId } from '#lib/server/teaching/http.js';
export const load: PageServerLoad = ({ locals, params }) => {
	requireTeacherPage(locals);
	return withTeacherDatabase(locals, (db) =>
		getDetailedCorrection(db, teachingId(params.contextId), teachingId(params.studentId))
	);
};
