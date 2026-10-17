import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDatabase, type Database } from '../db/index.js';
import { seedGradingFixtures } from '../db/testing/grading-fixtures.js';
import { getRubric, replaceRubric, getGradeGrid } from './grading.js';
import { copyModuleToClass, createClass } from './service.js';
import { sectionPointsRule } from '../../domain/rubric-points.js';
import { rubricToInput, rubricToDomain } from '../../grading/rubric-form.js';
import type { RubricData } from '../../domain/grading.js';
import { patchModule } from '../agent/patch.js';
import { patchModuleImportSchema } from '../../domain/module-patch.js';

let client: Client, db: Database, ids: Awaited<ReturnType<typeof seedGradingFixtures>>;
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedGradingFixtures(db);
});
afterEach(() => client.close());
function points(rubric: RubricData, maximum: number) {
	return {
		assessments: rubric.assessments,
		results: [
			{
				id: rubric.results[0].id,
				title: 'Note du module',
				rule: sectionPointsRule(rubric.assessments, [
					{ assessmentId: ids.quiz, maxPoints: maximum }
				])
			}
		],
		contexts: rubric.contexts.map(({ id, expectedRevision, deadlines }) => ({
			id,
			expectedRevision,
			deadlines
		})),
		expectedRevision: rubric.module.revision
	};
}
describe('Persisted section-maxima rubrics', () => {
	it('keeps section authoring through targeted MCP criterion edits with an omitted result rule', async () => {
		const rubric = await replaceRubric(db, ids.module, points(await getRubric(db, ids.module), 20));
		const project = rubric.assessments.find((item) => item.id === ids.project)!;
		const request = patchModuleImportSchema.parse({
			version: 2,
			requestId: crypto.randomUUID(),
			moduleId: ids.module,
			expectedRevision: rubric.module.revision,
			patch: {},
			rubric: {
				assessments: [
					{
						id: project.id,
						lines: [{ id: project.lines[0].id, maxPoints: project.lines[0].maxPoints + 10 }]
					}
				]
			}
		});
		const receipt = await patchModule(db, ids.teacher, request);
		expect(await patchModule(db, ids.teacher, request)).toEqual(receipt);
		const saved = await getRubric(db, ids.module);
		expect(saved.results[0].rule).toEqual(
			sectionPointsRule(saved.assessments, [{ assessmentId: ids.quiz, maxPoints: 20 }])
		);
	});
	it('roundtrips section metadata and flags a changed quiz contribution without altering raw scores', async () => {
		const first = await replaceRubric(db, ids.module, points(await getRubric(db, ids.module), 20));
		const before = await getGradeGrid(db, ids.module, ids.currentContext);
		const saved = await replaceRubric(db, ids.module, points(first, 35));
		const loaded = await getRubric(db, ids.module);
		expect(loaded.results).toEqual(saved.results);
		expect(rubricToInput(loaded).calculationMode).toBe('sections');
		expect(rubricToDomain(rubricToInput(loaded), {}).results).toEqual(loaded.results);
		const after = await getGradeGrid(db, ids.module, ids.currentContext);
		for (const student of after.students) {
			const previous = before.students.find((item) => item.id === student.id)!;
			expect(student.corrections.map((item) => item.scores)).toEqual(
				previous.corrections.map((item) => item.scores)
			);
			const quiz = student.corrections.find((item) => item.assessmentId === ids.quiz);
			if (quiz) expect(quiz.needsReview).toBe(true);
		}
	});
	it('copies quiz section identities and maxima into an independent pedagogical copy', async () => {
		const original = await replaceRubric(
			db,
			ids.module,
			points(await getRubric(db, ids.module), 17)
		);
		const target = await createClass(db, { name: 'Copie fictive', academicYear: '2026-2027' });
		const copied = await copyModuleToClass(db, ids.module, target.id);
		const rubric = await getRubric(db, copied.id);
		const quiz = rubric.assessments.find((item) => item.kind === 'quiz')!;
		expect(quiz.id).not.toBe(ids.quiz);
		expect(rubric.results[0].rule).toMatchObject({
			sectionPoints: { quizMaxima: [{ assessmentId: quiz.id, maxPoints: 17 }] }
		});
		expect(rubric.results[0].rule).toEqual(
			sectionPointsRule(rubric.assessments, [{ assessmentId: quiz.id, maxPoints: 17 }])
		);
		expect(original.results[0].rule).toMatchObject({
			sectionPoints: { quizMaxima: [{ assessmentId: ids.quiz, maxPoints: 17 }] }
		});
	});
});
