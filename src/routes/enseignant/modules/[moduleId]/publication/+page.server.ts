import type { PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { teachingId } from '#lib/server/teaching/http.js';
import { getPublicationReview } from '#lib/server/teaching/publications.js';

export const load: PageServerLoad = ({ locals, params, url }) => {
	requireTeacherPage(locals);
	const moduleId = teachingId(params.moduleId);
	const contextId = url.searchParams.has('contexte')
		? teachingId(url.searchParams.get('contexte')!)
		: undefined;
	return withTeacherDatabase(locals, (db) =>
		db.transaction((tx) => getPublicationReview(tx, moduleId, contextId))
	);
};
