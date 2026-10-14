import { isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { moduleDetailSchema, moduleUpdateSchema } from '#lib/domain/teaching.js';
import { requireTeacher } from '#lib/server/auth/access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { teachingEndpoint, teachingId } from '#lib/server/teaching/http.js';
import { getModule, updateModule } from '#lib/server/teaching/service.js';
const headers = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' };
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		requireTeacher(locals);
		const id = teachingId(params.moduleId);
		const module = await withTeacherDatabase(locals, (db) =>
			db.transaction((tx) => getModule(tx, id))
		);
		return json(moduleDetailSchema.parse(module), { headers });
	} catch (cause) {
		return json(
			{ message: isHttpError(cause) ? cause.body.message : 'Lecture indisponible. Réessayez.' },
			{ status: isHttpError(cause) ? cause.status : 503, headers }
		);
	}
};
export const PATCH = teachingEndpoint(moduleUpdateSchema, (db, input, event) =>
	updateModule(db, teachingId(event.params.moduleId), input)
);
