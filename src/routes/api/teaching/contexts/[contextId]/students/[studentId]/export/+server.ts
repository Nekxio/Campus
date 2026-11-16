import { isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireTeacher } from '#lib/server/auth/access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { getStudentGradeExport } from '#lib/server/teaching/grade-export.js';
import { teachingId } from '#lib/server/teaching/http.js';
const headers = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' };
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		requireTeacher(locals);
		const contextId = teachingId(params.contextId),
			studentId = teachingId(params.studentId);
		return json(
			{
				document: await withTeacherDatabase(locals, (db) => getStudentGradeExport(db, contextId, studentId))
			},
			{ headers }
		);
	} catch (cause) {
		return json(
			{ message: isHttpError(cause) ? cause.body.message : 'Export indisponible. Réessayez.' },
			{ status: isHttpError(cause) ? cause.status : 503, headers }
		);
	}
};
