import { rubricUpdateSchema } from '#lib/domain/grading.js';
import { teachingEndpoint, teachingId } from '#lib/server/teaching/http.js';
import { replaceRubric } from '#lib/server/teaching/grading.js';
export const PATCH = teachingEndpoint(rubricUpdateSchema, (db, input, event) =>
	replaceRubric(db, teachingId(event.params.moduleId), input)
);
