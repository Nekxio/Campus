import { isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireTeacher } from '#lib/server/auth/access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { getFinalGradeExport } from '#lib/server/teaching/grade-export.js';
import { teachingId } from '#lib/server/teaching/http.js';

const headers = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' };
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		requireTeacher(locals);
		const contextId = teachingId(params.contextId);
		const document = await withTeacherDatabase(locals, (db) => getFinalGradeExport(db, contextId));
		return json({ document }, { headers });
	} catch (cause) {
		return json(
			{ message: isHttpError(cause) ? cause.body.message : 'Export indisponible. Réessayez.' },
			{ status: isHttpError(cause) ? cause.status : 503, headers }
		);
	}
};
