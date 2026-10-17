import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cp, mkdtemp, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	loadProductionMigrationPlan,
	migrationConfirmation,
	migrationMessage,
	productionMigrationFetch,
	upgradeProduction0011
} from '../../../../scripts/production-migration.js';
import { createDatabase } from '../db/index.js';
import { issueInvitation, readInvitation } from '../auth/invitations.js';

const plan = loadProductionMigrationPlan();
let client: Client;
let folder: string | undefined;
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	await migrate(createDatabase(client), { migrationsFolder: './drizzle' });
	await client.execute('DROP TRIGGER coursely_bound_unused_oauth_clients');
	await client.execute({
		sql: 'DELETE FROM __drizzle_migrations WHERE created_at = ?',
		args: [plan.entries.at(-1)!.createdAt]
	});
});
afterEach(async () => {
	client.close();
	if (folder) await rm(folder, { recursive: true, force: true });
	folder = undefined;
});
const triggerCount = async () =>
	Number(
		(
			await client.execute(
				"SELECT COUNT(*) AS n FROM sqlite_schema WHERE name = 'coursely_bound_unused_oauth_clients'"
			)
		).rows[0].n
	);
const journalCount = async () =>
	Number((await client.execute('SELECT COUNT(*) AS n FROM __drizzle_migrations')).rows[0].n);
const run = (confirm = async () => migrationConfirmation) =>
	upgradeProduction0011({ client, plan, confirm });

describe('Explicit production upgrade from 0000–0010 to 0011', () => {
	it('preserves the existing teacher, private invitation and unused OAuth clients', async () => {
		const invite = await issueInvitation(client, {
			name: 'Fictional operator',
			email: 'operator@example.test',
			role: 'teacher'
		});
		await client.execute(
			"INSERT INTO oauth_client (id, client_id, redirect_uris, token_endpoint_auth_method, created_at) VALUES ('old', 'old', '[]', 'none', 1)"
		);
		const before = await readInvitation(client, invite.token);
		expect(await run()).toBe('applied');
		expect(await readInvitation(client, invite.token)).toEqual(before);
		expect(Number((await client.execute('SELECT COUNT(*) AS n FROM user')).rows[0].n)).toBe(1);
		expect(Number((await client.execute('SELECT COUNT(*) AS n FROM oauth_client')).rows[0].n)).toBe(
			1
		);
		expect(await journalCount()).toBe(12);
		expect(await triggerCount()).toBe(1);
	});
	it('verifies an identical retry without asking for another write confirmation', async () => {
		await run();
		const confirm = vi.fn(async () => {
			throw new Error('must not request another write');
		});
		expect(await run(confirm)).toBe('already-applied');
		expect(confirm).not.toHaveBeenCalled();
		expect(await journalCount()).toBe(12);
	});
	it('refuses an inexact confirmation before any write', async () => {
		await expect(run(async () => 'yes')).rejects.toMatchObject({ code: 'cancel' });
		expect(await journalCount()).toBe(11);
		expect(await triggerCount()).toBe(0);
	});
	it('refuses an altered historical journal before asking for confirmation', async () => {
		await client.execute(
			"UPDATE __drizzle_migrations SET hash = 'wrong' WHERE created_at = (SELECT MIN(created_at) FROM __drizzle_migrations)"
		);
		const confirm = vi.fn(async () => migrationConfirmation);
		await expect(run(confirm)).rejects.toMatchObject({ code: 'journal' });
		expect(confirm).not.toHaveBeenCalled();
		expect(await triggerCount()).toBe(0);
	});
	it('revalidates the journal after confirmation and before applying DDL', async () => {
		await expect(
			run(async () => {
				await client.execute(
					"UPDATE __drizzle_migrations SET hash = 'changed' WHERE created_at = (SELECT MIN(created_at) FROM __drizzle_migrations)"
				);
				return migrationConfirmation;
			})
		).rejects.toMatchObject({ code: 'journal' });
		expect(await journalCount()).toBe(11);
		expect(await triggerCount()).toBe(0);
	});
	it('refuses a partial or unjournaled trigger installation', async () => {
		await client.execute(plan.sql);
		await expect(run()).rejects.toMatchObject({ code: 'journal' });
	});
	it('refuses a completed journal without its exact trigger', async () => {
		const last = plan.entries.at(-1)!;
		await client.execute({
			sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
			args: [last.hash, last.createdAt]
		});
		await expect(run()).rejects.toMatchObject({ code: 'journal' });
	});
	it('rolls back the trigger when journal insertion fails and masks SDK error details', async () => {
		await client.execute(
			"CREATE TRIGGER fictional_fail_journal BEFORE INSERT ON __drizzle_migrations BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_SECRET_MARKER'); END"
		);
		const error = await run().catch((error: unknown) => error);
		expect(migrationMessage(error)).not.toContain('SYNTHETIC_SECRET_MARKER');
		expect(error).toMatchObject({ code: 'remote' });
		expect(await journalCount()).toBe(11);
		expect(await triggerCount()).toBe(0);
	});
	it('rejects a changed local migration instead of applying it', async () => {
		folder = await mkdtemp(join(tmpdir(), 'coursely-migration-test-'));
		await cp('drizzle', folder, { recursive: true });
		await appendFile(join(folder, plan.entries.at(-1)!.tag + '.sql'), '\n-- fictional edit\n');
		expect(() => loadProductionMigrationPlan(folder)).toThrow('lot 0000–0011');
	});
	it('keeps HTTP requests on the fixed HTTPS target and refuses redirects', async () => {
		const request = vi.fn<typeof fetch>(async () => new Response('{}'));
		const guarded = productionMigrationFetch(request);
		await expect(guarded('https://example.test/v2/pipeline')).rejects.toThrow();
		expect(request).not.toHaveBeenCalled();
		await guarded('https://coursely-prod-nekxio.aws-eu-west-1.turso.io/v2/pipeline');
		expect(request).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ redirect: 'error', credentials: 'omit' })
		);
	});
});
