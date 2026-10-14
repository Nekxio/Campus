import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import * as tables from '../db/schema.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import { getModule, updateModule, updateClass } from './service.js';
import { editableModule } from '../../teaching/types.js';
import {
	publicationDecisionSchema,
	publicationSnapshotSchema,
	type PublicationSnapshot
} from '../../domain/publication.js';
import {
	decidePublication,
	getPublicationReview,
	getPublicClass,
	getPublicModule
} from './publications.js';

let client: Client;
let db: Database;
let ids: Awaited<ReturnType<typeof seedFoundationFixtures>>;
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedFoundationFixtures(db);
	await db
		.update(tables.modules)
		.set({
			description: 'Public course description.',
			objectives: ['Build an accessible app'],
			sourcePath: '/PRIVATE/local/module',
			preparation: {
				framing: 'PRIVATE preparation',
				nextSteps: 'PRIVATE next steps',
				sourceLinks: []
			}
		})
		.where(eq(tables.modules.id, ids.module));
	await db.insert(tables.assessmentDeadlines).values({
		contextId: ids.currentContext,
		moduleId: ids.module,
		assessmentId: ids.project,
		dueAt: new Date('2026-10-27T22:59:00Z'),
		submissionInstructions: 'Share the repository link in Teams.'
	});
	await db.insert(tables.lessons).values({
		contextId: ids.currentContext,
		title: 'Accessible navigation',
		startsAt: new Date('2026-10-12T07:00:00Z'),
		endsAt: new Date('2026-10-12T10:00:00Z'),
		recap: 'Public recap.',
		toDo: 'Public next task.'
	});
});
afterEach(() => client.close());

async function command(
	action: 'publish' | 'unpublish' = 'publish',
	contextId = ids.currentContext
) {
	const review = await getPublicationReview(db, ids.module, contextId);
	const selected = review.selected!;
	return publicationDecisionSchema.parse({
		requestId: crypto.randomUUID(),
		contextId,
		action,
		expectedRevision: selected.publicationRevision,
		moduleRevision: selected.moduleRevision,
		contextRevision: selected.contextRevision,
		classRevision: selected.classRevision,
		confirm: true
	});
}
const publish = async () => decidePublication(db, ids.teacher, ids.module, await command());

