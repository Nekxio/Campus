import { error } from '@sveltejs/kit';
import { asc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { createAgentClassSchema, addAgentStudentsSchema } from '../../domain/roster-agent.js';
import type { Database } from '../db/index.js';
import { classes, students } from '../db/schema.js';
import { requireActiveYear } from '../teaching/annual-access.js';
import { createClassRecord, addStudentRecords } from '../teaching/service.js';

type Store = Pick<Database, 'select'>;
const conflict = (): never =>
	error(409, 'Identifiants ou révision incompatibles. Relisez la classe avant une nouvelle commande.');
export const readClassRoster = async (db: Store, classId: string) => {
	const [record] = await db
		.select({
			id: classes.id,
			name: classes.name,
			academicYear: classes.academicYear,
			revision: classes.revision
		})
		.from(classes)
		.where(eq(classes.id, classId));
	if (!record) error(404, 'Classe indisponible.');
	const roster = await db
		.select({
			id: students.id,
			name: students.name,
			revision: students.revision,
			position: students.position
		})
		.from(students)
		.where(eq(students.classId, classId))
		.orderBy(asc(students.position), asc(students.id));
	return { ...record, students: roster };
};
export const createAgentClass = async (
	db: Database,
	_teacherId: string,
	value: z.infer<typeof createAgentClassSchema>
) => {
	const input = createAgentClassSchema.parse(value);
	return db.transaction(async (tx) => {
		await requireActiveYear(tx, input.academicYear);
		const [existing] = await tx.select().from(classes).where(eq(classes.id, input.id));
		if (existing) {
			if (existing.name !== input.name || existing.academicYear !== input.academicYear) conflict();
		} else await createClassRecord(tx, { name: input.name, academicYear: input.academicYear }, input.id);
		return { id: input.id };
	});
};
export const addAgentStudents = async (
	db: Database,
	_teacherId: string,
	value: z.infer<typeof addAgentStudentsSchema>
) => {
	const input = addAgentStudentsSchema.parse(value);
	return db.transaction(async (tx) => {
		const [selected] = await tx.select().from(classes).where(eq(classes.id, input.classId));
		if (!selected) error(404, 'Classe indisponible.');
		await requireActiveYear(tx, selected.academicYear);
		const existing = await tx
			.select()
			.from(students)
			.where(
				inArray(
					students.id,
					input.students.map((student) => student.id)
				)
			);
		if (existing.length) {
			if (
				existing.length !== input.students.length ||
				existing.some(
					(student) =>
						student.classId !== input.classId ||
						student.name !== input.students.find((candidate) => candidate.id === student.id)?.name
				)
			)
				conflict();
		} else {
			await addStudentRecords(tx, input.classId, {
				kind: 'identified',
				students: input.students,
				expectedRevision: input.expectedRevision
			});
		}
		return {
			classId: input.classId,
			revision: (await readClassRoster(tx, input.classId)).revision,
			studentIds: input.students.map((student) => student.id)
		};
	});
};
