import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import * as t from '../db/schema.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import { decideAnnualYear, getAnnualData } from './annual.js';
import type { AnnualAction } from '../../domain/annual.js';

let client: Client;
let db: Database;
let ids: Awaited<ReturnType<typeof seedFoundationFixtures>>;
let quizId: string;

beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedFoundationFixtures(db);
	const groupId = crypto.randomUUID();
	const lineId = crypto.randomUUID();
	const optionId = crypto.randomUUID();
	quizId = crypto.randomUUID();
	await db.insert(t.rubricGroups).values({ id: groupId, assessmentId: ids.quiz, title: 'Quiz' });
	await db
		.insert(t.rubricLines)
		.values({ id: lineId, groupId, assessmentId: ids.quiz, label: 'Native quiz', maxPoints: 1 });
	await db.insert(t.quizDrafts).values({
		id: quizId,
		moduleId: ids.module,
		contextId: ids.currentContext,
		assessmentId: ids.quiz,
		lineId,
		content: {
			version: 1,
			title: 'Fictional annual quiz',
			durationSeconds: 60,
			questions: [
				{
					id: crypto.randomUUID(),
					type: 'single',
					prompt: 'Fictional question',
					code: '',
					codeLanguage: '',
					options: [
						{ id: optionId, text: 'Correct' },
						{ id: crypto.randomUUID(), text: 'Incorrect' }
					],
					correctOptionIds: [optionId]
				}
			]
		}
	});
});

afterEach(() => client.close());

const run = async (
	status: 'lobby' | 'running' | 'closed',
	contextId = ids.currentContext,
	sourceRunId: string | null = null
) => {
	const id = crypto.randomUUID();
	await db.insert(t.quizRuns).values({ id, quizId, contextId, teacherId: ids.teacher, status, sourceRunId });
	return id;
};
const action = async (kind: AnnualAction['action'], year = '2026-2027'): Promise<AnnualAction> => {
	const { selected } = await getAnnualData(db, ids.teacher, year);
	return {
		academicYear: year,
		action: kind,
		reviewToken: selected!.reviewToken,
		requestId: crypto.randomUUID(),
		typedYear: kind === 'purge' ? year : '',
		pdfsKept: kind === 'purge',
		...(kind === 'purge'
			? {
					moduleChoices: [...new Set(selected!.contexts.map((context) => context.moduleId))].map((moduleId) => ({
						moduleId,
						decision: 'pause' as const
					}))
				}
			: {})
	};
};

