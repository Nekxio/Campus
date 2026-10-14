import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client, type InStatement } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDatabase } from '../db/index.js';
import { consumeRateLimit, rateLimitRetentionMs } from './rate-limit.js';

let client: Client;
const now = Date.parse('2026-10-13T12:00:00Z');
const rule = { window: 60, max: 3 };
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	await migrate(createDatabase(client), { migrationsFolder: './drizzle' });
});
afterEach(() => {
	vi.restoreAllMocks();
	client.close();
});
async function buckets() {
	return (await client.execute('SELECT key, count, started_at FROM auth_rate_limit ORDER BY key'))
		.rows;
}
async function seedExpired(count: number) {
	await client.batch(
		Array.from({ length: count }, (_, index) => ({
			sql: 'INSERT INTO auth_rate_limit (key, count, started_at) VALUES (?, 1, ?)',
			args: [`synthetic-expired-${String(index).padStart(3, '0')}`, now - rateLimitRetentionMs - 1]
		})),
		'write'
	);
}

describe('Bounded authentication quota retention', () => {
	it('deletes expired buckets through ordinary consumption', async () => {
		await consumeRateLimit(client, 'fictional-old-client', rule, now - rateLimitRetentionMs - 1);
		await consumeRateLimit(client, 'fictional-current-client', rule, now);
		expect(await buckets()).toHaveLength(1);
		expect((await buckets())[0]).toMatchObject({ count: 1, started_at: now });
	});
	it('preserves active quota and its retry interval during cleanup', async () => {
		await seedExpired(3);
		for (let index = 0; index < 3; index++)
			await consumeRateLimit(client, 'fictional-active-client', rule, now);
		expect(await consumeRateLimit(client, 'fictional-active-client', rule, now + 1000)).toEqual({
			allowed: false,
			retryAfter: 59
		});
		expect(await buckets()).toHaveLength(1);
		expect((await buckets())[0]).toMatchObject({ count: 4, started_at: now });
	});
	it('keeps the exact retention cutoff until it becomes strictly older', async () => {
		await consumeRateLimit(client, 'fictional-cutoff-client', rule, now - rateLimitRetentionMs);
		await consumeRateLimit(client, 'fictional-current-client', rule, now);
		expect(await buckets()).toHaveLength(2);
		await consumeRateLimit(client, 'fictional-current-client', rule, now + 1);
		expect(await buckets()).toHaveLength(1);
	});
	it('deletes at most 100 keys per call with deterministic oldest-first order', async () => {
		await seedExpired(125);
		await client.execute({
			sql: 'INSERT INTO auth_rate_limit (key, count, started_at) VALUES (?, 1, ?)',
			args: ['synthetic-older', now - rateLimitRetentionMs - 2]
		});
		await consumeRateLimit(client, 'fictional-current-client', rule, now);
		const expired = (await buckets()).filter((bucket) => Number(bucket.started_at) < now);
		expect(expired.map((bucket) => bucket.key)).toEqual(
			Array.from(
				{ length: 26 },
				(_, index) => `synthetic-expired-${String(index + 99).padStart(3, '0')}`
			)
		);
	});
	it('eventually drains historical buckets over repeated calls without reopening active quota', async () => {
		await seedExpired(250);
		for (const remaining of [151, 51, 1]) {
			expect((await consumeRateLimit(client, 'fictional-active-client', rule, now)).allowed).toBe(
				true
			);
			expect(await buckets()).toHaveLength(remaining);
		}
		expect((await consumeRateLimit(client, 'fictional-active-client', rule, now)).allowed).toBe(
			false
		);
		expect(await buckets()).toHaveLength(1);
	});
	it.each([3600, 3601, Number.NaN, Number.POSITIVE_INFINITY, 0, -1])(
		'refuses an unsafe window %s before storing or pruning any bucket',
		async (window) => {
			await seedExpired(1);
			const execute = vi.spyOn(client, 'execute');
			await expect(
				consumeRateLimit(client, 'fictional-long-window', { window, max: 3 }, now)
			).rejects.toThrow(RangeError);
			expect(execute).not.toHaveBeenCalled();
			expect(await buckets()).toHaveLength(1);
		}
	);
	it('never changes rejected or allowed quotas when cleanup fails', async () => {
		const execute = client.execute.bind(client);
		vi.spyOn(client, 'execute').mockImplementation(async (statement: InStatement) => {
			const sql = typeof statement === 'string' ? statement : statement.sql;
			if (sql.startsWith('DELETE FROM auth_rate_limit'))
				throw new Error('Synthetic cleanup failure');
			return execute(statement);
		});
		expect(await consumeRateLimit(client, 'fictional-client', { window: 60, max: 1 }, now)).toEqual(
			{
				allowed: true,
				retryAfter: 60
			}
		);
		expect(await consumeRateLimit(client, 'fictional-client', { window: 60, max: 1 }, now)).toEqual(
			{
				allowed: false,
				retryAfter: 60
			}
		);
		expect((await buckets())[0].count).toBe(2);
	});
	it('uses the covering expiry index without scanning all buckets or sorting', async () => {
		const result = await client.execute({
			sql: `EXPLAIN QUERY PLAN DELETE FROM auth_rate_limit WHERE key IN (
				SELECT key FROM auth_rate_limit WHERE started_at < ?
				ORDER BY started_at, key LIMIT ?
			)`,
			args: [now - rateLimitRetentionMs, 100]
		});
		const details = result.rows.map((row) => String(row.detail)).join('\n');
		expect(details).toContain('USING COVERING INDEX auth_rate_limit_started_at_key');
		expect(details).not.toMatch(/SCAN auth_rate_limit|TEMP B-TREE/);
	});
});
