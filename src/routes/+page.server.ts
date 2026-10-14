import type { PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { getHomeData } from '#lib/server/teaching/service.js';
export const load: PageServerLoad = async ({ locals }) => {
	const user = requireTeacherPage(locals);
	return { user: { name: user.name }, ...(await withTeacherDatabase(locals, getHomeData)) };
};
