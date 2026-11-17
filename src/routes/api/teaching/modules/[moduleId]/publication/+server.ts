import { error, isHttpError, json, type RequestHandler } from '@sveltejs/kit';
import { idSchema } from '#lib/domain/contracts.js';
import { publicationDecisionSchema, publicationReviewDataSchema } from '#lib/domain/publication.js';
import { requireTeacher } from '#lib/server/auth/access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { teachingEndpoint, teachingId } from '#lib/server/teaching/http.js';
import { decidePublication, getPublicationReview } from '#lib/server/teaching/publications.js';
import { currentAcademicYear } from '#lib/domain/academic-year.js';

const headers = {
	'cache-control': 'private, no-store',
	'x-robots-tag': 'noindex, nofollow',
	'referrer-policy': 'no-referrer'
};
const readErrors: Record<number, string> = {
	400: 'Paramètres de lecture invalides.',
	401: 'Connexion requise.',
	403: 'Accès refusé.',
	404: 'Cette vérification de publication n’est pas disponible.'
};
export const GET: RequestHandler = async (event) => {
	try {
		requireTeacher(event.locals);
		const moduleId = teachingId(event.params.moduleId);
		const query = event.url.searchParams;
		if ([...query.keys()].some((key) => key !== 'contexte') || query.getAll('contexte').length > 1)
			error(400, 'Paramètres de lecture invalides.');
		const contextId = query.get('contexte') ?? undefined;
		if (contextId !== undefined && !idSchema.safeParse(contextId).success)
			error(400, 'Paramètres de lecture invalides.');
		const review = publicationReviewDataSchema.parse(
			await withTeacherDatabase(event.locals, (db) =>
				db.transaction((tx) => getPublicationReview(tx, moduleId, contextId, currentAcademicYear()))
			)
		);
		if (review.module.id !== moduleId || (contextId !== undefined && review.selected?.context.id !== contextId))
			error(503, 'Lecture indisponible. Réessayez.');
		return json(review, { headers });
	} catch (cause) {
		const status = isHttpError(cause) ? cause.status : 503;
		return json({ message: readErrors[status] ?? 'Lecture indisponible. Réessayez.' }, { status, headers });
	}
};

export const POST = teachingEndpoint(publicationDecisionSchema, (db, input, event) =>
	decidePublication(db, event.locals.user!.id, teachingId(event.params.moduleId), input)
);
