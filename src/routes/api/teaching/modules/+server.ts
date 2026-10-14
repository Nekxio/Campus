import { moduleDraftSchema } from '#lib/domain/teaching.js';
import { teachingEndpoint, teachingId } from '#lib/server/teaching/http.js';
import { createModule } from '#lib/server/teaching/service.js';
export const POST = teachingEndpoint(moduleDraftSchema, (db, input, event) =>
	createModule(db, input, teachingId(event.request.headers.get('Idempotency-Key') ?? undefined))
);
