import type { PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { getClassesData } from '#lib/server/teaching/service.js';
import { teachingId } from '#lib/server/teaching/http.js';
export const load: PageServerLoad = async ({ locals, url }) => {
	requireTeacherPage(locals);
	const selected = url.searchParams.get('classe');
	return withTeacherDatabase(locals, (db) =>
		getClassesData(db, selected ? teachingId(selected) : undefined)
	);
};
