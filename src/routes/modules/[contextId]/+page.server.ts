import type { PageServerLoad } from './$types';
import { teachingId } from '#lib/server/teaching/http.js';
import { withPublicDatabase } from '#lib/server/teaching/public-database.js';
import { getPublicModule } from '#lib/server/teaching/publications.js';

export const load: PageServerLoad = ({ params, setHeaders }) => {
	setHeaders({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
	const contextId = teachingId(params.contextId);
	return withPublicDatabase((db) => getPublicModule(db, contextId));
};
