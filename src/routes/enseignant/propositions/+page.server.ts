import type { PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { getProposalReview } from '#lib/server/teaching/proposals.js';
import { teachingId } from '#lib/server/teaching/http.js';
export const load: PageServerLoad = ({ locals, url }) => {
	requireTeacherPage(locals);
	const id = url.searchParams.get('proposition'),
		context = url.searchParams.get('contexte');
	return withTeacherDatabase(locals, (db) =>
		db.transaction((tx) =>
			getProposalReview(
				tx,
				id ? teachingId(id) : undefined,
				context ? teachingId(context) : undefined
			)
		)
	).then((review) => ({ review }));
};
