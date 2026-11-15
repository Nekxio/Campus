import { eq } from 'drizzle-orm';
import type { Database } from '../index.js';
import * as tables from '../schema.js';
import { createClass, copyModuleToClass } from '../../teaching/service.js';
import { getGradeGrid, saveCorrection } from '../../teaching/grading.js';

// Call only in a freshly created fictional fixture, never in an existing demo/database.
export async function seedGradingSelectionFixtures(db: Database, sourceModuleId: string) {
	await db.insert(tables.academicYears).values({
		academicYear: '2025-2026',
		archivedAt: new Date('2026-08-31T12:00:00Z')
	});
	const b3 = await createClass(db, { name: 'B3 Démo', academicYear: '2026-2027' });
	const empty = await createClass(db, { name: 'Classe sans module', academicYear: '2026-2027' });
	const future = await createClass(db, { name: 'B2 Demo', academicYear: '2027-2028' });
	const b3Module = await copyModuleToClass(db, sourceModuleId, b3.id);
	const futureModule = await copyModuleToClass(db, sourceModuleId, future.id);
	await db.update(tables.modules).set({ title: 'B3 · Atelier web' }).where(eq(tables.modules.id, b3Module.id));
	await db
		.update(tables.modules)
		.set({ title: 'B2 · Promotion suivante' })
		.where(eq(tables.modules.id, futureModule.id));
	const b3Students = [crypto.randomUUID(), crypto.randomUUID()];
	await db.insert(tables.students).values([
		{ id: b3Students[0], classId: b3.id, name: 'B3 Alice Démo', position: 0 },
		{ id: b3Students[1], classId: b3.id, name: 'B3 Boris Démo', position: 1 },
		{ id: crypto.randomUUID(), classId: future.id, name: 'Promotion suivante Démo', position: 0 }
	]);
	const b3Context = b3Module.contexts[0].id;
	const grid = await getGradeGrid(db, b3Module.id, b3Context);
	for (const assessment of grid.rubric!.assessments) {
		await saveCorrection(db, b3Context, b3Students[0], assessment.id, {
			expectedRevision: 0,
			rubricRevision: grid.rubric!.module.revision,
			status: 'graded',
			submissionUrl: null,
			submittedAt: '2026-10-09T12:00:00Z',
			latenessDecision: 'automatic',
			scores: assessment.lines.map((line) => ({
				lineId: line.id,
				points: Math.floor(line.maxPoints / 2)
			}))
		});
	}
	return {
		b3Class: b3.id,
		b3Module: b3Module.id,
		b3Context,
		b3Students,
		emptyClass: empty.id,
		futureClass: future.id,
		futureModule: futureModule.id,
		futureContext: futureModule.contexts[0].id
	};
}
export type GradingSelectionFixture = Awaited<ReturnType<typeof seedGradingSelectionFixtures>>;
