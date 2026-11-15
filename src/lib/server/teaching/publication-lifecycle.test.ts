import { afterEach, beforeEach, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import * as t from '../db/schema.js';
import { getAnnualData, decideAnnualYear } from './annual.js';
import { attachModule, createClass } from './service.js';
import { decidePublication, getPublicationReview, getPublicClass, getPublicModule } from './publications.js';

const teacherId = '10000000-0000-4000-8000-000000000001';
const moduleId = '10000000-0000-4000-8000-000000000002';
const initialClassId = '10000000-0000-4000-8000-000000000003';
const stableId = '10000000-0000-4000-8000-000000000004';
const marker = 'Fictional retained snapshot marker';
let client: Client;
let db: Database;

beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	await db.insert(t.user).values({ id: teacherId, name: 'Fictional Teacher', email: 'audit@example.test' });
	await db.insert(t.modules).values({
		id: moduleId,
		title: 'Fictional lifecycle module',
		studentContent: { instructions: marker, projectInstructions: '', exercises: [] },
		preparation: { framing: 'PRIVATE_FIXTURE_ONLY', nextSteps: '', sourceLinks: [] }
	});
	await db.insert(t.classes).values({ id: initialClassId, name: 'Fictional class', academicYear: '2026-2027' });
	await db.insert(t.teachingContexts).values({
		id: stableId,
		moduleId,
		classId: initialClassId,
		className: 'Fictional class',
		academicYear: '2026-2027'
	});
});

afterEach(() => client.close());

const publicationDecision = async (contextId: string, action: 'publish' | 'unpublish') => {
	const review = (await getPublicationReview(db, moduleId, contextId)).selected!;
	return decidePublication(db, teacherId, moduleId, {
		requestId: crypto.randomUUID(),
		contextId,
		action,
		expectedRevision: review.publicationRevision,
		moduleRevision: review.moduleRevision,
		contextRevision: review.contextRevision,
		classRevision: review.classRevision,
		confirm: true
	});
};

const purge = async (academicYear: string, decision: 'continue' | 'pause', nextAcademicYear?: string) => {
	const preview = (await getAnnualData(db, teacherId, academicYear)).selected!;
	return decideAnnualYear(db, teacherId, {
		academicYear,
		action: 'purge',
		requestId: crypto.randomUUID(),
		reviewToken: preview.reviewToken,
		typedYear: academicYear,
		pdfsKept: true,
		...(nextAcademicYear ? { nextAcademicYear } : {}),
		moduleChoices: [{ moduleId, decision }]
	});
};

it.each([
	{ continuations: 1, explicitUnpublish: false },
	{ continuations: 1, explicitUnpublish: true },
	{ continuations: 2, explicitUnpublish: false },
	{ continuations: 2, explicitUnpublish: true }
])(
	'keeps annual aliases private through pause and republication ($continuations, $explicitUnpublish)',
	async ({ continuations, explicitUnpublish }) => {
		await publicationDecision(stableId, 'publish');
		let annualId = stableId;
		for (let index = 0; index < continuations; index++) {
			await purge(`${2026 + index}-${2027 + index}`, 'continue', `${2027 + index}-${2028 + index}`);
			const contexts = await db.select().from(t.teachingContexts).where(eq(t.teachingContexts.moduleId, moduleId));
			const active = contexts.find((context) => !context.archivedAt)!;
			annualId = active.id;
			expect(annualId).not.toBe(stableId);
			const receipt = await publicationDecision(annualId, 'publish');
			expect(receipt.publicPath).toBe(`/modules/${stableId}`);
		}
		const linksBefore = await db.select().from(t.publicModuleLinks).where(eq(t.publicModuleLinks.moduleId, moduleId));
		expect(linksBefore).toHaveLength(1);
		expect(linksBefore[0]).toMatchObject({
			id: stableId,
			contextId: annualId,
			publishedContextId: annualId,
			enabled: true
		});
		expect(linksBefore.some((link) => link.id === annualId)).toBe(false);
		if (explicitUnpublish) await publicationDecision(annualId, 'unpublish');
		await purge(`${2026 + continuations}-${2027 + continuations}`, 'pause');
		await expect(getPublicModule(db, stableId)).rejects.toMatchObject({ status: 404 });
		await expect(getPublicModule(db, annualId)).rejects.toMatchObject({ status: 404 });
		const [oldContext] = await db.select().from(t.teachingContexts).where(eq(t.teachingContexts.id, annualId));
		expect(oldContext.classId).toBeNull();
		expect(oldContext.archivedAt).not.toBeNull();
		const [retained] = await db.select().from(t.modulePublications).where(eq(t.modulePublications.contextId, annualId));
		expect(retained.unpublishedAt !== null).toBe(explicitUnpublish);
		const resumedClass = await createClass(db, { name: 'Fictional resumed class', academicYear: '2030-2031' });
		const [paused] = await db.select().from(t.modules).where(eq(t.modules.id, moduleId));
		expect(paused.pausedAt).not.toBeNull();
		const resumed = await attachModule(db, resumedClass.id, {
			moduleId,
			moduleRevision: paused.revision,
			expectedRevision: 1
		});
		const [linkAfter] = await db.select().from(t.publicModuleLinks).where(eq(t.publicModuleLinks.moduleId, moduleId));
		expect(linkAfter).toMatchObject({
			id: stableId,
			contextId: resumed.id,
			publishedContextId: annualId,
			enabled: false
		});
		await expect(getPublicModule(db, stableId)).rejects.toMatchObject({ status: 404 });
		expect((await getPublicClass(db, resumedClass.id)).modules).toEqual([]);
		await expect(getPublicModule(db, annualId)).rejects.toMatchObject({ status: 404 });
		const stableReceipt = await publicationDecision(resumed.id, 'publish');
		expect(stableReceipt.publicPath).toBe(`/modules/${stableId}`);
		const published = await getPublicModule(db, stableId);
		expect(published.snapshot.studentContent.instructions).toBe(marker);
		expect(JSON.stringify(published)).not.toContain('PRIVATE_FIXTURE_ONLY');
		await expect(getPublicModule(db, annualId)).rejects.toMatchObject({ status: 404 });
	}
);
