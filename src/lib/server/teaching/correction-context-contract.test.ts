import { afterEach, beforeEach, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDatabase, type Database } from '../db/index.js';
import { seedGradingFixtures } from '../db/testing/grading-fixtures.js';
import { getCorrectionContext } from './proposals.js';
import { getRubric, replaceRubric } from './grading.js';
import { students } from '../db/schema.js';
import { correctionContextSchema } from '../../domain/proposals.js';
import { agentClient } from '../../../../scripts/mcp/client.js';

let client: Client, db: Database, ids: Awaited<ReturnType<typeof seedGradingFixtures>>;
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedGradingFixtures(db);
});
afterEach(() => client.close());

it.each([false, true])('passes persisted needsReview=%s through the real stdio client parser', async (needsReview) => {
	if (needsReview) {
		const rubric = await getRubric(db, ids.module);
		rubric.assessments.find((item) => item.id === ids.project)!.lines[0].maxPoints++;
		await replaceRubric(db, ids.module, {
			assessments: rubric.assessments,
			results: rubric.results,
			expectedRevision: rubric.module.revision,
			contexts: rubric.contexts.map(({ id, expectedRevision, deadlines }) => ({
				id,
				expectedRevision,
				deadlines
			}))
		});
	}
	const response = await getCorrectionContext(db, ids.module, ids.currentContext, ids.students[0]);
	const api = agentClient(
		{
			version: 1,
			origin: 'https://campus.example.test',
			key: 'coursely_' + 'a'.repeat(64),
			keyId: 'fictional',
			teacherId: ids.teacher,
			expiresAt: new Date(Date.now() + 60000).toISOString()
		},
		async () => new Response(JSON.stringify(response))
	);
	const parsed = await api.correctionContext(ids.module, ids.currentContext, ids.students[0]);
	expect(parsed.student!.corrections.find((item) => item.assessmentId === ids.project)!.needsReview).toBe(needsReview);
	expect(parsed.student!.corrections).toHaveLength(response.student!.corrections.length);
	const extra = structuredClone(response);
	expect(
		correctionContextSchema.safeParse({
			...extra,
			student: {
				...extra.student!,
				corrections: extra.student!.corrections.map((item) => ({ ...item, privateExtra: true }))
			}
		}).success
	).toBe(false);
	const legacy = structuredClone(response);
	for (const correction of legacy.student!.corrections) delete correction.needsReview;
	expect(correctionContextSchema.safeParse(legacy).success).toBe(true);
	expect(correctionContextSchema.safeParse({ ...response, privateExtra: true }).success).toBe(false);
});

it('keeps empty corrections and roster-only contexts valid', async () => {
	const roster = await getCorrectionContext(db, ids.module, ids.currentContext);
	expect(correctionContextSchema.parse(roster).student).toBeNull();
	const studentId = crypto.randomUUID();
	await db.insert(students).values({ id: studentId, classId: ids.currentClass, name: 'Sans correction fictive' });
	const context = await getCorrectionContext(db, ids.module, ids.currentContext, studentId);
	expect(context.student!.corrections).toEqual([]);
	expect(correctionContextSchema.parse(context)).toEqual(context);
});
