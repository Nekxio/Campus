import { rosterInputSchema } from '#lib/domain/teaching.js';
import { teachingEndpoint, teachingId } from '#lib/server/teaching/http.js';
import { addStudents } from '#lib/server/teaching/service.js';
export const POST = teachingEndpoint(rosterInputSchema, (db, input, event) =>
	addStudents(db, teachingId(event.params.classId), input)
);
