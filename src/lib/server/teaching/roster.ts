import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { students, teachingContexts } from '../db/schema.js';

// Call inside an authorized teaching service before reading or writing student records.
export async function requireRosterEntry(db: Pick<Database, 'select'>, contextId: string, studentId: string) {
	const [entry] = await db
		.select({
			studentId: students.id,
			contextId: teachingContexts.id,
			moduleId: teachingContexts.moduleId
		})
		.from(teachingContexts)
		.innerJoin(students, eq(students.classId, teachingContexts.classId))
		.where(and(eq(teachingContexts.id, contextId), eq(students.id, studentId)))
		.limit(1);
	if (!entry) error(404, 'Étudiant indisponible dans cette classe.');
	return entry;
}
