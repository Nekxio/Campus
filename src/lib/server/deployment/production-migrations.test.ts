import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
	assertMigrationPrefix,
	productionMigrationSettings,
	encryptBackup,
	decryptBackup,
	createBackupSql,
	applyPreparedMigrations,
	verifyBackupSql
} from '../../../../scripts/production-migrations.js';

const settings = {
	TURSO_DATABASE_URL: 'libsql://production-fixture.turso.io',
	CAMPUS_PRODUCTION_DATABASE_URL: 'libsql://production-fixture.turso.io',
	TURSO_AUTH_TOKEN: 'fictional-token',
	CAMPUS_PRODUCTION_BACKUP_KEY: 'ab'.repeat(32)
};
const migrations = [
	{ hash: 'a'.repeat(64), folderMillis: 1, sql: [], bps: true },
	{ hash: 'b'.repeat(64), folderMillis: 2, sql: [], bps: true }
];

describe('production migration safety', () => {
	it('accepts only an exact applied prefix, including an already current database', () => {
		expect(assertMigrationPrefix([{ hash: migrations[0].hash, created_at: 1 }], migrations)).toBe(1);
		expect(
			assertMigrationPrefix(
				migrations.map((m) => ({ hash: m.hash, created_at: m.folderMillis })),
				migrations
			)
		).toBe(2);
	});
	it.each(
		[
			[{ hash: 'wrong', created_at: 1 }],
			[{ hash: migrations[1].hash, created_at: 2 }],
			[{ hash: migrations[0].hash, created_at: 2 }],
			[
				{ hash: migrations[0].hash, created_at: 1 },
				{ hash: migrations[0].hash, created_at: 1 }
			],
			[...migrations.map((m) => ({ hash: m.hash, created_at: m.folderMillis })), { hash: 'extra', created_at: 3 }]
		].map((rows) => ({ rows }))
	)('blocks divergent, reordered, duplicate or extra history', ({ rows }) => {
		expect(() => assertMigrationPrefix(rows, migrations)).toThrow('journal');
	});
	it('rejects an invalid local migration order', () => {
		expect(() => assertMigrationPrefix([], [...migrations].reverse())).toThrow('order');
	});
	it('requires an independently configured production target and valid encryption key', () => {
		expect(productionMigrationSettings(settings).url).toBe(settings.TURSO_DATABASE_URL);
		for (const override of [
			{ CAMPUS_PRODUCTION_DATABASE_URL: undefined },
			{ TURSO_DATABASE_URL: 'libsql://other.turso.io' },
			{ TURSO_DATABASE_URL: 'file:local.db', CAMPUS_PRODUCTION_DATABASE_URL: 'file:local.db' },
			{ TURSO_AUTH_TOKEN: '' },
			{ CAMPUS_PRODUCTION_BACKUP_KEY: 'invalid' }
		])
			expect(() => productionMigrationSettings({ ...settings, ...override })).toThrow();
	});
	it('encrypts backups and rejects tampering or a different recovery key', () => {
		const backup = encryptBackup('private fictional backup', settings.CAMPUS_PRODUCTION_BACKUP_KEY);
		expect(backup.includes(Buffer.from('private fictional backup'))).toBe(false);
		expect(decryptBackup(backup, settings.CAMPUS_PRODUCTION_BACKUP_KEY)).toBe('private fictional backup');
		expect(() => decryptBackup(backup, 'cd'.repeat(32))).toThrow();
		const damaged = Buffer.from(backup);
		damaged[damaged.length - 1] ^= 1;
		expect(() => decryptBackup(damaged, settings.CAMPUS_PRODUCTION_BACKUP_KEY)).toThrow();
	});
	it('produces a restorable snapshot with blobs, large integers, generated columns, triggers and sequence state', async () => {
		const source = createClient({ url: ':memory:', intMode: 'bigint' });
		const restored = createClient({ url: ':memory:', intMode: 'bigint' });
		try {
			await source.executeMultiple(
				`CREATE TABLE sample (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT, data BLOB, large INTEGER, derived TEXT GENERATED ALWAYS AS (value || '!') STORED); CREATE TABLE audit (value TEXT); CREATE TRIGGER sample_audit AFTER INSERT ON sample BEGIN INSERT INTO audit VALUES (new.value); END;`
			);
			await source.execute({
				sql: 'INSERT INTO sample (id,value,data,large) VALUES (?,?,?,?)',
				args: [9, "élève\u0000's", new Uint8Array([0, 255]), 9007199254740993n]
			});
			await source.execute('DELETE FROM sample WHERE id = 9');
			await source.execute({
				sql: 'INSERT INTO sample (id,value,data,large) VALUES (?,?,?,?)',
				args: [1, "élève\u0000's", new Uint8Array([0, 255]), 9007199254740993n]
			});
			const sql = await createBackupSql(source);
			await restored.executeMultiple(
				decryptBackup(encryptBackup(sql, settings.CAMPUS_PRODUCTION_BACKUP_KEY), settings.CAMPUS_PRODUCTION_BACKUP_KEY)
			);
			expect((await restored.execute('SELECT * FROM sample')).rows).toEqual(
				(await source.execute('SELECT * FROM sample')).rows
			);
			expect((await restored.execute('SELECT * FROM audit')).rows).toEqual(
				(await source.execute('SELECT * FROM audit')).rows
			);
			expect((await restored.execute('PRAGMA integrity_check')).rows[0][0]).toBe('ok');
			await restored.execute("INSERT INTO sample(value) VALUES ('new')");
			expect((await restored.execute("SELECT id FROM sample WHERE value='new'")).rows[0][0]).toBe(10n);
		} finally {
			source.close();
			restored.close();
		}
	});
	it('applies only pending migrations after a durable backup, preserves rows and supports retries', async () => {
		const folder = await mkdtemp(join(tmpdir(), 'campus-ci-migrations-'));
		const client = createClient({ url: ':memory:' });
		try {
			await mkdir(join(folder, 'meta'));
			await writeFile(join(folder, '0000.sql'), 'CREATE TABLE demo (id INTEGER PRIMARY KEY, value TEXT);');
			await writeFile(
				join(folder, 'meta/_journal.json'),
				JSON.stringify({ entries: [{ tag: '0000', when: 1, breakpoints: true }] })
			);
			await migrate(drizzle(client), { migrationsFolder: folder });
			await client.execute("INSERT INTO demo VALUES (1, 'retained')");
			await writeFile(join(folder, '0001.sql'), 'ALTER TABLE demo ADD archived INTEGER DEFAULT false NOT NULL;');
			await writeFile(
				join(folder, 'meta/_journal.json'),
				JSON.stringify({
					entries: [
						{ tag: '0000', when: 1, breakpoints: true },
						{ tag: '0001', when: 2, breakpoints: true }
					]
				})
			);
			const expected = readMigrationFiles({ migrationsFolder: folder });
			const backup = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('upload failed'));
			await expect(applyPreparedMigrations(client, expected, folder, 1, backup)).rejects.toThrow('upload failed');
			expect((await client.execute('SELECT * FROM demo')).columns).not.toContain('archived');
			backup.mockResolvedValue();
			await applyPreparedMigrations(client, expected, folder, 1, backup);
			expect((await client.execute('SELECT value,archived FROM demo')).rows[0]).toMatchObject({
				value: 'retained',
				archived: 0
			});
			await applyPreparedMigrations(client, expected, folder, 2, backup);
			expect(backup).toHaveBeenCalledTimes(2);
		} finally {
			client.close();
			await rm(folder, { recursive: true, force: true });
		}
	});
	it('restores the complete repository schema and its exact migration journal', async () => {
		const client = createClient({ url: ':memory:', intMode: 'bigint' });
		try {
			await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
			const expected = readMigrationFiles({ migrationsFolder: 'drizzle' });
			const sql = await createBackupSql(client, expected, expected.length);
			await expect(verifyBackupSql(sql, expected, expected.length)).resolves.toBeUndefined();
		} finally {
			client.close();
		}
	});
	it('places backup persistence and migration before deployment, only for the current production commit', async () => {
		const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
		const job = workflow.split('\n  deploy:\n')[1].split('\n  deploy-preview:\n')[0];
		expect(job.indexOf('production-migrations.ts prepare')).toBeGreaterThan(job.indexOf('check-current-main'));
		expect(job.indexOf('production-migrations.ts apply')).toBeGreaterThan(job.indexOf('actions/upload-artifact@'));
		expect(job.indexOf('wrangler deploy')).toBeGreaterThan(job.indexOf('production-migrations.ts apply'));
		expect(job).toContain('if-no-files-found: error');
		expect(job).toContain("if: steps.current.outputs.current == 'true'");
	});
});
