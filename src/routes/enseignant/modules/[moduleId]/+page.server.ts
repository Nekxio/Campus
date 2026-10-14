import type { PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { listClasses, getModule } from '#lib/server/teaching/service.js';
import { teachingId } from '#lib/server/teaching/http.js';
export const load: PageServerLoad = ({ locals, params }) => {
	requireTeacherPage(locals);
	const id = teachingId(params.moduleId);
	return withTeacherDatabase(locals, async (db) => ({
		classes: await listClasses(db),
		module: await getModule(db, id)
	}));
};
