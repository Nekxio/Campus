import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import { seedGradingFixtures } from '../db/testing/grading-fixtures.js';
import { getGradeGrid, saveCorrection, replaceRubric } from './grading.js';
import { getFinalGradeExport } from './grade-export.js';
import { teachingContexts } from '../db/schema.js';
let client: Client, db: Database, ids: Awaited<ReturnType<typeof seedGradingFixtures>>;
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedGradingFixtures(db);
});
afterEach(() => client.close());
async function completeClass() {
	const grid = await getGradeGrid(db, ids.module, ids.currentContext);
	for (const student of grid.students)
		for (const assessment of grid.rubric!.assessments) {
			const current = student.corrections.find((c) => c.assessmentId === assessment.id);
			await saveCorrection(db, ids.currentContext, student.id, assessment.id, {
				expectedRevision: current?.revision ?? 0,
				rubricRevision: grid.rubric!.module.revision,
				status: 'graded',
				submissionUrl: null,
				submittedAt: '2026-10-09T12:00:00Z',
				latenessDecision: 'automatic',
				scores: assessment.lines.map((line) => ({ lineId: line.id, points: line.maxPoints }))
			});
		}
}
describe('Saved final grade export', () => {
	it('exports every saved student and awkward weighted result while still blocking invalid data', async () => {
		const initial = await getGradeGrid(db, ids.module, ids.currentContext);
		const rubric = initial.rubric!;
		const results = [
			{ title: 'Poids entiers', weights: [3, 79, 18] },
			{ title: 'Poids décimaux', weights: [0.5, 79.8, 19.7] },
			{ title: 'Somme admise', weights: [3, 79, 18 + 5e-9] }
		].map(({ title, weights }) => ({
			id: crypto.randomUUID(),
			title,
			rule: {
				kind: 'weighted' as const,
				components: rubric.assessments.map((assessment, index) => ({
					assessmentIds: [assessment.id],
					weight: weights[index]
				}))
			}
		}));
		await replaceRubric(db, ids.module, {
			expectedRevision: rubric.module.revision,
			assessments: rubric.assessments,
			results,
			contexts: rubric.contexts.map(({ id, expectedRevision, deadlines }) => ({
				id,
				expectedRevision,
				deadlines
			}))
		});
		await expect(getFinalGradeExport(db, ids.currentContext)).rejects.toMatchObject({
			status: 409
		});
		await completeClass();
		const document = await getFinalGradeExport(db, ids.currentContext);
		expect(document.results).toEqual(results.map((result) => result.title));
		expect(document.students).toHaveLength(12);
		expect(document.students.map((student) => student.name)).toEqual(
			initial.students.map((student) => student.name)
		);
		expect(document.students.map((student) => student.marks)).toEqual(
			initial.students.map(() => [20, 20, 20])
		);
		expect(
			document.students.every((student) => student.marks.every((mark) => mark >= 0 && mark <= 20))
		).toBe(true);
		const grid = await getGradeGrid(db, ids.module, ids.currentContext);
		const student = grid.students[0];
		const current = student.corrections.find((correction) => correction.assessmentId === ids.quiz)!;
		await saveCorrection(db, ids.currentContext, student.id, ids.quiz, {
			expectedRevision: current.revision,
			rubricRevision: grid.rubric!.module.revision,
			status: 'to_evaluate',
			submissionUrl: null,
			submittedAt: null,
			latenessDecision: 'automatic',
			scores: current.scores.map((score) => ({ ...score, points: null }))
		});
		await expect(getFinalGradeExport(db, ids.currentContext)).rejects.toMatchObject({
			status: 409
		});
		await completeClass();
		const complete = await getGradeGrid(db, ids.module, ids.currentContext);
		const updatedRubric = complete.rubric!;
		const quiz = updatedRubric.assessments.find((assessment) => assessment.id === ids.quiz)!;
		const retainedPoints = complete.students[0].corrections.find(
			(correction) => correction.assessmentId === ids.quiz
		)!.scores[0].points;
		quiz.lines[0].maxPoints = 1;
		await replaceRubric(db, ids.module, {
			expectedRevision: updatedRubric.module.revision,
			assessments: updatedRubric.assessments,
			results: updatedRubric.results,
			contexts: updatedRubric.contexts.map(({ id, expectedRevision, deadlines }) => ({
				id,
				expectedRevision,
				deadlines
			}))
		});
		await expect(getFinalGradeExport(db, ids.currentContext)).rejects.toMatchObject({
			status: 409
		});
		const invalid = await getGradeGrid(db, ids.module, ids.currentContext);
		expect(
			invalid.students[0].corrections.find((correction) => correction.assessmentId === ids.quiz)!
				.scores[0].points
		).toBe(retainedPoints);
		expect(retainedPoints).toBe(15);
	});
	it('blocks incomplete persisted data then rechecks current values at every request', async () => {
		await expect(getFinalGradeExport(db, ids.currentContext)).rejects.toMatchObject({
			status: 409
		});
		await completeClass();
		const document = await getFinalGradeExport(db, ids.currentContext);
		expect(document.students).toHaveLength(12);
		expect(document.students.every((student) => student.marks[0] === 20)).toBe(true);
		expect(Object.keys(document.students[0]).sort()).toEqual(['marks', 'name', 'sectionMarks']);
		const grid = await getGradeGrid(db, ids.module, ids.currentContext);
		const current = grid.students[0].corrections.find((c) => c.assessmentId === ids.oral)!;
		await saveCorrection(db, ids.currentContext, grid.students[0].id, ids.oral, {
			expectedRevision: current.revision,
			rubricRevision: grid.rubric!.module.revision,
			status: 'absent_justified',
			submissionUrl: null,
			submittedAt: null,
			latenessDecision: 'automatic',
			scores: current.scores
		});
		await expect(getFinalGradeExport(db, ids.currentContext)).rejects.toMatchObject({
			status: 409
		});
	});
	it('recalculates after rubric replacement and blocks excessive retained scores', async () => {
		await completeClass();
		const { rubric } = await getGradeGrid(db, ids.module, ids.currentContext);
		rubric!.assessments[0].lines[0].maxPoints = 1;
		await replaceRubric(db, ids.module, {
			expectedRevision: rubric!.module.revision,
			assessments: rubric!.assessments,
			results: rubric!.results,
			contexts: rubric!.contexts.map(({ id, expectedRevision, deadlines }) => ({
				id,
				expectedRevision,
				deadlines
			}))
		});
		await expect(getFinalGradeExport(db, ids.currentContext)).rejects.toMatchObject({
			status: 409
		});
	});
	it('rejects unknown contexts and rechecks archived incomplete contexts without a fallback', async () => {
		await expect(getFinalGradeExport(db, crypto.randomUUID())).rejects.toMatchObject({
			status: 404
		});
		await db
			.update(teachingContexts)
			.set({ archivedAt: new Date() })
			.where(eq(teachingContexts.id, ids.currentContext));
		await expect(getFinalGradeExport(db, ids.currentContext)).rejects.toMatchObject({
			status: 409
		});
	});
});
