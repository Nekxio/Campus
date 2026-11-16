import type { PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { getHomeData } from '#lib/server/teaching/service.js';
import { validTeachingMonth } from '#lib/teaching/calendar.js';
export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireTeacherPage(locals);
	const month = validTeachingMonth(url.searchParams.get('mois'));
	return {
		user: { name: user.name },
		...(await withTeacherDatabase(locals, (db) => getHomeData(db, new Date(), month)))
	};
};
