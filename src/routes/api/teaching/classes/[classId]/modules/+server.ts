import { attachModuleSchema } from '#lib/domain/teaching.js';
import { teachingEndpoint, teachingId } from '#lib/server/teaching/http.js';
import { attachModule } from '#lib/server/teaching/service.js';
export const POST = teachingEndpoint(attachModuleSchema, (db, input, event) =>
	attachModule(db, teachingId(event.params.classId), input)
);
