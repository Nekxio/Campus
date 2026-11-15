import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import * as tables from '../db/schema.js';
import {
	getRubric,
	replaceRubric,
	getGradeGrid,
	getDetailedCorrection,
	saveCorrection,
	saveSemesterComment
} from './grading.js';
import { calculateStudent } from '../../domain/grade-calculation.js';
import { blankCorrection, type RubricData, type RubricDraft } from '../../domain/grading.js';
let client: Client, db: Database, ids: Awaited<ReturnType<typeof seedFoundationFixtures>>, rubric: RubricData;
function draft(value: RubricData): RubricDraft {
	return {
		assessments: structuredClone(value.assessments),
		results: structuredClone(value.results),
		contexts: value.contexts.map(({ id, expectedRevision, deadlines }) => ({
			id,
			expectedRevision,
			deadlines: structuredClone(deadlines)
		}))
	};
}
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedFoundationFixtures(db);
	rubric = await getRubric(db, ids.module);
	// The foundation deliberately has incomplete quiz/oral rubrics. Fill only this test database.
	for (const a of rubric.assessments)
		if (!a.groups.length) {
			const groupId = crypto.randomUUID();
			a.groups = [{ id: groupId, title: a.title }];
			a.lines = [
				{
					id: crypto.randomUUID(),
					groupId,
					label: 'Total',
					description: '',
					maxPoints: a.kind === 'quiz' ? 15 : 120
				}
			];
		}
	rubric = await replaceRubric(db, ids.module, {
		...draft(rubric),
		expectedRevision: rubric.module.revision
	});
});
afterEach(() => client.close());
describe('Private persistent grading', () => {
	it.each([0, -1, 1.5])('rejects rubric maxima of %s without changing the rubric or corrections', async (maxPoints) => {
		const before = await getDetailedCorrection(db, ids.currentContext, ids.students[0]);
		const beforeRubric = await getRubric(db, ids.module);
		const invalid = draft(rubric);
		for (const assessment of invalid.assessments) {
			for (const line of assessment.lines) line.maxPoints = maxPoints;
		}
		await expect(
			replaceRubric(db, ids.module, { ...invalid, expectedRevision: rubric.module.revision })
		).rejects.toMatchObject({ status: 422 });
		expect(await getRubric(db, ids.module)).toEqual(beforeRubric);
		expect(await getDetailedCorrection(db, ids.currentContext, ids.students[0])).toEqual(before);
	});

	it('rejects invalid submission links without changing saved points or submission metadata', async () => {
		const before = await getDetailedCorrection(db, ids.currentContext, ids.students[0]);
		const assessment = rubric.assessments.find((item) => item.id === ids.project)!;
		const correction = before.students
			.find((student) => student.id === ids.students[0])!
			.corrections.find((record) => record.assessmentId === ids.project)!;
		for (const submissionUrl of ['not-a-link', 'http://example.test/repo', 'https://user:password@example.test/repo']) {
			await expect(
				saveCorrection(db, ids.currentContext, ids.students[0], ids.project, {
					expectedRevision: correction.revision,
					rubricRevision: rubric.module.revision,
					status: 'to_evaluate',
					submissionUrl,
					submittedAt: correction.submittedAt,
					latenessDecision: correction.latenessDecision,
					scores: assessment.lines.map((line) => ({ lineId: line.id, points: 0 }))
				})
			).rejects.toMatchObject({ status: 422 });
		}
		expect(await getDetailedCorrection(db, ids.currentContext, ids.students[0])).toEqual(before);
	});

	it('creates and changes a rubric without warning when no corrections exist', async () => {
		const moduleId = crypto.randomUUID();
		await db.insert(tables.modules).values({ id: moduleId, title: 'Test UX — Ungraded rubric' });
		const initial = await getRubric(db, moduleId);
		const input = draft(rubric);
		input.assessments = input.assessments.map((assessment) => {
			const groupIds = new Map(assessment.groups.map((group) => [group.id, crypto.randomUUID()]));
			return {
				...assessment,
				id: crypto.randomUUID(),
				groups: assessment.groups.map((group) => ({ ...group, id: groupIds.get(group.id)! })),
				lines: assessment.lines.map((line) => ({
					...line,
					id: crypto.randomUUID(),
					groupId: groupIds.get(line.groupId)!
				}))
			};
		});
		input.results = [];
		input.contexts = [];
		const created = await replaceRubric(db, moduleId, {
			...input,
			expectedRevision: initial.module.revision
		});
		expect(created.reviewRequiredCorrections).toBe(0);
		const changed = draft(created);
		changed.assessments[0].lines[0].maxPoints += 1;
		expect(
			(await replaceRubric(db, moduleId, { ...changed, expectedRevision: created.module.revision }))
				.reviewRequiredCorrections
		).toBe(0);
	});

	it('reports only existing corrections affected by the established numeric change rules', async () => {
		const save = async (next: RubricDraft) => {
			const result = await replaceRubric(db, ids.module, {
				...next,
				expectedRevision: rubric.module.revision
			});
			rubric = result;
			return result;
		};
		expect(await save(draft(rubric))).toMatchObject({ reviewRequiredCorrections: 0 });
		const editorial = draft(rubric);
		editorial.assessments[0].title = 'Renamed assessment';
		expect(await save(editorial)).toMatchObject({ reviewRequiredCorrections: 0 });
		const numerical = draft(rubric);
		numerical.assessments.find((item) => item.id === ids.project)!.lines[0].maxPoints += 1;
		const saved = await save(numerical);
		expect(saved).toMatchObject({ reviewRequiredCorrections: expect.any(Number) });
		expect(saved.reviewRequiredCorrections).toBeGreaterThan(0);
	});
	it('refuses foreign scoring identities and rolls back claimed module revisions', async () => {
		const assessmentId = crypto.randomUUID(),
			groupId = crypto.randomUUID(),
			lineId = crypto.randomUUID();
		await db
			.insert(tables.assessments)
			.values({ id: assessmentId, moduleId: ids.secondModule, title: 'Foreign', kind: 'other' });
		await db.insert(tables.rubricGroups).values({ id: groupId, assessmentId, title: 'Foreign' });
		await db.insert(tables.rubricLines).values({ id: lineId, assessmentId, groupId, label: 'Foreign', maxPoints: 10 });
		const attack = draft(rubric);
		attack.assessments[0].lines[0].id = lineId;
		await expect(
			replaceRubric(db, ids.module, { ...attack, expectedRevision: rubric.module.revision })
		).rejects.toMatchObject({ status: 422 });
		expect((await getRubric(db, ids.module)).module.revision).toBe(rubric.module.revision);
		expect((await db.select().from(tables.rubricLines).where(eq(tables.rubricLines.id, lineId)))[0].assessmentId).toBe(
			assessmentId
		);
	});
	it('retains removed assessment scores privately while excluding them from the live rubric', async () => {
		const next = draft(rubric);
		next.assessments = next.assessments.filter((a) => a.id !== ids.project);
		next.results = [
			{
				id: next.results[0].id,
				title: 'Remaining',
				rule: { kind: 'points_ratio', assessmentIds: [ids.quiz, ids.oral] }
			}
		];
		for (const context of next.contexts) context.deadlines = [];
		const saved = await replaceRubric(db, ids.module, {
			...next,
			expectedRevision: rubric.module.revision
		});
		expect(saved.assessments.some((a) => a.id === ids.project)).toBe(false);
		const grid = await getGradeGrid(db, ids.module, ids.currentContext);
		expect(grid.students[0].retiredScores).toHaveLength(2);
		expect(await db.select().from(tables.scores).where(eq(tables.scores.correctionId, ids.correction))).toHaveLength(2);
	});
	it('rejects stale context calendars atomically without changing the rubric or deadline', async () => {
		await db
			.update(tables.teachingContexts)
			.set({ revision: rubric.contexts[0].expectedRevision + 1 })
			.where(eq(tables.teachingContexts.id, ids.currentContext));
		await expect(
			replaceRubric(db, ids.module, { ...draft(rubric), expectedRevision: rubric.module.revision })
		).rejects.toMatchObject({ status: 409 });
		expect((await getRubric(db, ids.module)).module.revision).toBe(rubric.module.revision);
	});

	it('saves partial versus complete scores, reloads results and rejects stale correction revisions', async () => {
		const a = rubric.assessments.find((v) => v.id === ids.project)!;
		const input = {
			...blankCorrection(a.id, rubric.module.revision),
			expectedRevision: 1,
			scores: a.lines.map((v) => ({ lineId: v.id, points: 8 }))
		};
		const { assessmentId: _id, revision: _rev, ...write } = input;
		void _id;
		void _rev;
		const saved = await saveCorrection(db, ids.currentContext, ids.students[0], a.id, {
			...write,
			status: 'graded'
		});
		expect(saved.corrections.find((v) => v.assessmentId === a.id)?.revision).toBe(2);
		const reload = await getGradeGrid(db, ids.module, ids.currentContext);
		expect(calculateStudent(rubric.assessments, rubric.results, reload.students[0]).assessments[a.id].mark).toBe(16);
		await expect(saveCorrection(db, ids.currentContext, ids.students[0], a.id, write)).rejects.toMatchObject({
			status: 409
		});
		await expect(
			saveCorrection(db, ids.currentContext, ids.students[1], a.id, {
				...write,
				expectedRevision: 0,
				status: 'graded',
				scores: a.lines.map((v) => ({ lineId: v.id, points: null }))
			})
		).rejects.toMatchObject({ status: 422 });
		await saveCorrection(db, ids.currentContext, ids.students[1], a.id, {
			...write,
			expectedRevision: 0,
			scores: a.lines.map((v) => ({ lineId: v.id, points: null }))
		});
		expect(
			(await getDetailedCorrection(db, ids.currentContext, ids.students[1])).students[1].corrections[0].scores[0].points
		).toBeNull();
	});
	it('retains raw points on replacement, exposes retired scores and blocks stale rubric writes', async () => {
		const before = rubric.module.revision;
		const changed = draft(rubric),
			a = changed.assessments.find((v) => v.id === ids.project)!;
		a.lines[0].maxPoints = 5;
		rubric = await replaceRubric(db, ids.module, { ...changed, expectedRevision: before });
		const grid = await getGradeGrid(db, ids.module, ids.currentContext);
		expect(grid.students[0].corrections[0].scores.find((v) => v.lineId === ids.firstLine)?.points).toBe(8);
		expect(calculateStudent(rubric.assessments, rubric.results, grid.students[0]).assessments[ids.project].state).toBe(
			'invalid'
		);
		const stale = {
			...blankCorrection(ids.project, before),
			expectedRevision: 1,
			scores: a.lines.map((v) => ({ lineId: v.id, points: 1 }))
		};
		const { assessmentId: _id, revision: _rev, ...write } = stale;
		void _id;
		void _rev;
		await expect(saveCorrection(db, ids.currentContext, ids.students[0], ids.project, write)).rejects.toMatchObject({
			status: 409
		});
		const removed = draft(rubric);
		removed.assessments.find((v) => v.id === ids.project)!.lines.shift();
		await replaceRubric(db, ids.module, { ...removed, expectedRevision: rubric.module.revision });
		expect((await getGradeGrid(db, ids.module, ids.currentContext)).students[0].retiredScores).toEqual(
			expect.arrayContaining([expect.objectContaining({ points: 8, label: 'First feature' })])
		);
	});
	it('rejects cross-module and cross-class references atomically, including forged duplicate score IDs', async () => {
		const attack = draft(rubric);
		attack.assessments[0].id = ids.project;
		await expect(
			replaceRubric(db, ids.module, { ...attack, expectedRevision: rubric.module.revision })
		).rejects.toMatchObject({ status: 422 });
		expect((await getRubric(db, ids.module)).module.revision).toBe(rubric.module.revision);
		await expect(getDetailedCorrection(db, ids.currentContext, ids.oldStudent)).rejects.toMatchObject({ status: 404 });
		const input = {
			expectedRevision: 0,
			rubricRevision: rubric.module.revision,
			status: 'to_evaluate' as const,
			submissionUrl: null,
			submittedAt: null,
			latenessDecision: 'automatic' as const,
			scores: []
		};
		await expect(saveCorrection(db, ids.currentContext, ids.oldStudent, ids.project, input)).rejects.toMatchObject({
			status: 404
		});
		await expect(
			saveCorrection(db, ids.secondContext, ids.students[0], ids.project, {
				...input,
				rubricRevision: 1
			})
		).rejects.toMatchObject({ status: 404 });
		const a = rubric.assessments.find((v) => v.id === ids.project)!;
		await expect(
			saveCorrection(db, ids.currentContext, ids.students[0], ids.project, {
				...input,
				expectedRevision: 1,
				scores: [
					{ lineId: a.lines[0].id, points: 1 },
					{ lineId: a.lines[0].id, points: 2 }
				]
			})
		).rejects.toMatchObject({ status: 422 });
	});
	it('protects shared deadlines/context revisions and applies calendar penalties, exemptions and explicit refusal', async () => {
		const changed = draft(rubric);
		changed.contexts[0].deadlines = [
			{ assessmentId: ids.project, dueAt: '2026-10-10T21:59:00Z', submissionInstructions: 'GitHub' }
		];
		rubric = await replaceRubric(db, ids.module, {
			...changed,
			expectedRevision: rubric.module.revision
		});
		const a = rubric.assessments.find((v) => v.id === ids.project)!;
		const input = {
			expectedRevision: 1,
			rubricRevision: rubric.module.revision,
			status: 'graded' as const,
			submittedAt: '2026-10-12T07:10:00Z',
			submissionUrl: 'https://example.test/repo',
			latenessDecision: 'automatic' as const,
			scores: a.lines.map((v) => ({ lineId: v.id, points: 8 }))
		};
		await saveCorrection(db, ids.currentContext, ids.students[0], ids.project, input);
		let grid = await getGradeGrid(db, ids.module, ids.currentContext);
		expect(
			calculateStudent(rubric.assessments, rubric.results, grid.students[0], rubric.contexts[0].deadlines).assessments[
				ids.project
			]
		).toMatchObject({ rawMark: 16, mark: 14, latenessDays: 2 });
		await saveCorrection(db, ids.currentContext, ids.students[0], ids.project, {
			...input,
			expectedRevision: 2,
			latenessDecision: 'exempt'
		});
		grid = await getGradeGrid(db, ids.module, ids.currentContext);
		expect(
			calculateStudent(rubric.assessments, rubric.results, grid.students[0], rubric.contexts[0].deadlines).assessments[
				ids.project
			].mark
		).toBe(16);
		await saveCorrection(db, ids.currentContext, ids.students[0], ids.project, {
			...input,
			expectedRevision: 3,
			latenessDecision: 'refused'
		});
		grid = await getGradeGrid(db, ids.module, ids.currentContext);
		expect(
			calculateStudent(rubric.assessments, rubric.results, grid.students[0], rubric.contexts[0].deadlines).assessments[
				ids.project
			].mark
		).toBe(0);
	});
	it('keeps raw scores through absence decisions and retains justified cases pending', async () => {
		const a = rubric.assessments.find((v) => v.id === ids.project)!;
		const input = {
			expectedRevision: 1,
			rubricRevision: rubric.module.revision,
			status: 'absent_unjustified' as const,
			submittedAt: null,
			submissionUrl: null,
			latenessDecision: 'automatic' as const,
			scores: a.lines.map((v) => ({ lineId: v.id, points: null }))
		};
		const student = await saveCorrection(db, ids.currentContext, ids.students[0], a.id, input);
		expect(student.corrections[0].scores.find((v) => v.lineId === ids.firstLine)?.points).toBe(8);
		expect(calculateStudent(rubric.assessments, rubric.results, student).assessments[a.id]).toMatchObject({
			state: 'ready',
			mark: 0
		});
		const justified = await saveCorrection(db, ids.currentContext, ids.students[0], a.id, {
			...input,
			expectedRevision: 2,
			status: 'absent_justified'
		});
		expect(calculateStudent(rubric.assessments, rubric.results, justified).assessments[a.id].state).toBe('pending');
	});
	it('saves only scoped private semester comments, protects revisions and cascades annual student deletion', async () => {
		expect(
			await saveSemesterComment(db, ids.currentContext, ids.students[0], {
				expectedRevision: 0,
				content: 'Private comment'
			})
		).toEqual({ revision: 1, content: 'Private comment' });
		await expect(
			saveSemesterComment(db, ids.currentContext, ids.students[0], {
				expectedRevision: 0,
				content: 'Stale'
			})
		).rejects.toMatchObject({ status: 409 });
		await expect(
			saveSemesterComment(db, ids.currentContext, ids.oldStudent, {
				expectedRevision: 0,
				content: 'Wrong class'
			})
		).rejects.toMatchObject({ status: 404 });
		expect((await getGradeGrid(db, ids.module, ids.currentContext)).students[0].comment.content).toBe(
			'Private comment'
		);
		await db.delete(tables.students).where(eq(tables.students.id, ids.students[0]));
		expect(
			(await db.select().from(tables.semesterComments)).filter((v) => v.contextId === ids.currentContext)
		).toHaveLength(0);
		expect((await getRubric(db, ids.module)).assessments).toHaveLength(3);
	});
});
