import type { PageServerLoad } from './$types';
import { teachingId } from '#lib/server/teaching/http.js';
import { withPublicDatabase } from '#lib/server/teaching/public-database.js';
import { getPublicClass } from '#lib/server/teaching/publications.js';

export const load: PageServerLoad = ({ params, setHeaders }) => {
	setHeaders({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
	const classId = teachingId(params.classId);
	return withPublicDatabase((db) => db.transaction((tx) => getPublicClass(tx, classId)));
};
