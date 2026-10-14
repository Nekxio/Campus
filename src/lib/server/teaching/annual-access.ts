import { error } from '@sveltejs/kit';
import { eq, isNotNull, notInArray } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { academicYears, classes } from '../db/schema.js';

export function activeClassFilter(db: Pick<Database, 'select'>) {
	return notInArray(
		classes.academicYear,
		db
			.select({ year: academicYears.academicYear })
			.from(academicYears)
			.where(isNotNull(academicYears.archivedAt))
	);
}
export async function requireActiveYear(db: Pick<Database, 'select'>, academicYear: string) {
	const [year] = await db
		.select()
		.from(academicYears)
		.where(eq(academicYears.academicYear, academicYear));
	if (year?.archivedAt || year?.purgedAt)
		error(
			409,
			'Cette année est archivée. Actualisez les données et rouvrez l’année avant de la modifier.'
		);
}
