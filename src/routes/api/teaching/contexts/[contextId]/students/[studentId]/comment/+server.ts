import { semesterCommentWriteSchema } from '#lib/domain/grading.js';
import { teachingEndpoint, teachingId } from '#lib/server/teaching/http.js';
import { saveSemesterComment } from '#lib/server/teaching/grading.js';
export const PATCH = teachingEndpoint(semesterCommentWriteSchema, (db, input, event) =>
	saveSemesterComment(
		db,
		teachingId(event.params.contextId),
		teachingId(event.params.studentId),
		input
	)
);
