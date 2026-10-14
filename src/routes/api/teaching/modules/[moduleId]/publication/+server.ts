import { publicationDecisionSchema } from '#lib/domain/publication.js';
import { teachingEndpoint, teachingId } from '#lib/server/teaching/http.js';
import { decidePublication } from '#lib/server/teaching/publications.js';

export const POST = teachingEndpoint(publicationDecisionSchema, (db, input, event) =>
	decidePublication(db, event.locals.user!.id, teachingId(event.params.moduleId), input)
);
