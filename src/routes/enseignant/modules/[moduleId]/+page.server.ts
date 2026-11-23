import type { Actions, PageServerLoad } from './$types';
import { moduleUpdateSchema } from '#lib/domain/teaching.js';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { listClasses, getModule, listDossierAssessments, updateModule } from '#lib/server/teaching/service.js';
import { teachingId } from '#lib/server/teaching/http.js';
import { getPublishedModulePath } from '#lib/server/teaching/student-views.js';
import { getManagedLessons } from '#lib/server/calendar/lesson-ownership.js';
import { teacherFormAction } from '#lib/server/teaching/form-actions.js';

export const actions = {
	saveModule: teacherFormAction(
		moduleUpdateSchema,
		(input, { locals, params }) =>
			withTeacherDatabase(locals, (db) => updateModule(db, teachingId(params.moduleId), input)),
		{ id: 'module-draft' }
	)
} satisfies Actions;
export const load: PageServerLoad = ({ locals, params }) => {
	requireTeacherPage(locals);
	const id = teachingId(params.moduleId);
	return withTeacherDatabase(locals, async (db) => {
		const [classes, module, managedLessons, publishedPath, dossierAssessments] = await Promise.all([
			listClasses(db),
			getModule(db, id),
			getManagedLessons(db, id),
			getPublishedModulePath(db, id),
			listDossierAssessments(db, id)
		]);
		return { classes, module, managedLessons, publishedPath, dossierAssessments };
	});
};
