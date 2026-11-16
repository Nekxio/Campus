import { beforeEach, afterEach, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq, asc } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { seedGradingFixtures } from '../db/testing/grading-fixtures.js';
import { getRubric, replaceRubric, saveCorrection, getGradeGrid } from './grading.js';
import { createClass, copyModuleToClass, getModule } from './service.js';
import { getAnnualData, decideAnnualYear } from './annual.js';
import { getStudentGradeExport } from './grade-export.js';
import { getPublicationReview, decidePublication, getPublicClass } from './publications.js';
import { listPublishedClasses } from './student-views.js';
import { patchModule } from '../agent/patch.js';
import { calculateStudent } from '../../domain/grade-calculation.js';
import { studentGradeExportSchema } from '../../domain/student-export.js';
import { projectFinalGradeExport } from '../../domain/grade-export.js';

let client: Client;
let count = 0;
let db: ReturnType<typeof drizzle<typeof schema>>;
let ids: Awaited<ReturnType<typeof seedGradingFixtures>>;
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = drizzle(client, {
		schema,
		logger: {
			logQuery() {
				count++;
			}
		}
	});
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedGradingFixtures(db);
	count = 0;
});
afterEach(() => client.close());

it('R1 bounds rubric save queries', async () => {
	const rubric = await getRubric(db, ids.module);
	count = 0;
	await replaceRubric(db, ids.module, {
		expectedRevision: rubric.module.revision,
		assessments: rubric.assessments,
		results: rubric.results,
		contexts: rubric.contexts.map(({ id, expectedRevision, deadlines }) => ({
			id,
			expectedRevision,
			deadlines
		}))
	});
	console.log('R1 rubric save (3 assessments, 16 lines) SQL statements:', count);
	expect(count).toBeLessThanOrEqual(40);
});

it('R2 exports refused projects while retaining historical raw points', async () => {
	let grid = await getGradeGrid(db, ids.module, ids.currentContext);
	const student = grid.students[0];
	const correction = student.corrections.find((c) => c.assessmentId === ids.project)!;
	await saveCorrection(db, ids.currentContext, student.id, ids.project, {
		expectedRevision: correction.revision,
		rubricRevision: grid.rubric!.module.revision,
		status: correction.status,
		submissionUrl: correction.submissionUrl,
		submittedAt: correction.submittedAt,
		scores: correction.scores,
		latenessDecision: 'refused'
	});
	const rubric = await getRubric(db, ids.module);
	await replaceRubric(db, ids.module, {
		expectedRevision: rubric.module.revision,
		assessments: rubric.assessments.map((a) =>
			a.id !== ids.project ? a : { ...a, lines: a.lines.map((l) => ({ ...l, maxPoints: 1 })) }
		),
		results: rubric.results,
		contexts: rubric.contexts.map(({ id, expectedRevision, deadlines }) => ({
			id,
			expectedRevision,
			deadlines
		}))
	});
	grid = await getGradeGrid(db, ids.module, ids.currentContext);
	const calculation = calculateStudent(
		grid.rubric!.assessments,
		grid.rubric!.results,
		grid.students[0],
		grid.rubric!.contexts.find((c) => c.id === ids.currentContext)!.deadlines
	);
	expect(calculation.complete).toBe(true);
	expect(calculation.assessments[ids.project].rawMark).toBeGreaterThan(20);
	expect(projectFinalGradeExport({ ...grid, students: [grid.students[0]] }, new Date())).not.toBeNull();
	const document = await getStudentGradeExport(db, ids.currentContext, student.id);
	const section = document.sections.find((item) => item.kind === 'project')!;
	expect(section.mark).toBe(0);
	expect(section.rawMark).toBeGreaterThan(20);
	expect(
		studentGradeExportSchema.safeParse({
			...document,
			sections: document.sections.map((item) => (item === section ? { ...item, mark: 21 } : item))
		}).success
	).toBe(false);
	expect(
		studentGradeExportSchema.safeParse({
			...document,
			sections: document.sections.map((item) => (item === section ? { ...item, rawMark: Infinity } : item))
		}).success
	).toBe(false);
	expect(section.groups.flatMap((group) => group.lines).some((line) => line.points! > line.maximum)).toBe(true);
});

