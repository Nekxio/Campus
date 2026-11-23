import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import * as tables from '../db/schema.js';
import { getModule, updateModule } from '../teaching/service.js';
import { getRubric } from '../teaching/grading.js';
import { editableModule } from '../../teaching/types.js';
import {
	createModuleImportSchema,
	updateModuleImportSchema,
	importContextSchema,
	importFingerprint
} from '../../domain/module-import.js';
import { newFolderBinding, resolveLocalModule } from '../../domain/local-module.js';
import { importModule, readImportContext } from './import.js';
import { patchModule } from './patch.js';
import { sampleLocalModule } from './testing/fixtures.js';

let client: Client, db: Database, ids: Awaited<ReturnType<typeof seedFoundationFixtures>>;
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedFoundationFixtures(db);
});
afterEach(() => client.close());
function createInput() {
	const binding = newFolderBinding('https://campus.example.test');
	const resolved = resolveLocalModule(sampleLocalModule(ids.currentClass), binding, '/fictional/module');
	return createModuleImportSchema.parse({
		version: 1,
		requestId: crypto.randomUUID(),
		moduleId: binding.moduleId,
		...resolved
	});
}
async function updateInput(moduleId: string) {
	const current = await getModule(db, moduleId);
	return updateModuleImportSchema.parse({
		version: 1,
		requestId: crypto.randomUUID(),
		moduleId,
		draft: editableModule(current),
		expectedRevision: current.revision
	});
}

