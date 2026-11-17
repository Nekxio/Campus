import type { PageServerLoad } from './$types';
import { teachingId } from '#lib/server/teaching/http.js';
import { withPublicDatabase } from '#lib/server/teaching/public-database.js';
import { getPublicModule, getPublicRecoveryClassId } from '#lib/server/teaching/publications.js';

export const load: PageServerLoad = async ({ params, setHeaders, locals }) => {
	setHeaders({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
	const contextId = teachingId(params.contextId);
	const { published, classId } = await withPublicDatabase(
		(db) =>
			db.transaction(async (tx) => {
				const published = await getPublicModule(tx, contextId);
				const classId = await getPublicRecoveryClassId(tx, published);
				return { published, classId };
			}),
		locals.serverTiming
	);
	locals.publicClassId = classId;
	return published;
};
