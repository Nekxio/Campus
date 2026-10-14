import type { PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { annualYear, getAnnualData } from '#lib/server/teaching/annual.js';
export const load: PageServerLoad = async ({ locals, url, setHeaders }) => {
	requireTeacherPage(locals);
	setHeaders({ 'cache-control': 'private, no-store' });
	const selected = url.searchParams.get('annee');
	return withTeacherDatabase(locals, (db) =>
		getAnnualData(db, selected ? annualYear(selected) : undefined)
	);
};
