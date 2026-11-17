import type { Actions, PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import {
	addStudents,
	attachModule,
	changeStudent,
	createClass,
	getClassesData,
	updateClass
} from '#lib/server/teaching/service.js';
import { teachingId } from '#lib/server/teaching/http.js';
import { teacherFormAction } from '#lib/server/teaching/form-actions.js';
import { currentAcademicYear } from '#lib/domain/academic-year.js';
import { idSchema } from '#lib/domain/contracts.js';
import {
	attachModuleSchema,
	classInputSchema,
	classUpdateSchema,
	rosterInputSchema,
	studentDeleteSchema,
	studentUpdateSchema
} from '#lib/domain/teaching.js';
export const load: PageServerLoad = async ({ locals, url }) => {
	requireTeacherPage(locals);
	const selected = url.searchParams.get('classe');
	return withTeacherDatabase(locals, (db) =>
		getClassesData(db, selected ? teachingId(selected) : undefined, currentAcademicYear())
	);
};

const studentIdentity = { classId: idSchema, studentId: idSchema };

export const actions = {
	createClass: teacherFormAction(classInputSchema, (input, { locals }) =>
		withTeacherDatabase(locals, (db) => createClass(db, { ...input, academicYear: currentAcademicYear() }))
	),
	updateClass: teacherFormAction(classUpdateSchema.extend({ classId: idSchema }), ({ classId, ...input }, { locals }) =>
		withTeacherDatabase(locals, (db) => updateClass(db, classId, input))
	),
	addStudent: teacherFormAction(
		rosterInputSchema.options[0].extend({ classId: idSchema }),
		({ classId, ...input }, { locals }) => withTeacherDatabase(locals, (db) => addStudents(db, classId, input))
	),
	importStudents: teacherFormAction(
		rosterInputSchema.options[1].extend({ classId: idSchema }),
		({ classId, ...input }, { locals }) => withTeacherDatabase(locals, (db) => addStudents(db, classId, input))
	),
	updateStudent: teacherFormAction(
		studentUpdateSchema.extend(studentIdentity),
		({ classId, studentId, ...input }, { locals }) =>
			withTeacherDatabase(locals, (db) => changeStudent(db, classId, studentId, input))
	),
	removeStudent: teacherFormAction(
		studentDeleteSchema.extend(studentIdentity),
		({ classId, studentId, ...input }, { locals }) =>
			withTeacherDatabase(locals, (db) => changeStudent(db, classId, studentId, input))
	),
	attachModule: teacherFormAction(
		attachModuleSchema.extend({ classId: idSchema }),
		({ classId, ...input }, { locals }) => withTeacherDatabase(locals, (db) => attachModule(db, classId, input))
	)
} satisfies Actions;
