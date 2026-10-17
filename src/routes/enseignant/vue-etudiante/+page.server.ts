import type { PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { listPublishedClasses } from '#lib/server/teaching/student-views.js';

export const load: PageServerLoad = ({ locals }) => {
	requireTeacherPage(locals);
	return withTeacherDatabase(locals, async (db) => ({
		publishedClasses: await listPublishedClasses(db)
	}));
};