describe('Annual quiz lifecycle boundaries', () => {
	it.each(['lobby', 'running'] as const)(
		'blocks archive and purge while a quiz is %s, even with a claimed cleanup proof',
		async (status) => {
			const runId = await run(status);
			const purgeQuizRuns = vi.fn(async () => [runId]);
			for (const kind of ['archive', 'purge'] as const)
				await expect(decideAnnualYear(db, ids.teacher, await action(kind), { purgeQuizRuns })).rejects.toMatchObject({
					status: 409,
					body: { message: expect.stringContaining('quiz') }
				});
			expect(await db.select().from(t.academicYears)).toHaveLength(0);
			expect(await db.select().from(t.students).where(eq(t.students.classId, ids.currentClass))).toHaveLength(12);
			expect(await db.select().from(t.quizRuns)).toHaveLength(1);
			expect(purgeQuizRuns).not.toHaveBeenCalled();
		}
	);

	it('allows read-only archive of closed quizzes without deleting their index or requiring a DO cleanup', async () => {
		const runId = await run('closed');
		await decideAnnualYear(db, ids.teacher, await action('archive'));
		expect((await getAnnualData(db, ids.teacher, '2026-2027')).selected!.status).toBe('archived');
		expect((await db.select().from(t.quizRuns))[0].id).toBe(runId);
	});

	it('persists cleanup work and requires exact confirmation before acknowledging the purge', async () => {
		const first = await run('closed');
		const second = await run('closed', ids.currentContext, first);
		const command = await action('purge');
		for (const proof of [
			undefined,
			{ purgeQuizRuns: async () => [first] },
			{ purgeQuizRuns: async () => [first, second, crypto.randomUUID()] },
			{ purgeQuizRuns: async () => [first, first] }
		])
			await expect(decideAnnualYear(db, ids.teacher, command, proof)).rejects.toMatchObject({
				status: 409
			});
		expect(await db.select().from(t.quizRuns)).toHaveLength(0);
		expect((await db.select().from(t.annualReceipts))[0].pendingQuizRunIds).toEqual([first, second].sort());
		const purgeQuizRuns = vi.fn(async () => [second, first]);
		const receipt = await decideAnnualYear(db, ids.teacher, command, { purgeQuizRuns });
		expect(purgeQuizRuns).toHaveBeenCalledExactlyOnceWith([first, second].sort());
		expect(receipt.action).toBe('purge');
		expect(await db.select().from(t.quizRuns)).toHaveLength(0);
		expect(await db.select().from(t.students).where(eq(t.students.classId, ids.currentClass))).toHaveLength(0);
		expect(await db.select().from(t.quizDrafts)).toHaveLength(1);
		expect(await decideAnnualYear(db, ids.teacher, command)).toEqual(receipt);
	});

	it('invalidates a reviewed year when a quiz launches or changes status without changing counts', async () => {
		const beforeLaunch = await action('purge');
		const runId = await run('running');
		const purgeQuizRuns = vi.fn(async () => [runId]);
		await expect(decideAnnualYear(db, ids.teacher, beforeLaunch, { purgeQuizRuns })).rejects.toMatchObject({
			status: 409
		});
		const beforeClose = await action('purge');
		await db.update(t.quizRuns).set({ status: 'closed' }).where(eq(t.quizRuns.id, runId));
		await expect(decideAnnualYear(db, ids.teacher, beforeClose, { purgeQuizRuns })).rejects.toMatchObject({
			status: 409
		});
		expect(purgeQuizRuns).not.toHaveBeenCalled();
		expect(await db.select().from(t.students).where(eq(t.students.classId, ids.currentClass))).toHaveLength(12);
	});

	it('does not broaden a year purge into another context through a malformed retake cascade', async () => {
		const first = await run('closed');
		const otherYear = await run('closed', ids.oldContext, first);
		const purgeQuizRuns = vi.fn(async () => [first]);
		await expect(decideAnnualYear(db, ids.teacher, await action('purge'), { purgeQuizRuns })).rejects.toMatchObject({
			status: 409
		});
		expect(await db.select().from(t.quizRuns).where(eq(t.quizRuns.id, otherYear))).toHaveLength(1);
		expect(await db.select().from(t.academicYears)).toHaveLength(0);
		expect(purgeQuizRuns).not.toHaveBeenCalled();
	});

	it('keeps another year runs intact and rolls back SQL cleanup when final receipt storage fails', async () => {
		const current = await run('closed');
		const otherYear = await run('running', ids.oldContext);
		const command = await action('purge');
		await client.execute(
			"CREATE TRIGGER fail_quiz_annual_receipt BEFORE INSERT ON annual_receipt BEGIN SELECT RAISE(ABORT, 'fictional rollback'); END"
		);
		const purgeQuizRuns = vi.fn(async () => [current]);
		await expect(decideAnnualYear(db, ids.teacher, command, { purgeQuizRuns })).rejects.toThrow();
		expect(purgeQuizRuns).not.toHaveBeenCalled();
		expect((await getAnnualData(db, ids.teacher, '2026-2027')).selected!.reviewToken).toBe(command.reviewToken);
		expect((await db.select().from(t.quizRuns)).map((run) => run.id).sort()).toEqual([current, otherYear].sort());
		expect(await db.select().from(t.students).where(eq(t.students.classId, ids.currentClass))).toHaveLength(12);
	});
	it('retries room cleanup when recording its completion fails after deletion', async () => {
		const current = await run('closed');
		const otherYear = await run('closed', ids.oldContext);
		const command = await action('purge');
		const remaining = new Set<string>([current, otherYear]);
		const purgeQuizRuns = vi.fn(async (runIds: readonly string[]) => {
			for (const id of runIds) remaining.delete(id);
			return runIds;
		});
		await client.execute(
			"CREATE TRIGGER fail_cleanup_ack BEFORE UPDATE ON annual_receipt BEGIN SELECT RAISE(ABORT, 'fictional acknowledgement failure'); END"
		);
		await expect(decideAnnualYear(db, ids.teacher, command, { purgeQuizRuns })).rejects.toThrow();
		expect([...remaining]).toEqual([otherYear]);
		expect((await db.select().from(t.annualReceipts))[0].pendingQuizRunIds).toEqual([current]);
		await client.execute('DROP TRIGGER fail_cleanup_ack');
		await decideAnnualYear(db, ids.teacher, command, { purgeQuizRuns });
		expect(purgeQuizRuns).toHaveBeenCalledTimes(2);
		expect(purgeQuizRuns.mock.calls.every(([runIds]) => runIds.length === 1 && runIds[0] === current)).toBe(true);
		expect((await db.select().from(t.annualReceipts))[0].pendingQuizRunIds).toEqual([]);
		expect((await db.select().from(t.quizRuns)).map((item) => item.id)).toEqual([otherYear]);
	});
	it('recovers a partial external purge after a reload without replaying annual SQL changes', async () => {
		const first = await run('closed');
		const second = await run('closed');
		const remaining = new Set<string>([first, second]);
		const command = await action('purge');
		await expect(
			decideAnnualYear(db, ids.teacher, command, {
				purgeQuizRuns: async () => {
					remaining.delete(first);
					throw new Error('Fictional transport failure');
				}
			})
		).rejects.toBeDefined();
		expect(await db.select().from(t.quizRuns)).toHaveLength(0);
		expect(await db.select().from(t.students).where(eq(t.students.classId, ids.currentClass))).toHaveLength(0);
		const [pending] = await db.select().from(t.annualReceipts);
		expect(pending.pendingQuizRunIds).toEqual([first, second].sort());
		const purgeQuizRuns = vi.fn(async (runIds: readonly string[]) => {
			for (const id of runIds) remaining.delete(id);
			return runIds;
		});
		const reloaded = await getAnnualData(db, ids.teacher, command.academicYear, { purgeQuizRuns });
		expect(reloaded.selected!.status).toBe('purged');
		expect(remaining.size).toBe(0);
		expect(purgeQuizRuns).toHaveBeenCalledExactlyOnceWith([first, second].sort());
		expect((await db.select().from(t.annualReceipts))[0].pendingQuizRunIds).toEqual([]);
		expect(await decideAnnualYear(db, ids.teacher, command)).toEqual(pending.receipt);
		await expect(decideAnnualYear(db, ids.teacher, { ...command, action: 'archive' })).rejects.toMatchObject({
			status: 409
		});
	});
});