describe('Atomic agent module imports', () => {
	it('resolves a dossier and workshop from the same local resource, rubric and session on the first import', async () => {
		const binding = newFolderBinding('https://campus.example.test');
		const source = sampleLocalModule(ids.currentClass);
		const exerciseId = crypto.randomUUID();
		const resolved = resolveLocalModule(
			{
				...source,
				studentContent: {
					instructions: '',
					projectInstructions: '',
					dossiers: [{ assessmentKey: 'project', instructions: 'Use this reference.', resourceKeys: ['slides'] }],
					exercises: [
						{
							id: exerciseId,
							title: 'Practice',
							instructions: '',
							solution: '',
							code: '',
							semester: 'S1',
							resourceKeys: ['slides']
						}
					]
				},
				contexts: source.contexts.map((context) => ({
					...context,
					lessons: context.lessons.map((lesson) => ({ ...lesson, exerciseIds: [exerciseId] }))
				}))
			},
			binding,
			'/fictional/module'
		);
		const input = createModuleImportSchema.parse({
			version: 1,
			requestId: crypto.randomUUID(),
			moduleId: binding.moduleId,
			...resolved
		});
		const receipt = await importModule(db, ids.teacher, 'create', input);
		const saved = await getModule(db, receipt.moduleId);
		expect(saved.studentContent!.dossiers).toEqual([
			{
				assessmentId: binding.ids.assessments.project,
				instructions: 'Use this reference.',
				resourceIds: [binding.ids.resources.slides]
			}
		]);
		expect(saved.studentContent!.exercises[0].resourceIds).toEqual([binding.ids.resources.slides]);
		expect(saved.contexts[0].lessons[0].exerciseIds).toEqual([exerciseId]);
		expect(await importModule(db, ids.teacher, 'create', input)).toEqual(receipt);
	});
	it('preserves new public content when an older update omits it', async () => {
		const first = await importModule(db, ids.teacher, 'create', createInput());
		const current = await getModule(db, first.moduleId);
		await updateModule(db, current.id, {
			...editableModule(current),
			expectedRevision: current.revision,
			studentContent: {
				instructions: 'Consignes conservées',
				projectInstructions: '',
				exercises: []
			}
		});
		const input = await updateInput(first.moduleId);
		delete input.draft.studentContent;
		await importModule(db, ids.teacher, 'update', input);
		expect((await getModule(db, current.id)).studentContent?.instructions).toBe('Consignes conservées');
	});
	it('replays a pre-patch version-1 receipt after later manual edits', async () => {
		const created = await importModule(db, ids.teacher, 'create', createInput());
		const input = await updateInput(created.moduleId);
		const receipt = await importModule(db, ids.teacher, 'update', input);
		await db
			.update(tables.agentImports)
			.set({ fingerprint: await importFingerprint({ action: 'update', input }) })
			.where(eq(tables.agentImports.requestId, input.requestId));
		const current = await getModule(db, created.moduleId);
		await updateModule(db, current.id, {
			...editableModule(current),
			title: 'Modification manuelle ultérieure',
			expectedRevision: current.revision
		});
		expect(await importModule(db, ids.teacher, 'update', input)).toEqual(receipt);
		expect((await getModule(db, current.id)).title).toBe('Modification manuelle ultérieure');
	});
	it('creates a complete private module, schedule, rubric and one durable receipt', async () => {
		const input = createInput();
		const receipt = await importModule(db, ids.teacher, 'create', input);
		const module = await getModule(db, receipt.moduleId),
			rubric = await getRubric(db, receipt.moduleId);
		expect(module.title).toBe(input.draft.title);
		expect(module.contexts[0].lessons[0].startsAt).toBe('2026-10-13T07:00:00.000Z');
		expect(rubric.assessments[0].lines[0].id).toBe(input.rubric!.assessments[0].lines[0].id);
		expect(rubric.contexts[0].deadlines[0].assessmentId).toBe(input.rubric!.assessments[0].id);
		expect(receipt.contextRevisions[0].revision).toBe(module.contexts[0].expectedRevision);
		expect(await db.select().from(tables.agentImports)).toHaveLength(1);
		expect(await db.select().from(tables.modulePublications)).toHaveLength(1); // Existing archive only.
	});
	it('replays a lost response without duplicating or overwriting a later UI edit', async () => {
		const input = createInput(),
			first = await importModule(db, ids.teacher, 'create', input);
		const current = await getModule(db, first.moduleId);
		await updateModule(db, current.id, {
			...editableModule(current),
			title: 'Edited in the interface',
			expectedRevision: current.revision
		});
		expect(await importModule(db, ids.teacher, 'create', input)).toEqual(first);
		expect((await getModule(db, first.moduleId)).title).toBe('Edited in the interface');
		expect(await db.select().from(tables.agentImports)).toHaveLength(1);
		await expect(
			importModule(db, ids.teacher, 'create', {
				...input,
				draft: { ...input.draft, title: 'Changed retry' }
			})
		).rejects.toMatchObject({ status: 409 });
	});
	it('replays an update with old revisions, but rejects a distinct stale write', async () => {
		const first = await importModule(db, ids.teacher, 'create', createInput());
		const input = await updateInput(first.moduleId);
		input.draft.title = 'Updated by the agent';
		const saved = await importModule(db, ids.teacher, 'update', input);
		expect(await importModule(db, ids.teacher, 'update', input)).toEqual(saved);
		await expect(
			importModule(db, ids.teacher, 'update', { ...input, requestId: crypto.randomUUID() })
		).rejects.toMatchObject({ status: 409 });
		expect((await getModule(db, first.moduleId)).revision).toBe(saved.revision);
	});
	it('scopes patch receipts to the teacher even when request IDs match', async () => {
		const otherTeacher = crypto.randomUUID();
		await db.insert(tables.user).values({
			id: otherTeacher,
			name: 'Other fictional teacher',
			email: 'other-teacher@example.test'
		});
		const first = await importModule(db, ids.teacher, 'create', createInput());
		const second = await importModule(db, otherTeacher, 'create', createInput());
		const requestId = crypto.randomUUID();
		const firstPatch = {
			version: 2 as const,
			requestId,
			moduleId: first.moduleId,
			expectedRevision: first.revision,
			patch: { title: 'First teacher patch' }
		};
		const secondPatch = {
			...firstPatch,
			moduleId: second.moduleId,
			expectedRevision: second.revision,
			patch: { title: 'Second teacher patch' }
		};
		const firstReceipt = await patchModule(db, ids.teacher, firstPatch);
		const secondReceipt = await patchModule(db, otherTeacher, secondPatch);
		expect(await patchModule(db, ids.teacher, firstPatch)).toEqual(firstReceipt);
		expect(await patchModule(db, otherTeacher, secondPatch)).toEqual(secondReceipt);
		expect(firstReceipt.moduleId).toBe(first.moduleId);
		expect(secondReceipt.moduleId).toBe(second.moduleId);
		expect((await getModule(db, first.moduleId)).title).toBe(firstPatch.patch.title);
		expect((await getModule(db, second.moduleId)).title).toBe(secondPatch.patch.title);
		expect(
			await db.select().from(tables.agentImports).where(eq(tables.agentImports.requestId, requestId))
		).toHaveLength(2);
	});
	it('rejects changed patch content under the same teacher request ID', async () => {
		const created = await importModule(db, ids.teacher, 'create', createInput());
		const input = {
			version: 2 as const,
			requestId: crypto.randomUUID(),
			moduleId: created.moduleId,
			expectedRevision: created.revision,
			patch: { title: 'Accepted patch' }
		};
		const receipt = await patchModule(db, ids.teacher, input);
		await expect(patchModule(db, ids.teacher, { ...input, patch: { title: 'Changed retry' } })).rejects.toMatchObject({
			status: 409
		});
		expect(await patchModule(db, ids.teacher, input)).toEqual(receipt);
		expect((await getModule(db, created.moduleId)).title).toBe(input.patch.title);
		expect(
			await db.select().from(tables.agentImports).where(eq(tables.agentImports.requestId, input.requestId))
		).toHaveLength(1);
	});
	it('rolls back module changes when a rubric identity belongs to another module', async () => {
		const input = createInput();
		input.rubric!.assessments[0].id = ids.project;
		input.rubric!.results[0].rule = { kind: 'points_ratio', assessmentIds: [ids.project] };
		input.rubric!.contexts[0].deadlines[0].assessmentId = ids.project;
		await expect(importModule(db, ids.teacher, 'create', input)).rejects.toMatchObject({
			status: 422
		});
		expect(await db.select().from(tables.modules).where(eq(tables.modules.id, input.moduleId))).toHaveLength(0);
		expect(await db.select().from(tables.resources).where(eq(tables.resources.moduleId, input.moduleId))).toHaveLength(
			0
		);
		expect(await db.select().from(tables.agentImports)).toHaveLength(0);
	});
	it('rejects stale context revisions atomically, even when the module revision is fresh', async () => {
		const first = await importModule(db, ids.teacher, 'create', createInput());
		const input = await updateInput(first.moduleId);
		input.draft.title = 'Must roll back';
		input.draft.contexts[0].expectedRevision = 999;
		await expect(importModule(db, ids.teacher, 'update', input)).rejects.toMatchObject({
			status: 409
		});
		expect((await getModule(db, first.moduleId)).title).toBe('Demo · MCP module');
		expect(await db.select().from(tables.agentImports)).toHaveLength(1);
	});
	it('preserves raw scores and publication when replacing a rubric with a lower maximum', async () => {
		const first = await importModule(db, ids.teacher, 'create', createInput());
		const rubric = await getRubric(db, first.moduleId),
			assessment = rubric.assessments[0];
		const [correction] = await db
			.insert(tables.corrections)
			.values({
				contextId: rubric.contexts[0].id,
				moduleId: first.moduleId,
				studentId: ids.students[0],
				assessmentId: assessment.id,
				status: 'graded'
			})
			.returning();
		await db.insert(tables.scores).values({
			correctionId: correction.id,
			assessmentId: assessment.id,
			lineId: assessment.lines[0].id,
			points: 8
		});
		const publications = await db.select().from(tables.modulePublications);
		const input = updateModuleImportSchema.parse({
			...(await updateInput(first.moduleId)),
			confirmRubricReplacement: true,
			rubric: { assessments: rubric.assessments, results: rubric.results, contexts: [] }
		});
		input.rubric!.assessments[0].lines[0].maxPoints = 5;
		await importModule(db, ids.teacher, 'update', input);
		expect((await db.select().from(tables.scores).where(eq(tables.scores.correctionId, correction.id)))[0].points).toBe(
			8
		);
		expect((await getRubric(db, first.moduleId)).assessments[0].lines[0].maxPoints).toBe(5);
		expect((await getRubric(db, first.moduleId)).contexts[0].deadlines).toEqual(rubric.contexts[0].deadlines);
		expect(await db.select().from(tables.modulePublications)).toEqual(publications);
	});
	it('exposes import metadata without student identities, corrections, proposals or comments', async () => {
		const receipt = await importModule(db, ids.teacher, 'create', createInput());
		const context = importContextSchema.parse(await readImportContext(db, receipt.moduleId));
		expect(context.module?.id).toBe(receipt.moduleId);
		const serialized = JSON.stringify(context);
		for (const secret of [
			ids.students[0],
			ids.correction,
			'Private fictional semester comment.',
			'Private proposal.',
			'Student Demo'
		])
			expect(serialized).not.toContain(secret);
	});
	it('rejects unknown fields, unresolved rubric references and unconfirmed replacement', async () => {
		const input = createInput();
		expect(createModuleImportSchema.safeParse({ ...input, scores: [] }).success).toBe(false);
		input.rubric!.results[0].rule = { kind: 'points_ratio', assessmentIds: [crypto.randomUUID()] };
		await expect(importModule(db, ids.teacher, 'create', input)).rejects.toMatchObject({
			status: 422
		});
		expect(await db.select().from(tables.agentImports)).toHaveLength(0);
		expect(updateModuleImportSchema.safeParse({ ...createInput(), expectedRevision: 1 }).success).toBe(false);
	});
});
