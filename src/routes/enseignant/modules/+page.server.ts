import type { PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { listModules } from '#lib/server/teaching/service.js';

export const load: PageServerLoad = async ({ locals }) => {
	requireTeacherPage(locals);
	return { modules: await withTeacherDatabase(locals, listModules) };
};