it('R3 preserves assessment and group positions in pedagogical copies', async () => {
	const initial = await getRubric(db, ids.module);
	await replaceRubric(db, ids.module, {
		results: initial.results,
		expectedRevision: initial.module.revision,
		assessments: initial.assessments.toReversed().map((item) => ({ ...item, groups: item.groups.toReversed() })),
		contexts: initial.contexts.map(({ id, expectedRevision, deadlines }) => ({
			id,
			expectedRevision,
			deadlines
		}))
	});
	const target = await createClass(db, { name: 'Classe copie fictive', academicYear: '2026-2027' });
	const copied = await copyModuleToClass(db, ids.module, target.id);
	const rows = await db
		.select()
		.from(schema.assessments)
		.where(eq(schema.assessments.moduleId, copied.id))
		.orderBy(asc(schema.assessments.position));
	expect(rows).toHaveLength(3);
	expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
	const source = await getRubric(db, ids.module);
	expect(rows.map((row) => row.title)).toEqual(source.assessments.map((item) => item.title));
	const project = rows.find((r) => r.kind === 'project')!;
	const groups = await db
		.select()
		.from(schema.rubricGroups)
		.where(eq(schema.rubricGroups.assessmentId, project.id))
		.orderBy(asc(schema.rubricGroups.position));
	expect(groups.map((r) => r.position)).toEqual([0, 1, 2]);
	expect(groups.map((row) => row.title)).toEqual(
		source.assessments.find((item) => item.kind === 'project')!.groups.map((group) => group.title)
	);
});

it.each(['B2 Demo', 'b2 demo'])('R4 rejects annual class collision %s atomically', async (name) => {
	await createClass(db, { name, academicYear: '2027-2028' });
	const preview = (await getAnnualData(db, ids.teacher, '2026-2027')).selected!;
	const before = await getAnnualData(db, ids.teacher, '2026-2027');
	await expect(
		decideAnnualYear(db, ids.teacher, {
			academicYear: preview.academicYear,
			action: 'purge',
			requestId: crypto.randomUUID(),
			reviewToken: preview.reviewToken,
			typedYear: preview.academicYear,
			pdfsKept: true,
			nextAcademicYear: '2027-2028',
			moduleChoices: [...new Set(preview.contexts.map((c) => c.moduleId))].map((moduleId) => ({
				moduleId,
				decision: 'continue' as const
			}))
		})
	).rejects.toMatchObject({ status: 409 });
	expect(await getAnnualData(db, ids.teacher, '2026-2027')).toEqual(before);
	expect(await db.select().from(schema.annualReceipts)).toHaveLength(0);
	expect((await getGradeGrid(db, ids.module, ids.currentContext)).students).toHaveLength(12);
	const rows = await db.select().from(schema.classes).where(eq(schema.classes.academicYear, '2027-2028'));
	expect(rows.filter((r) => r.name.toLocaleLowerCase('fr') === 'b2 demo')).toHaveLength(1);
});

it.each(['unknown', 'foreign', 'archived', 'mixed'])(
	'R5 rejects %s context in a rubric patch atomically',
	async (kind) => {
		const before = await getRubric(db, ids.module);
		const module = await getModule(db, ids.module);
		await expect(
			patchModule(db, ids.teacher, {
				version: 2,
				requestId: crypto.randomUUID(),
				moduleId: ids.module,
				expectedRevision: module.revision,
				patch: {},
				rubric: {
					contexts: [
						...(kind === 'mixed' ? [{ id: ids.currentContext, deadlines: [] }] : []),
						{
							id: kind === 'foreign' ? ids.secondContext : kind === 'archived' ? ids.oldContext : crypto.randomUUID(),
							deadlines: [
								{
									assessmentId: ids.project,
									dueAt: '2026-11-01T12:00:00Z',
									submissionInstructions: 'Fictive'
								}
							]
						}
					]
				}
			})
		).rejects.toMatchObject({ status: 422 });
		expect(await getModule(db, ids.module)).toEqual(module);
		expect(await db.select().from(schema.agentImports)).toHaveLength(0);
		const after = await getRubric(db, ids.module);
		expect(after.contexts.map((c) => c.deadlines)).toEqual(before.contexts.map((c) => c.deadlines));
	}
);

