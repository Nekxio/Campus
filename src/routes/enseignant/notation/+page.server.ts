import type { PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { getGradeGrid } from '#lib/server/teaching/grading.js';
import { teachingId } from '#lib/server/teaching/http.js';
export const load: PageServerLoad = ({ locals, url }) => {
	requireTeacherPage(locals);
	const moduleId = url.searchParams.get('module');
	const contextId = url.searchParams.get('contexte');
	return withTeacherDatabase(locals, (db) =>
		getGradeGrid(
			db,
			moduleId ? teachingId(moduleId) : undefined,
			contextId ? teachingId(contextId) : undefined
		)
	).then((grid) => ({ grid }));
};
