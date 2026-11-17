import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import * as t from '../db/schema.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import { getAnnualData, decideAnnualYear } from './annual.js';
import {
	decidePublication,
	getPublicationReview,
	getPublicModule,
	getPublicClass,
	getPublicRecoveryClassId
} from './publications.js';
import { publicClassPath, type PublicationSnapshot } from '../../domain/publication.js';

let client: Client;
let db: Database;
let ids: Awaited<ReturnType<typeof seedFoundationFixtures>>;
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedFoundationFixtures(db);
});
afterEach(() => {
	vi.restoreAllMocks();
	client.close();
});
async function decide(
	action: 'publish' | 'unpublish' = 'publish',
	moduleId = ids.module,
	contextId = ids.currentContext
) {
	const review = (await getPublicationReview(db, moduleId, contextId)).selected!;
	return decidePublication(db, ids.teacher, moduleId, {
		requestId: crypto.randomUUID(),
		contextId,
		action,
		expectedRevision: review.publicationRevision,
		moduleRevision: review.moduleRevision,
		contextRevision: review.contextRevision,
		classRevision: review.classRevision,
		confirm: true
	});
}
const recover = (contextId: string = ids.currentContext) =>
	db.transaction(async (tx) => {
		const published = await getPublicModule(tx, contextId);
		return getPublicRecoveryClassId(tx, published);
	});

describe('Recovery requires current public module and directory evidence', () => {
	it('proves only the exact public directory containing the public module', async () => {
		await decide();
		expect(await recover()).toBe(ids.currentClass);
		const published = await getPublicModule(db, ids.currentContext);
		expect(Object.keys(published).sort()).toEqual(['classPath', 'contextId', 'publishedAt', 'snapshot']);
	});
	it('uses durable public UUIDs rather than class names or annual identities', async () => {
		await decide();
		const classId = crypto.randomUUID(),
			moduleId = crypto.randomUUID();
		await db.insert(t.publicClassLinks).values({ id: classId, classId: ids.currentClass });
		await db
			.update(t.publicModuleLinks)
			.set({ id: moduleId })
			.where(eq(t.publicModuleLinks.contextId, ids.currentContext));
		expect(await recover(moduleId)).toBe(classId);
		await expect(recover()).rejects.toMatchObject({ status: 404 });
	});
	it('proves a retained v2 snapshot after real annual continuation through the current directory', async () => {
		await decide();
		const before = await getPublicModule(db, ids.currentContext);
		const preview = (await getAnnualData(db, ids.teacher, '2026-2027')).selected!;
		await decideAnnualYear(db, ids.teacher, {
			academicYear: preview.academicYear,
			action: 'purge',
			requestId: crypto.randomUUID(),
			reviewToken: preview.reviewToken,
			typedYear: preview.academicYear,
			pdfsKept: true,
			nextAcademicYear: '2027-2028',
			moduleChoices: [...new Set(preview.contexts.map((context) => context.moduleId))].map((moduleId) => ({
				moduleId,
				decision: 'continue' as const
			}))
		});
		const continued = await getPublicModule(db, ids.currentContext);
		expect(continued.snapshot).toEqual(before.snapshot);
		expect(continued.snapshot.academicYear).toBe('2026-2027');
		expect(await recover()).toBe(ids.currentClass);
		expect((await getPublicClass(db, ids.currentClass)).modules.map((module) => module.publicPath)).toContain(
			'/modules/' + ids.currentContext
		);
	});
	it.each(['not-a-uuid', '00000000-0000-4000-8000-000000000000'])(
		'does not acquire evidence for missing identity %s',
		async (id) => {
			await decide();
			await expect(recover(id)).rejects.toMatchObject({ status: 404 });
		}
	);
	it('does not turn a private relationship or a neighboring public course into evidence for a draft', async () => {
		await decide('publish', ids.secondModule, ids.secondContext);
		expect((await getPublicClass(db, ids.currentClass)).modules).toHaveLength(1);
		await expect(recover()).rejects.toMatchObject({ status: 404 });
	});
	it('does not use a retained unpublished snapshot or a directory identity without visible modules', async () => {
		await decide();
		const published = await getPublicModule(db, ids.currentContext);
		await decide('unpublish');
		expect((await getPublicationReview(db, ids.module, ids.currentContext)).selected?.published).not.toBeNull();
		const directory = await getPublicClass(db, ids.currentClass);
		expect(directory.className).toBe('B2 Demo');
		expect(directory.modules).toEqual([]);
		await expect(recover()).rejects.toMatchObject({ status: 404 });
		expect(await getPublicRecoveryClassId(db, published)).toBeNull();
	});
	it.each(['paused', 'disabled'] as const)('does not acquire evidence for a %s module', async (state) => {
		await decide();
		if (state === 'paused')
			await db.update(t.modules).set({ pausedAt: new Date() }).where(eq(t.modules.id, ids.module));
		else
			await db
				.update(t.publicModuleLinks)
				.set({ enabled: false })
				.where(eq(t.publicModuleLinks.contextId, ids.currentContext));
		await expect(recover()).rejects.toMatchObject({ status: 404 });
		expect((await getPublicClass(db, ids.currentClass)).modules).toEqual([]);
	});
	it.each(['malformed', 'legacy', 'extra-field'] as const)(
		'rejects a %s snapshot before acquiring evidence',
		async (state) => {
			await decide();
			const published = await getPublicModule(db, ids.currentContext);
			const snapshot =
				state === 'malformed'
					? {}
					: state === 'legacy'
						? { ...published.snapshot, version: 1 }
						: { ...published.snapshot, preparation: 'PRIVATE' };
			await db
				.update(t.modulePublications)
				.set({ snapshot: snapshot as PublicationSnapshot })
				.where(eq(t.modulePublications.contextId, ids.currentContext));
			await expect(recover()).rejects.toMatchObject({ status: 404 });
			expect(
				await getPublicRecoveryClassId(db, {
					...published,
					snapshot: snapshot as PublicationSnapshot
				})
			).toBeNull();
		}
	);
	it.each(['detached', 'deleted'] as const)(
		'keeps an independently public module neutral when its class is %s',
		async (state) => {
			await decide();
			if (state === 'detached')
				await db.update(t.teachingContexts).set({ classId: null }).where(eq(t.teachingContexts.id, ids.currentContext));
			else await db.delete(t.classes).where(eq(t.classes.id, ids.currentClass));
			expect((await getPublicModule(db, ids.currentContext)).classPath).toBeNull();
			expect(await recover()).toBeNull();
		}
	);
	it.each([
		null,
		'/',
		'/classes/not-a-uuid',
		'/classes/00000000-0000-4000-8000-000000000000?class=B3',
		'https://campus.example/classes/00000000-0000-4000-8000-000000000000'
	])('rejects a noncanonical classPath %s without any further reads', async (classPath) => {
		await decide();
		const published = await getPublicModule(db, ids.currentContext);
		const select = vi.spyOn(db, 'select');
		expect(await getPublicRecoveryClassId(db, { ...published, classPath })).toBeNull();
		expect(select).not.toHaveBeenCalled();
	});
	it('treats an absent directory as no proof, but propagates a database failure', async () => {
		await decide();
		const published = await getPublicModule(db, ids.currentContext);
		expect(
			await getPublicRecoveryClassId(db, {
				...published,
				classPath: publicClassPath(crypto.randomUUID())
			})
		).toBeNull();
		const failure = new Error('Fictional database failure');
		vi.spyOn(db, 'select').mockImplementation(() => {
			throw failure;
		});
		await expect(getPublicRecoveryClassId(db, published)).rejects.toBe(failure);
	});
});