it.each([1, 6, 12])('R6 bounds public directory and private navigation for %s modules', async (moduleCount) => {
	const targets: string[] = [ids.module];
	for (let i = 0; i < moduleCount - 1; i++)
		targets.push((await copyModuleToClass(db, ids.module, ids.currentClass)).id);
	for (const moduleId of targets) {
		const review = (await getPublicationReview(db, moduleId)).selected!;
		await decidePublication(db, ids.teacher, moduleId, {
			requestId: crypto.randomUUID(),
			contextId: review.context.id,
			action: 'publish',
			expectedRevision: review.publicationRevision,
			moduleRevision: review.moduleRevision,
			contextRevision: review.contextRevision,
			classRevision: review.classRevision,
			confirm: true
		});
	}
	count = 0;
	const directory = await getPublicClass(db, ids.currentClass);
	console.log(`R6 public class, ${moduleCount} modules SQL statements:`, count);
	expect(directory.modules).toHaveLength(moduleCount);
	expect(count).toBeLessThanOrEqual(8);
	count = 0;
	const list = await listPublishedClasses(db);
	console.log(`R6 private student navigation, ${moduleCount} modules SQL statements:`, count);
	expect(list.length).toBeGreaterThan(0);
	expect(count).toBeLessThanOrEqual(17);
});

it('bounds correction and copy statements as criteria grow across several batches', async () => {
	const before = await getRubric(db, ids.module);
	const target = await createClass(db, {
		name: 'Copie volumineuse fictive',
		academicYear: '2026-2027'
	});
	count = 0;
	await copyModuleToClass(db, ids.module, target.id);
	const smallCopyCount = count;
	const project = before.assessments.find((item) => item.id === ids.project)!;
	project.lines = Array.from({ length: 220 }, (_, index) => ({
		id: crypto.randomUUID(),
		groupId: project.groups[0].id,
		label: `Critère ${index}`,
		description: '',
		maxPoints: 10
	}));
	const rubric = await replaceRubric(db, ids.module, {
		assessments: before.assessments,
		results: before.results,
		expectedRevision: before.module.revision,
		contexts: before.contexts.map(({ id, expectedRevision, deadlines }) => ({
			id,
			expectedRevision,
			deadlines
		}))
	});
	const current = await getGradeGrid(db, ids.module, ids.currentContext);
	const correctionRevision = current.students[0].corrections.find(
		(item) => item.assessmentId === ids.project
	)!.revision;
	count = 0;
	const saved = await saveCorrection(db, ids.currentContext, ids.students[0], ids.project, {
		expectedRevision: correctionRevision,
		rubricRevision: rubric.module.revision,
		status: 'to_evaluate',
		submissionUrl: null,
		submittedAt: null,
		latenessDecision: 'automatic',
		scores: project.lines.map((line) => ({ lineId: line.id, points: 3 }))
	});
	const saveCount = count;
	expect(
		saved.corrections
			.find((item) => item.assessmentId === ids.project)!
			.scores.filter((score) => project.lines.some((line) => line.id === score.lineId))
	).toHaveLength(220);
	expect(saveCount).toBeLessThanOrEqual(20);
	count = 0;
	const copied = await copyModuleToClass(db, ids.module, target.id);
	const largeCopyCount = count;
	expect((await getRubric(db, copied.id)).assessments.find((item) => item.kind === 'project')!.lines).toHaveLength(220);
	expect(largeCopyCount - smallCopyCount).toBeLessThanOrEqual(3);
	console.log('C1 correction 220 criteria:', saveCount, 'copy small/large:', smallCopyCount, largeCopyCount);
});
