import type { PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { listClasses } from '#lib/server/teaching/service.js';
export const load: PageServerLoad = ({ locals }) => {
	requireTeacherPage(locals);
	return withTeacherDatabase(locals, async (db) => ({
		classes: await listClasses(db),
		module: null
	}));
};
