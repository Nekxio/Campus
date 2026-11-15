import type { Actions, PageServerLoad } from './$types';
import { z } from 'zod';
import { idSchema } from '#lib/domain/contracts.js';
import { moduleDraftSchema } from '#lib/domain/teaching.js';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { createModule, listClasses } from '#lib/server/teaching/service.js';
import { teacherFormAction } from '#lib/server/teaching/form-actions.js';
import { currentAcademicYear } from '#lib/domain/academic-year.js';

export const actions = {
	createModule: teacherFormAction(
		z.strictObject({ id: idSchema, draft: moduleDraftSchema }),
		(input, { locals }) => withTeacherDatabase(locals, (db) => createModule(db, input.draft, input.id)),
		{ id: 'module-draft' }
	)
} satisfies Actions;
export const load: PageServerLoad = ({ locals }) => {
	requireTeacherPage(locals);
	return withTeacherDatabase(locals, async (db) => ({
		classes: await listClasses(db, currentAcademicYear()),
		module: null
	}));
};
