import { publicationDecisionSchema } from '#lib/domain/publication.js';
import { requireTeacher } from '#lib/server/auth/access.js';
import { teacherFormAction } from '#lib/server/teaching/form-actions.js';
import type { Actions, PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { teachingId } from '#lib/server/teaching/http.js';
import { decidePublication, getPublicationReview } from '#lib/server/teaching/publications.js';
import { currentAcademicYear } from '#lib/domain/academic-year.js';

export const load: PageServerLoad = ({ locals, params, url }) => {
	requireTeacherPage(locals);
	const moduleId = teachingId(params.moduleId);
	const contextId = url.searchParams.has('contexte') ? teachingId(url.searchParams.get('contexte')!) : undefined;
	return withTeacherDatabase(locals, (db) =>
		db.transaction((tx) => getPublicationReview(tx, moduleId, contextId, currentAcademicYear()))
	);
};

export const actions = {
	decidePublication: teacherFormAction(publicationDecisionSchema, (input, event) =>
		withTeacherDatabase(event.locals, (db) =>
			decidePublication(db, requireTeacher(event.locals).id, teachingId(event.params.moduleId), input)
		)
	)
} satisfies Actions;
