import { correctionWriteSchema } from '#lib/domain/grading.js';
import { teachingEndpoint, teachingId } from '#lib/server/teaching/http.js';
import { saveCorrection } from '#lib/server/teaching/grading.js';
export const PATCH = teachingEndpoint(correctionWriteSchema, (db, input, event) =>
	saveCorrection(
		db,
		teachingId(event.params.contextId),
		teachingId(event.params.studentId),
		teachingId(event.params.assessmentId),
		input
	)
);
