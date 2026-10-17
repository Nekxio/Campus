import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import * as t from '../db/schema.js';
import { seedGradingFixtures } from '../db/testing/grading-fixtures.js';
import { calculateAssessment } from '../../domain/grade-calculation.js';
import { blankCorrection, type RubricAssessment } from '../../domain/grading.js';
import { getGradeGrid, getRubric, replaceRubric, saveCorrection } from './grading.js';
import { getModule, updateModule, createClass, attachModule } from './service.js';
import { editableModule } from '../../teaching/types.js';
import { patchModule } from '../agent/patch.js';
import {
	getPublicationReview,
	decidePublication,
	getPublicModule,
	getPublicClass
} from './publications.js';
import { getAnnualData, decideAnnualYear } from './annual.js';
import { getFinalGradeExport, getStudentGradeExport } from './grade-export.js';
import { studentGradePdfDefinition } from '../../client/student-grade-pdf.js';
import { patchModuleImportSchema } from '../../domain/module-patch.js';
import { localModuleUpdateSchema } from '../../domain/local-module.js';

let client: Client, db: Database, ids: Awaited<ReturnType<typeof seedGradingFixtures>>;
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedGradingFixtures(db);
});
afterEach(() => client.close());
async function publish(contextId: string = ids.currentContext) {
	const review = (await getPublicationReview(db, ids.module, contextId)).selected!;
	return decidePublication(db, ids.teacher, ids.module, {
		requestId: crypto.randomUUID(),
		contextId,
		action: 'publish',
		expectedRevision: review.publicationRevision,
		moduleRevision: review.moduleRevision,
		contextRevision: review.contextRevision,
		classRevision: review.classRevision,
		confirm: true
	});
}
async function close(decision: 'continue' | 'pause') {
	const preview = (await getAnnualData(db, '2026-2027')).selected!;
	return decideAnnualYear(db, ids.teacher, {
		academicYear: preview.academicYear,
		action: 'purge',
		requestId: crypto.randomUUID(),
		reviewToken: preview.reviewToken,
		typedYear: preview.academicYear,
		pdfsKept: true,
		nextAcademicYear: decision === 'continue' ? '2027-2028' : undefined,
		moduleChoices: [...new Set(preview.contexts.map((context) => context.moduleId))].map(
			(moduleId) => ({ moduleId, decision })
		)
	});
}
describe('Confirmed teacher workflows', () => {
	it('refuses duplicate exercise identities without replacing saved teaching content', async () => {
		const before = await getModule(db, ids.module);
		const exercise = {
			id: crypto.randomUUID(),
			title: 'Exercice',
			instructions: 'Consigne',
			solution: 'Corrigé',
			code: ''
		};
		await expect(
			updateModule(db, ids.module, {
				...editableModule(before),
				expectedRevision: before.revision,
				studentContent: {
					instructions: '',
					projectInstructions: '',
					exercises: [exercise, exercise]
				}
			})
		).rejects.toMatchObject({ status: 422 });
		expect(await getModule(db, ids.module)).toEqual(before);
	});
	it('rejects ambiguous legacy updates and duplicate patch identities without changing a draft', async () => {
		expect(localModuleUpdateSchema.safeParse({ title: 'Un titre seul' }).success).toBe(false);
		const before = await getModule(db, ids.module);
		const base = {
			version: 2,
			moduleId: ids.module,
			requestId: crypto.randomUUID(),
			expectedRevision: before.revision
		};
		expect(
			patchModuleImportSchema.safeParse({
				...base,
				patch: {
					resources: [
						{ id: before.resources[0].id, label: 'Premier' },
						{ id: before.resources[0].id, label: 'Second' }
					]
				}
			}).success
		).toBe(false);
		await expect(
			patchModule(db, ids.teacher, {
				...base,
				version: 2,
				patch: {},
				remove: { resources: [crypto.randomUUID()] }
			})
		).rejects.toMatchObject({ status: 422 });
		expect(await getModule(db, ids.module)).toEqual(before);
	});
	it('averages normalized quiz scores with equal weight, retaining missing and absent distinctions', () => {
		const assessment: RubricAssessment = {
			id: crypto.randomUUID(),
			title: 'Quiz',
			kind: 'quiz',
			purpose: 'graded',
			groups: [{ id: crypto.randomUUID(), title: 'Quiz Wayground' }],
			lines: []
		};
		assessment.lines = [15, 7, 10, 9].map((maxPoints) => ({
			id: crypto.randomUUID(),
			groupId: assessment.groups[0].id,
			label: 'Quiz',
			description: '',
			maxPoints
		}));
		const correction = {
			...blankCorrection(assessment.id, 1),
			status: 'graded' as const,
			scores: assessment.lines.map((line, index) => ({
				lineId: line.id,
				points: [15, 0, 5, 9][index]
			}))
		};
		expect(calculateAssessment(assessment, correction).mark).toBe(12.5);
		expect(
			calculateAssessment(assessment, {
				...correction,
				scores: correction.scores.map((score, index) => ({
					...score,
					points: index === 0 ? null : score.points
				}))
			}).state
		).toBe('pending');
		expect(
			calculateAssessment(assessment, { ...correction, status: 'absent_unjustified' }).mark
		).toBe(0);
	});
	it.each([
		[0, 18],
		[1, 17],
		[5, 13],
		[6, 0]
	])(
		'applies %i Paris calendar days without any date-triggered non-submission',
		(days, expected) => {
			const assessment: RubricAssessment = {
				id: crypto.randomUUID(),
				title: 'Projet',
				kind: 'project',
				purpose: 'graded',
				groups: [{ id: crypto.randomUUID(), title: 'Production' }],
				lines: []
			};
			assessment.lines = [
				{
					id: crypto.randomUUID(),
					groupId: assessment.groups[0].id,
					label: 'Production',
					description: '',
					maxPoints: 20
				}
			];
			const correction = {
				...blankCorrection(assessment.id, 1),
				status: 'graded' as const,
				submittedAt: `2027-01-${String(2 + days).padStart(2, '0')}T${days === 0 ? '21:00' : '00:01'}:00+01:00`,
				scores: [{ lineId: assessment.lines[0].id, points: 18 }]
			};
			expect(calculateAssessment(assessment, correction, '2027-01-02T23:59:00+01:00').mark).toBe(
				expected
			);
			expect(
				calculateAssessment(
					assessment,
					{ ...correction, latenessDecision: 'exempt' },
					'2027-01-02T23:59:00+01:00'
				).mark
			).toBe(18);
			expect(
				calculateAssessment(
					assessment,
					{ ...correction, submittedAt: null },
					'2027-01-02T23:59:00+01:00'
				).state
			).toBe('pending');
		}
	);
	it('preserves omitted MCP fields, collection members and publication; deletion and retries are explicit', async () => {
		const before = await getModule(db, ids.module);
		const id = crypto.randomUUID();
		await patchModule(db, ids.teacher, {
			version: 2,
			moduleId: ids.module,
			requestId: id,
			expectedRevision: before.revision,
			patch: { title: 'Titre révisé', preparation: { nextSteps: 'Relire' } }
		});
		const after = await getModule(db, ids.module);
		expect(after.resources).toEqual(before.resources);
		expect(after.preparation.framing).toBe(before.preparation.framing);
		expect(after.contexts.map((context) => context.lessons)).toEqual(
			before.contexts.map((context) => context.lessons)
		);
		expect(after.needsReview).toBe(true);
		const command = {
			version: 2 as const,
			moduleId: ids.module,
			requestId: crypto.randomUUID(),
			expectedRevision: after.revision,
			patch: {},
			remove: { resources: [after.resources[0].id] }
		};
		const receipt = await patchModule(db, ids.teacher, command);
		expect((await getModule(db, ids.module)).resources).toHaveLength(after.resources.length - 1);
		expect(await patchModule(db, ids.teacher, command)).toEqual(receipt);
	});
	it('publishes blank criteria and freely accessible exercises while excluding all private records', async () => {
		const module = await getModule(db, ids.module);
		await updateModule(db, module.id, {
			...editableModule(module),
			expectedRevision: module.revision,
			studentContent: {
				instructions: 'Consigne publique',
				projectInstructions: '',
				exercises: [
					{
						id: crypto.randomUUID(),
						title: 'Exercice libre',
						instructions: 'Énoncé',
						solution: 'Corrigé ouvert',
						code: 'const answer = 42;'
					}
				]
			}
		});
		await publish();
		const course = await getPublicModule(db, ids.currentContext);
		expect(course.snapshot.studentContent.exercises[0].solution).toBe('Corrigé ouvert');
		expect(
			course.snapshot.rubric.flatMap((assessment) =>
				assessment.groups.flatMap((group) => group.lines)
			)
		).toContainEqual(expect.objectContaining({ label: 'Navigation', maxPoints: 5 }));
		expect(JSON.stringify(course)).not.toContain('Aline Moreau');
		expect(JSON.stringify(course)).not.toContain('semesterComment');
		expect(JSON.stringify(course)).not.toContain('submissionUrl');
	});
	it('exports one complete student despite other incomplete students, with strict private projections', async () => {
		const document = await getStudentGradeExport(db, ids.currentContext, ids.students[0]);
		expect(document.name).toBe('Aline Moreau');
		expect(document.sections.length).toBeGreaterThan(1);
		expect(
			document.sections.find((section) => section.title === 'Projet')?.contributions[0].weight
		).toBe(25);
		expect(JSON.stringify(document)).not.toContain('comment');
		expect(JSON.stringify(document)).not.toContain('Camille Demo');
		expect(JSON.stringify(studentGradePdfDefinition(document))).toContain('Maximum');
		await expect(getFinalGradeExport(db, ids.currentContext)).rejects.toMatchObject({
			status: 409
		});
	});
	it('flags numerical rubric changes without rewriting points and clears the flag on explicit save', async () => {
		const rubric = await getRubric(db, ids.module);
		const project = rubric.assessments.find((assessment) => assessment.id === ids.project)!;
		project.lines[0].maxPoints += 2;
		await replaceRubric(db, ids.module, {
			assessments: rubric.assessments,
			results: rubric.results,
			contexts: rubric.contexts.map(({ id, expectedRevision, deadlines }) => ({
				id,
				expectedRevision,
				deadlines
			})),
			expectedRevision: rubric.module.revision
		});
		const grid = await getGradeGrid(db, ids.module, ids.currentContext),
			student = grid.students[0];
		const correction = student.corrections.find((item) => item.assessmentId === ids.project)!;
		expect(correction.needsReview).toBe(true);
		await expect(getStudentGradeExport(db, ids.currentContext, student.id)).rejects.toMatchObject({
			status: 409
		});
		const saved = await saveCorrection(db, ids.currentContext, student.id, ids.project, {
			status: correction.status,
			submissionUrl: correction.submissionUrl,
			submittedAt: correction.submittedAt,
			latenessDecision: correction.latenessDecision,
			scores: correction.scores,
			expectedRevision: correction.revision,
			rubricRevision: grid.rubric!.module.revision
		});
		expect(saved.corrections.find((item) => item.assessmentId === ids.project)?.scores).toEqual(
			correction.scores
		);
		expect(saved.corrections.find((item) => item.assessmentId === ids.project)?.needsReview).toBe(
			false
		);
	});
	it('continues into an empty annual class while retaining public module and class paths', async () => {
		const publication = await publish();
		await close('continue');
		const module = await getModule(db, ids.module),
			next = module.contexts[0];
		expect(next.id).not.toBe(ids.currentContext);
		expect(next.lessons).toEqual([]);
		expect((await getGradeGrid(db, ids.module, next.id)).students).toEqual([]);
		expect((await getPublicModule(db, ids.currentContext)).snapshot.title).toBe(
			'Application web · démo'
		);
		expect(
			(await getPublicClass(db, ids.currentClass)).modules.some(
				(item) => item.publicPath === publication.publicPath
			)
		).toBe(true);
		const receipt = await publish(next.id);
		expect(receipt.publicPath).toBe(publication.publicPath);
		expect(
			(await getPublicClass(db, ids.currentClass)).modules.filter(
				(item) => item.publicPath === publication.publicPath
			)
		).toHaveLength(1);
		expect((await getPublicModule(db, ids.currentContext)).snapshot.academicYear).toBe('2027-2028');
		const review = (await getPublicationReview(db, ids.module, next.id)).selected!;
		await decidePublication(db, ids.teacher, ids.module, {
			requestId: crypto.randomUUID(),
			contextId: next.id,
			action: 'unpublish',
			expectedRevision: review.publicationRevision,
			moduleRevision: review.moduleRevision,
			contextRevision: review.contextRevision,
			classRevision: review.classRevision,
			confirm: true
		});
		await expect(getPublicModule(db, ids.currentContext)).rejects.toMatchObject({ status: 404 });
		expect((await publish(next.id)).publicPath).toBe(publication.publicPath);
	});
	it('pauses without deleting teaching content and only reactivates the old public path after manual publication', async () => {
		await publish();
		const before = await getModule(db, ids.module);
		await close('pause');
		await expect(getPublicModule(db, ids.currentContext)).rejects.toMatchObject({ status: 404 });
		expect((await getModule(db, ids.module)).resources).toEqual(before.resources);
		const nextClass = await createClass(db, { name: 'B3 repris', academicYear: '2027-2028' });
		const paused = await getModule(db, ids.module);
		const attached = await attachModule(db, nextClass.id, {
			moduleId: ids.module,
			moduleRevision: paused.revision,
			expectedRevision: 1
		});
		expect(attached.moduleId).toBe(ids.module);
		await expect(getPublicModule(db, ids.currentContext)).rejects.toMatchObject({ status: 404 });
		expect((await publish(attached.id)).publicPath).toBe('/modules/' + ids.currentContext);
		expect((await getPublicModule(db, ids.currentContext)).snapshot.academicYear).toBe('2027-2028');
	});
	it('makes an independent copy for another class without scores or calendar dates', async () => {
		const nextClass = await createClass(db, { name: 'B2 indépendant', academicYear: '2026-2027' });
		const source = await getModule(db, ids.module);
		const attached = await attachModule(db, nextClass.id, {
			moduleId: ids.module,
			moduleRevision: source.revision,
			expectedRevision: 1
		});
		expect(attached.moduleId).not.toBe(ids.module);
		const copied = await getModule(db, attached.moduleId!);
		expect(copied.contexts).toHaveLength(1);
		expect(copied.contexts[0].lessons).toEqual([]);
		expect(
			await db.select().from(t.corrections).where(eq(t.corrections.contextId, attached.id))
		).toEqual([]);
		expect((await getRubric(db, copied.id)).assessments[0].id).not.toBe(
			(await getRubric(db, ids.module)).assessments[0].id
		);
	});
});
