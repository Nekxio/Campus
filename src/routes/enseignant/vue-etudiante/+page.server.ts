import type { PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { listPublishedClasses } from '#lib/server/teaching/student-views.js';
import { listModules } from '#lib/server/teaching/service.js';
import { currentAcademicYear } from '#lib/domain/academic-year.js';

export const load: PageServerLoad = ({ locals }) => {
	requireTeacherPage(locals);
	return withTeacherDatabase(locals, async (db) => {
		const publishedClasses = await listPublishedClasses(db, currentAcademicYear());
		return {
			publishedClasses,
			modules: publishedClasses.length
				? []
				: (await listModules(db)).filter((module) => !module.paused).map(({ id, title }) => ({ id, title }))
		};
	});
};
