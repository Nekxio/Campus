import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDatabase } from '../db/index.js';
import { cleanupUnusedOAuthClients, unusedClientLimit, unusedClientRetentionMs } from './registration.js';

let client: Client;
const now = Date.now();
const old = now - unusedClientRetentionMs - 1000;
async function insert(id: string, createdAt: number | null = now) {
	await client.execute({
		sql: `INSERT INTO oauth_client
		(id, client_id, redirect_uris, token_endpoint_auth_method, created_at)
		VALUES (?, ?, '[]', 'none', ?)`,
		args: [id, id, createdAt]
	});
}
async function ids() {
	return (await client.execute('SELECT id FROM oauth_client ORDER BY id')).rows.map((r) => r.id);
}
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	await migrate(createDatabase(client), { migrationsFolder: './drizzle' });
	await client.execute("INSERT INTO user (id, name, email) VALUES ('teacher', 'Fictif', 'fictif@example.test')");
});
afterEach(() => client.close());

describe('Anonymous OAuth registration retention and atomic cap', () => {
	it('rejects concurrent inserts past the global cap without evicting fresh pending logins', async () => {
		for (let i = 0; i < unusedClientLimit - 1; i++) await insert('pending-' + i);
		const results = await Promise.allSettled([insert('concurrent-a'), insert('concurrent-b')]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
		await cleanupUnusedOAuthClients(client, now);
		expect(await ids()).toHaveLength(unusedClientLimit);
		await expect(insert('overflow')).rejects.toThrow('coursely_unused_oauth_client_limit');
	});

	it('reclaims only expired unused clients; protects every ownership and authorization representation', async () => {
		for (const id of [
			'unused',
			'recent',
			'boundary',
			'unknown',
			'owner',
			'reference',
			'discovery',
			'managed',
			'secret',
			'confidential',
			'consent',
			'access',
			'refresh'
		])
			await insert(
				id,
				id === 'recent' ? now : id === 'boundary' ? now - unusedClientRetentionMs : id === 'unknown' ? null : old
			);
		for (const [id, column, value] of [
			['owner', 'user_id', 'teacher'],
			['reference', 'reference_id', 'fictional'],
			['discovery', 'client_discovery_id', 'fictional'],
			['managed', 'skip_consent', 1],
			['secret', 'client_secret', 'fictional'],
			['confidential', 'token_endpoint_auth_method', 'client_secret_basic']
		] as const)
			await client.execute({
				sql: `UPDATE oauth_client SET ${column} = ? WHERE id = ?`,
				args: [value, id]
			});
		await client.execute(`INSERT INTO oauth_consent (id, client_id, user_id, scopes, created_at, updated_at)
		 VALUES ('consent', 'consent', 'teacher', '[]', 1, 1)`);
		// Expired and revoked tokens still protect their clients; this also protects active tokens.
		await client.execute(`INSERT INTO oauth_access_token (id, token, client_id, scopes, created_at, expires_at, revoked)
		 VALUES ('access', 'fictional-access', 'access', '[]', 1, 2, 3)`);
		await client.execute(`INSERT INTO oauth_refresh_token (id, token, client_id, user_id, scopes, created_at, expires_at, revoked)
		 VALUES ('refresh', 'fictional-refresh', 'refresh', 'teacher', '[]', 1, 2, 3)`);
		await cleanupUnusedOAuthClients(client, now);
		expect(await ids()).toEqual([
			'access',
			'boundary',
			'confidential',
			'consent',
			'discovery',
			'managed',
			'owner',
			'recent',
			'reference',
			'refresh',
			'secret',
			'unknown'
		]);
	});

	it('drains a pre-migration backlog in committed batches, even while capacity remains exceeded', async () => {
		await client.execute('DROP TRIGGER coursely_bound_unused_oauth_clients');
		for (let i = 0; i < 250; i++) await insert('legacy-' + i, old);
		const { readFile } = await import('node:fs/promises');
		await client.execute(await readFile('drizzle/0011_bound_unused_oauth_clients.sql', 'utf8'));
		await cleanupUnusedOAuthClients(client, now);
		expect(await ids()).toHaveLength(150);
		await expect(insert('full')).rejects.toThrow('coursely_unused_oauth_client_limit');
		expect(await ids()).toHaveLength(150);
		await cleanupUnusedOAuthClients(client, now);
		await insert('available');
		expect(await ids()).toHaveLength(51);
	});
});
