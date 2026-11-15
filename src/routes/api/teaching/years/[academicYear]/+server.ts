import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireTeacher } from '#lib/server/auth/access.js';
import { annualActionSchema } from '#lib/domain/annual.js';
import { teachingEndpoint } from '#lib/server/teaching/http.js';
import { annualYear, decideAnnualYear } from '#lib/server/teaching/annual.js';
const operation = teachingEndpoint(annualActionSchema, (db, input, event) => {
	if (annualYear(event.params.academicYear) !== input.academicYear)
		error(422, 'L’année confirmée ne correspond pas au dossier ouvert.');
	return decideAnnualYear(db, requireTeacher(event.locals).id, input, {
		purgeQuizRuns: async (runIds) => {
			const { quizRoomStub } = await import('#lib/server/quizzes/http.js');
			for (const id of runIds) await quizRoomStub(event, id).purge();
			return runIds;
		}
	});
});
export const POST: RequestHandler = async (event) => {
	const response = await operation(event);
	response.headers.set('cache-control', 'private, no-store');
	response.headers.set('x-robots-tag', 'noindex, nofollow');
	return response;
};
