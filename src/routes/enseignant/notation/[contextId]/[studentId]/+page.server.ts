import type { Actions, PageServerLoad } from './$types';
import { z } from 'zod';
import { idSchema } from '#lib/domain/contracts.js';
import { correctionWriteSchema, semesterCommentWriteSchema } from '#lib/domain/grading.js';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { getDetailedCorrection, saveCorrection, saveSemesterComment } from '#lib/server/teaching/grading.js';
import { teachingId } from '#lib/server/teaching/http.js';
import { teacherFormAction } from '#lib/server/teaching/form-actions.js';

export const actions = {
	saveAssessment: teacherFormAction(
		z.strictObject({ assessmentId: idSchema, correction: correctionWriteSchema }),
		(input, { locals, params }) =>
			withTeacherDatabase(locals, (db) =>
				saveCorrection(
					db,
					teachingId(params.contextId),
					teachingId(params.studentId),
					input.assessmentId,
					input.correction
				)
			),
		{ id: 'assessment-correction' }
	),
	saveComment: teacherFormAction(
		semesterCommentWriteSchema,
		(input, { locals, params }) =>
			withTeacherDatabase(locals, (db) =>
				saveSemesterComment(db, teachingId(params.contextId), teachingId(params.studentId), input)
			),
		{ id: 'semester-comment' }
	)
} satisfies Actions;
export const load: PageServerLoad = ({ locals, params }) => {
	requireTeacherPage(locals);
	return withTeacherDatabase(locals, (db) =>
		getDetailedCorrection(db, teachingId(params.contextId), teachingId(params.studentId))
	);
};
