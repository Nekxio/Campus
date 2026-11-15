import { classUpdateSchema } from '#lib/domain/teaching.js';
import { teachingEndpoint, teachingId } from '#lib/server/teaching/http.js';
import { updateClass } from '#lib/server/teaching/service.js';
export const PATCH = teachingEndpoint(classUpdateSchema, (db, input, event) =>
	updateClass(db, teachingId(event.params.classId), input)
);
