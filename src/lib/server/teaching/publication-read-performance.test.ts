import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import * as tables from '../db/schema.js';
import { createDatabase, type Database } from '../db/index.js';
import { instrumentDatabaseClient } from '../db/timing.js';
import { createServerTiming } from '../server-timing.js';
import { seedPublicationFixtures } from '../db/testing/publication-fixtures.js';
import { getPublicationReview, getPublicClass, getPublicModule, getPublicRecoveryClassId } from './publications.js';
import { listPublishedClasses } from './student-views.js';

let client: Client;
let ids: Awaited<ReturnType<typeof seedPublicationFixtures>>;
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	const db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedPublicationFixtures(db);
});
afterEach(() => client.close());

const journeys = [
	{
		name: 'public directory',
		budget: 6,
		read: (db: Database) => db.transaction((tx) => getPublicClass(tx, ids.currentClass)),
		check: (value: unknown) =>
			expect(value).toMatchObject({ classId: ids.currentClass, modules: [{ contextId: ids.publicationContext }] })
	},
	{
		name: 'public course with validated directory recovery',
		budget: 8,
		read: (db: Database) =>
			db.transaction(async (tx) => {
				const published = await getPublicModule(tx, ids.publicationContext);
				return { published, classId: await getPublicRecoveryClassId(tx, published) };
			}),
		check: (value: unknown) =>
			expect(value).toMatchObject({ classId: ids.currentClass, published: { contextId: ids.publicationContext } })
	},
	{
		name: 'publication review',
		budget: 11,
		read: (db: Database) =>
			db.transaction((tx) => getPublicationReview(tx, ids.publicationModule, ids.publicationContext)),
		check: (value: unknown) => expect(value).toMatchObject({ selected: { context: { id: ids.publicationContext } } })
	},
	{
		name: 'teacher published pages',
		budget: 7,
		read: listPublishedClasses,
		check: (value: unknown) => expect(value).toMatchObject([{ publicId: ids.currentClass, moduleCount: 1 }])
	}
];

describe('Published navigation driver-call budgets', () => {
	it.each(journeys)('bounds $name without skipping validated public content', async ({ name, budget, read, check }) => {
		const timing = createServerTiming();
		const result = await read(createDatabase(instrumentDatabaseClient(client, timing)));
		check(result);
		const calls = Number(/desc="(\d+) calls"/.exec(timing.header())?.[1]);
		expect(calls, `${name}: completed driver calls`).toBeGreaterThan(0);
		expect(calls, `${name}: completed driver calls`).toBeLessThanOrEqual(budget);
	});
});

it('projects only active rubric criteria, retaining empty groups and the reviewed public content', async () => {
	const db = createDatabase(client);
	const before = await getPublicModule(db, ids.publicationContext);
	const [assessment] = await db
		.select()
		.from(tables.assessments)
		.where(eq(tables.assessments.moduleId, ids.publicationModule));
	const [group] = await db
		.select()
		.from(tables.rubricGroups)
		.where(eq(tables.rubricGroups.assessmentId, assessment.id));
	const emptyGroup = crypto.randomUUID();
	const retiredGroup = crypto.randomUUID();
	await db.insert(tables.rubricGroups).values([
		{ id: emptyGroup, assessmentId: assessment.id, title: 'Empty active group', position: 1 },
		{ id: retiredGroup, assessmentId: assessment.id, title: 'RETIRED GROUP', position: 2, retiredAt: new Date() }
	]);
	await db.insert(tables.rubricLines).values([
		{
			assessmentId: assessment.id,
			groupId: group.id,
			label: 'RETIRED LINE',
			description: '',
			maxPoints: 1,
			position: 1,
			retiredAt: new Date()
		},
		{
			assessmentId: assessment.id,
			groupId: retiredGroup,
			label: 'Hidden with retired group',
			description: '',
			maxPoints: 1,
			position: 0
		}
	]);
	await db.insert(tables.assessments).values([
		{
			moduleId: ids.publicationModule,
			title: 'RETIRED ASSESSMENT',
			kind: 'project',
			purpose: 'graded',
			position: 1,
			retiredAt: new Date()
		}
	]);
	const draft = (await getPublicationReview(db, ids.publicationModule, ids.publicationContext)).selected!.draft!;
	expect(draft.rubric).toEqual([
		{
			...before.snapshot.rubric[0],
			groups: [...before.snapshot.rubric[0].groups, { title: 'Empty active group', lines: [] }]
		}
	]);
	expect(JSON.stringify(draft)).not.toMatch(
		/RETIRED|Hidden with retired group|expectedRevision|sourcePath|semesterComments/
	);
});
