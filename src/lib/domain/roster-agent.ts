import { z } from 'zod';
import { idSchema, revisionSchema } from './contracts.js';
import { classInputSchema, studentNameSchema } from './teaching.js';

export type RosterAgentAction = 'roster_manage';
export const rosterAgentPermissions = { 'class-rosters': ['manage'] };
export const createAgentClassSchema = classInputSchema.extend({ id: idSchema });
export const classRosterRequestSchema = z.strictObject({ classId: idSchema });
export const addAgentStudentsSchema = z
	.strictObject({
		classId: idSchema,
		expectedRevision: revisionSchema,
		students: z
			.array(z.strictObject({ id: idSchema, name: studentNameSchema }))
			.min(1)
			.max(500)
	})
	.superRefine((value, ctx) => {
		if (new Set(value.students.map((student) => student.id)).size !== value.students.length)
			ctx.addIssue({
				code: 'custom',
				path: ['students'],
				message: 'Chaque étudiant doit avoir un identifiant unique.'
			});
	});
export const classRosterSchema = z.strictObject({
	id: idSchema,
	name: studentNameSchema,
	academicYear: classInputSchema.shape.academicYear,
	revision: revisionSchema,
	students: z.array(
		z.strictObject({
			id: idSchema,
			name: studentNameSchema,
			position: z.int().nonnegative(),
			revision: revisionSchema
		})
	)
});