describe('Public snapshots and teacher decisions', () => {
	it('keeps drafts private and gives an empty directory no unpublished class identity', async () => {
		await expect(getPublicModule(db, ids.currentContext)).rejects.toMatchObject({ status: 404 });
		expect(await getPublicClass(db, ids.currentClass)).toEqual({
			classId: ids.currentClass,
			className: null,
			academicYear: null,
			modules: []
		});
	});
	it('publishes the exact allowlisted class context without private records or correction writes', async () => {
		const before = await db.select().from(tables.corrections);
		const receipt = await publish();
		const page = await getPublicModule(db, ids.currentContext);
		expect(page.snapshot).toMatchObject({
			version: 2,
			description: 'Public course description.',
			className: 'B2 Demo',
			academicYear: '2026-2027',
			objectives: ['Build an accessible app'],
			recap: '',
			toDo: '',
			deadlines: [
				{
					label: 'Project Demo',
					dueAt: '2026-10-27T22:59:00.000Z',
					submissionInstructions: 'Share the repository link in Teams.'
				}
			]
		});
		expect(page.snapshot.lessonNotes).toHaveLength(1);
		expect(page.snapshot.lessonNotes[0].recap).toBe('Public recap.');
		expect(JSON.stringify(page)).not.toMatch(
			/PRIVATE|Student Demo|semester|teacher@example|demo-repository|Private proposal/
		);
		expect(Object.keys(page).sort()).toEqual(['classPath', 'contextId', 'publishedAt', 'snapshot']);
		expect(page.classPath).toBe('/classes/' + ids.currentClass);
		expect(receipt.publicPath).toBe('/modules/' + ids.currentContext);
		expect(await db.select().from(tables.corrections)).toEqual(before);
	});
	it('lists only published snapshot titles and descriptions, never the newest private draft', async () => {
		await publish();
		const before = await getModule(db, ids.module);
		await updateModule(db, before.id, {
			...editableModule(before),
			title: 'PRIVATE changed title',
			expectedRevision: before.revision
		});
		const directory = await getPublicClass(db, ids.currentClass);
		expect(directory.modules).toHaveLength(1);
		expect(directory.modules[0].title).toBe('Demo · Application web');
		expect(JSON.stringify(directory)).not.toMatch(/PRIVATE|Student Demo|studentCount|preparation/);
		expect((await getPublicationReview(db, ids.module, ids.currentContext)).selected?.changed).toBe(
			true
		);
	});
	it('keeps the old link, deadline and notes until the new saved draft is explicitly published', async () => {
		await publish();
		const oldPage = await getPublicModule(db, ids.currentContext);
		const before = await getModule(db, ids.module);
		const draft = editableModule(before);
		draft.resources[0].url = 'https://example.test/replaced.pdf';
		draft.contexts
			.find((c) => c.id === ids.currentContext)!
			.lessons.find((l) => l.recap === 'Public recap.')!.recap = 'New public recap.';
		await updateModule(db, before.id, { ...draft, expectedRevision: before.revision });
		expect(await getPublicModule(db, ids.currentContext)).toEqual(oldPage);
		await publish();
		const current = await getPublicModule(db, ids.currentContext);
		expect(current.snapshot.resources[0].url).toBe('https://example.test/replaced.pdf');
		expect(current.snapshot.lessonNotes[0].recap).toBe('New public recap.');
		expect((await getPublicationReview(db, ids.module, ids.currentContext)).selected?.changed).toBe(
			false
		);
	});
	it('requires all reviewed source baselines before publishing a new version', async () => {
		const input = await command();
		await updateClass(db, ids.currentClass, {
			name: 'PRIVATE unreviewed class',
			academicYear: '2026-2027',
			expectedRevision: 1
		});
		await expect(decidePublication(db, ids.teacher, ids.module, input)).rejects.toMatchObject({
			status: 409
		});
		expect((await getPublicClass(db, ids.currentClass)).className).toBeNull();
		expect(await db.select().from(tables.publicationReceipts)).toEqual([]);
	});
	it.each(['moduleRevision', 'contextRevision', 'classRevision'] as const)(
		'refuses a stale %s without a publication write',
		async (field) => {
			const input = await command();
			input[field] += 1;
			await expect(decidePublication(db, ids.teacher, ids.module, input)).rejects.toMatchObject({
				status: 409
			});
			await expect(getPublicModule(db, ids.currentContext)).rejects.toMatchObject({ status: 404 });
		}
	);
	it('rejects a context from another module without writing either one', async () => {
		const input = await command();
		input.contextId = ids.secondContext;
		await expect(decidePublication(db, ids.teacher, ids.module, input)).rejects.toMatchObject({
			status: 404
		});
		await expect(getPublicationReview(db, ids.module, ids.secondContext)).rejects.toMatchObject({
			status: 404
		});
		expect(await db.select().from(tables.publicationReceipts)).toEqual([]);
	});
	it('replays an identical lost-response request without another revision or new snapshot', async () => {
		const input = await command();
		const first = await decidePublication(db, ids.teacher, ids.module, input);
		expect(await decidePublication(db, ids.teacher, ids.module, input)).toEqual(first);
		expect(await db.select().from(tables.publicationReceipts)).toHaveLength(1);
		expect(
			(await getPublicationReview(db, ids.module, ids.currentContext)).selected?.publicationRevision
		).toBe(1);
		await expect(
			decidePublication(db, ids.teacher, ids.module, { ...input, action: 'unpublish' })
		).rejects.toMatchObject({ status: 409 });
	});
	it('protects the publication revision from a second teacher decision based on the old page', async () => {
		const input = await command();
		await publish();
		await expect(decidePublication(db, ids.teacher, ids.module, input)).rejects.toMatchObject({
			status: 409
		});
		expect(
			(await getPublicationReview(db, ids.module, ids.currentContext)).selected?.publicationRevision
		).toBe(1);
	});
	it('unpublishes both public routes immediately and an old publish retry cannot bring the page back', async () => {
		const original = await command();
		const receipt = await decidePublication(db, ids.teacher, ids.module, original);
		const off = await command('unpublish');
		await decidePublication(db, ids.teacher, ids.module, off);
		await expect(getPublicModule(db, ids.currentContext)).rejects.toMatchObject({ status: 404 });
		expect((await getPublicClass(db, ids.currentClass)).modules).toEqual([]);
		expect(await decidePublication(db, ids.teacher, ids.module, original)).toEqual(receipt);
		await expect(getPublicModule(db, ids.currentContext)).rejects.toMatchObject({ status: 404 });
	});
	it('does not let an old unpublish retry remove a newer explicit republication', async () => {
		await publish();
		const off = await command('unpublish');
		const offReceipt = await decidePublication(db, ids.teacher, ids.module, off);
		const on = await publish();
		expect(on.publicPath).toBe(offReceipt.publicPath);
		expect(on.revision).toBe(3);
		expect(await decidePublication(db, ids.teacher, ids.module, off)).toEqual(offReceipt);
		expect((await getPublicModule(db, ids.currentContext)).snapshot.title).toBe(
			'Demo · Application web'
		);
	});
	it('retains independent public module pages after annual class deletion, and can take them offline', async () => {
		await publish();
		const before = await getPublicModule(db, ids.currentContext);
		await db.delete(tables.classes).where(eq(tables.classes.id, ids.currentClass));
		await expect(getPublicClass(db, ids.currentClass)).rejects.toMatchObject({ status: 404 });
		expect(await getPublicModule(db, ids.currentContext)).toEqual({ ...before, classPath: null });
		const review = await getPublicationReview(db, ids.module, ids.currentContext);
		expect(review.selected).toMatchObject({ draft: null, context: { archived: true } });
		await expect(publish()).rejects.toMatchObject({ status: 409 });
		await decidePublication(db, ids.teacher, ids.module, await command('unpublish'));
		await expect(getPublicModule(db, ids.currentContext)).rejects.toMatchObject({ status: 404 });
	});
	it('keeps legacy snapshots private until an active context is explicitly republished', async () => {
		await expect(getPublicModule(db, ids.oldContext)).rejects.toMatchObject({ status: 404 });
		expect((await getPublicationReview(db, ids.module, ids.oldContext)).selected?.status).toBe(
			'legacy'
		);
		await db
			.update(tables.modulePublications)
			.set({ contextId: ids.currentContext })
			.where(eq(tables.modulePublications.contextId, ids.oldContext));
		expect((await getPublicationReview(db, ids.module, ids.currentContext)).selected?.status).toBe(
			'legacy'
		);
		await publish();
		expect((await getPublicModule(db, ids.currentContext)).snapshot.version).toBe(2);
	});
	it('fails closed on a malformed or extra-field snapshot and never falls back to a draft', async () => {
		await publish();
		const snapshot = (await getPublicModule(db, ids.currentContext)).snapshot;
		await db
			.update(tables.modulePublications)
			.set({
				snapshot: { ...snapshot, studentNames: ['PRIVATE'] } as unknown as PublicationSnapshot
			})
			.where(eq(tables.modulePublications.contextId, ids.currentContext));
		await expect(getPublicModule(db, ids.currentContext)).rejects.toMatchObject({ status: 404 });
		expect((await getPublicClass(db, ids.currentClass)).modules).toEqual([]);
	});
	it('rejects unsafe stored links before publishing and rolls back the action', async () => {
		const input = await command();
		await db
			.update(tables.resources)
			.set({ url: 'javascript:alert(1)' })
			.where(eq(tables.resources.id, ids.resource));
		await expect(decidePublication(db, ids.teacher, ids.module, input)).rejects.toMatchObject({
			status: 422
		});
		await expect(getPublicModule(db, ids.currentContext)).rejects.toMatchObject({ status: 404 });
		expect(await db.select().from(tables.publicationReceipts)).toEqual([]);
	});
	it('rolls back a snapshot update if saving its receipt fails', async () => {
		await expect(
			decidePublication(db, crypto.randomUUID(), ids.module, await command())
		).rejects.toThrow();
		await expect(getPublicModule(db, ids.currentContext)).rejects.toMatchObject({ status: 404 });
	});
	it('does not infer Drive permissions or fetch any external file while publishing', async () => {
		const url = 'https://drive.google.com/file/d/fictional-only/view';
		await db.update(tables.resources).set({ url }).where(eq(tables.resources.id, ids.resource));
		await publish();
		expect((await getPublicModule(db, ids.currentContext)).snapshot.resources[0].url).toBe(url);
		expect((await db.select().from(tables.resources))[0].url).toBe(url);
	});
	it('strictly validates commands and public metadata, with no submitted payload or execution fields', async () => {
		const input = await command();
		expect(
			publicationDecisionSchema.safeParse({ ...input, snapshot: { private: true } }).success
		).toBe(false);
		expect(publicationDecisionSchema.safeParse({ ...input, confirm: false }).success).toBe(false);
		expect(publicationDecisionSchema.safeParse({ ...input, expectedRevision: 1.5 }).success).toBe(
			false
		);
		const snapshot = (await getPublicationReview(db, ids.module, ids.currentContext)).selected!
			.draft!;
		expect(publicationSnapshotSchema.safeParse({ ...snapshot, preparation: {} }).success).toBe(
			false
		);
	});
});
