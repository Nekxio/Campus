import type { Actions, PageServerLoad } from './$types';
import { rubricUpdateSchema } from '#lib/domain/grading.js';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { getRubric, replaceRubric } from '#lib/server/teaching/grading.js';
import { teachingId } from '#lib/server/teaching/http.js';
import { teacherFormAction } from '#lib/server/teaching/form-actions.js';

export const actions = {
	saveRubric: teacherFormAction(
		rubricUpdateSchema,
		(input, { locals, params }) =>
			withTeacherDatabase(locals, (db) => replaceRubric(db, teachingId(params.moduleId), input)),
		{ id: 'module-rubric' }
	)
} satisfies Actions;
export const load: PageServerLoad = ({ locals, params }) => {
	requireTeacherPage(locals);
	return withTeacherDatabase(locals, async (db) => ({
		rubric: await getRubric(db, teachingId(params.moduleId))
	}));
};
