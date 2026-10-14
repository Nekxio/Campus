import { isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireTeacher } from '#lib/server/auth/access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { teachingId } from '#lib/server/teaching/http.js';
import { annualYear, getAnnualHistory } from '#lib/server/teaching/annual.js';
const headers = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' };
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		requireTeacher(locals);
		const academicYear = annualYear(params.academicYear),
			contextId = teachingId(params.contextId);
		const history = await withTeacherDatabase(locals, (db) =>
			getAnnualHistory(db, academicYear, contextId)
		);
		return json(history, { headers });
	} catch (cause) {
		return json(
			{ message: isHttpError(cause) ? cause.body.message : 'Historique indisponible. Réessayez.' },
			{ status: isHttpError(cause) ? cause.status : 503, headers }
		);
	}
};
