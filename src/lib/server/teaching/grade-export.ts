import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { teachingContexts } from '../db/schema.js';
import { getGradeGrid } from './grading.js';
import { gradeExportStatus, projectFinalGradeExport } from '../../domain/grade-export.js';

export function getFinalGradeExport(db: Pick<Database, 'transaction'>, contextId: string) {
	// A single snapshot prevents rubric, roster and scores from belonging to different saves.
	return db.transaction(async (tx) => {
		const [context] = await tx
			.select({ moduleId: teachingContexts.moduleId })
			.from(teachingContexts)
			.where(eq(teachingContexts.id, contextId));
		if (!context) error(404, 'Cette classe du module n’est plus disponible.');
		const grid = await getGradeGrid(tx, context.moduleId, contextId, true);
		const document = projectFinalGradeExport(grid, new Date());
		if (!document) error(409, gradeExportStatus(grid).reason);
		return document;
	});
}
