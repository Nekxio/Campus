import { studentUpdateSchema, studentDeleteSchema } from '#lib/domain/teaching.js';
import { teachingEndpoint, teachingId } from '#lib/server/teaching/http.js';
import { changeStudent } from '#lib/server/teaching/service.js';
export const PATCH = teachingEndpoint(studentUpdateSchema, (db, input, event) =>
	changeStudent(db, teachingId(event.params.classId), teachingId(event.params.studentId), input)
);
export const DELETE = teachingEndpoint(studentDeleteSchema, (db, input, event) =>
	changeStudent(db, teachingId(event.params.classId), teachingId(event.params.studentId), input)
);
