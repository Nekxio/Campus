import { createClient, type Client, type Value } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { productionDatabaseSecrets, validateRelease, type ProductionEnvironment } from './production.js';

const backupHeader = Buffer.from('CAMPUS-BACKUP-1\n');
const keyBytes = (key: string) => {
	if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('CAMPUS_PRODUCTION_BACKUP_KEY must contain 32 hex-encoded bytes.');
	return Buffer.from(key, 'hex');
};

export const productionMigrationSettings = (settings: ProductionEnvironment) => {
	const secrets = productionDatabaseSecrets(settings);
	if (
		!settings.CAMPUS_PRODUCTION_DATABASE_URL ||
		secrets.TURSO_DATABASE_URL !== settings.CAMPUS_PRODUCTION_DATABASE_URL
	) {
		throw new Error('Production database does not match CAMPUS_PRODUCTION_DATABASE_URL.');
	}
	const key = settings.CAMPUS_PRODUCTION_BACKUP_KEY ?? '';
	keyBytes(key);
	return { url: secrets.TURSO_DATABASE_URL, authToken: secrets.TURSO_AUTH_TOKEN, key };
};

export const assertMigrationPrefix = (
	rows: ReadonlyArray<Readonly<Record<string, unknown>>>,
	expected: MigrationMeta[]
) => {
	if (
		!expected.length ||
		expected.some(
			(entry, index) =>
				!Number.isSafeInteger(entry.folderMillis) ||
				entry.folderMillis < 1 ||
				(index > 0 && entry.folderMillis <= expected[index - 1].folderMillis)
		)
	) {
		throw new Error('Invalid local migration order.');
	}
	if (
		rows.length > expected.length ||
		rows.some(
			(row, index) =>
				row.hash !== expected[index].hash || String(row.created_at) !== String(expected[index].folderMillis)
		)
	) {
		throw new Error('Production migration journal differs from the exact expected prefix.');
	}
	return rows.length;
};

const readJournal = async (client: Pick<Client, 'execute'>, expected: MigrationMeta[]) => {
	const result = await client.execute({
		sql: 'SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at, id LIMIT ?',
		args: [expected.length + 1]
	});
	return assertMigrationPrefix(result.rows, expected);
};

export const encryptBackup = (sql: string, key: string) => {
	const nonce = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', keyBytes(key), nonce);
	cipher.setAAD(backupHeader);
	const encrypted = Buffer.concat([cipher.update(sql, 'utf8'), cipher.final()]);
	return Buffer.concat([backupHeader, nonce, cipher.getAuthTag(), encrypted]);
};

export const decryptBackup = (backup: Buffer, key: string) => {
	if (!backup.subarray(0, backupHeader.length).equals(backupHeader)) throw new Error('Invalid backup format.');
	const offset = backupHeader.length;
	const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), backup.subarray(offset, offset + 12));
	decipher.setAAD(backupHeader);
	decipher.setAuthTag(backup.subarray(offset + 12, offset + 28));
	return Buffer.concat([decipher.update(backup.subarray(offset + 28)), decipher.final()]).toString('utf8');
};

const identifier = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const sqlValue = (value: Value) => {
	if (value === null) return 'NULL';
	if (typeof value === 'string') return `CAST(X'${Buffer.from(value, 'utf8').toString('hex')}' AS TEXT)`;
	if (value instanceof ArrayBuffer) return `X'${Buffer.from(value).toString('hex')}'`;
	if (typeof value === 'bigint' || (typeof value === 'number' && Number.isFinite(value))) return String(value);
	throw new Error('Unsupported backup value.');
};

// Encode text in SQLite before transport: some client paths truncate strings containing NUL.
export const createBackupSql = async (client: Client, expected?: MigrationMeta[], applied?: number) => {
	const transaction = await client.transaction('read');
	try {
		if (expected && (await readJournal(transaction, expected)) !== applied)
			throw new Error('Migration journal changed before backup.');
		const schema = await transaction.execute(
			"SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND substr(name,1,7) <> 'sqlite_' ORDER BY type,name"
		);
		const tables = schema.rows.filter((row) => row.type === 'table');
		if (tables.some((row) => /^CREATE\s+VIRTUAL\s+TABLE/i.test(String(row.sql))))
			throw new Error('Virtual tables require a dedicated backup procedure.');
		const columns = await transaction.batch(tables.map((row) => `PRAGMA table_xinfo(${identifier(String(row.name))})`));
		const writable = columns.map((result) =>
			result.rows.filter((row) => Number(row.hidden) === 0).map((row) => String(row.name))
		);
		const records = await transaction.batch(
			tables.map(
				(row, index) =>
					`SELECT ${writable[index]
						.map((name) => {
							const column = identifier(name);
							return `CASE typeof(${column}) WHEN 'text' THEN 'CAST(X''' || hex(CAST(${column} AS BLOB)) || ''' AS TEXT)' WHEN 'blob' THEN 'X''' || hex(${column}) || '''' ELSE quote(${column}) END`;
						})
						.join(',')} FROM ${identifier(String(row.name))}`
			)
		);
		const sequence = await transaction.execute("SELECT name FROM sqlite_schema WHERE name = 'sqlite_sequence'");
		const sequenceRows = sequence.rows.length
			? (await transaction.execute('SELECT name,seq FROM sqlite_sequence')).rows
			: [];
		const statements = [
			'PRAGMA foreign_keys=OFF;',
			'BEGIN TRANSACTION;',
			...tables.map((row) => String(row.sql) + ';')
		];
		for (const [index, table] of tables.entries()) {
			for (const row of records[index].rows) {
				statements.push(
					`INSERT INTO ${identifier(String(table.name))} (${writable[index].map(identifier).join(',')}) VALUES (${Array.from(row).join(',')});`
				);
			}
		}
		if (sequence.rows.length) {
			statements.push('DELETE FROM sqlite_sequence;');
			for (const row of sequenceRows)
				statements.push(`INSERT INTO sqlite_sequence(name,seq) VALUES (${sqlValue(row.name)},${sqlValue(row.seq)});`);
		}
		statements.push(
			...schema.rows.filter((row) => row.type !== 'table').map((row) => String(row.sql) + ';'),
			'COMMIT;'
		);
		await transaction.commit();
		return statements.join('\n') + '\n';
	} finally {
		transaction.close();
	}
};

export const verifyBackupSql = async (sql: string, expected: MigrationMeta[], applied: number) => {
	const restored = createClient({ url: ':memory:', intMode: 'bigint' });
	try {
		await restored.executeMultiple(sql);
		if ((await readJournal(restored, expected)) !== applied) throw new Error('Backup journal verification failed.');
		if (
			(await restored.execute('PRAGMA integrity_check')).rows[0]?.[0] !== 'ok' ||
			(await restored.execute('PRAGMA foreign_key_check')).rows.length
		)
			throw new Error('Backup integrity verification failed.');
	} finally {
		restored.close();
	}
};

export const applyPreparedMigrations = async (
	client: Client,
	expected: MigrationMeta[],
	folder: string,
	applied: number,
	requireBackup: () => Promise<void>
) => {
	if ((await readJournal(client, expected)) !== applied)
		throw new Error('Migration journal changed after preparation.');
	if (applied < expected.length) {
		await requireBackup();
		await migrate(drizzle(client), { migrationsFolder: folder });
	}
	if ((await readJournal(client, expected)) !== expected.length)
		throw new Error('Production migration journal is incomplete.');
	if ((await client.execute('PRAGMA foreign_key_check')).rows.length)
		throw new Error('Production foreign key validation failed.');
};

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

const main = async () => {
	const command = process.argv[2];
	if (command === 'decrypt-backup') {
		const { CAMPUS_BACKUP_INPUT: input, CAMPUS_BACKUP_OUTPUT: output, CAMPUS_PRODUCTION_BACKUP_KEY: key } = process.env;
		if (!input || !output || !key) throw new Error('Backup input, new output path and recovery key are required.');
		await writeFile(output, decryptBackup(await readFile(input), key), { flag: 'wx', mode: 0o600 });
		console.log('Backup decrypted to the selected private SQL file. Restore only into a new isolated database.');
		return;
	}
	const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	validateRelease(process.env, sha);
	const settings = productionMigrationSettings(process.env);
	if (!process.env.RUNNER_TEMP || !process.env.GITHUB_OUTPUT) throw new Error('GitHub runner context required.');
	if (command !== 'prepare' && command !== 'apply')
		throw new Error('Usage: production-migrations.ts <prepare|apply|decrypt-backup>');
	const folder = resolve('drizzle');
	const expected = readMigrationFiles({ migrationsFolder: folder });
	const signature = sha256(JSON.stringify(expected));
	const backupPath = resolve(process.env.RUNNER_TEMP, 'campus-production-backup.enc');
	const planPath = resolve(process.env.RUNNER_TEMP, 'campus-production-migrations.json');
	const client = createClient({ url: settings.url, authToken: settings.authToken, intMode: 'bigint' });
	try {
		if (command === 'prepare') {
			const applied = await readJournal(client, expected);
			let backupHash: string | null = null;
			if (applied < expected.length) {
				const sql = await createBackupSql(client, expected, applied);
				await verifyBackupSql(sql, expected, applied);
				const backup = encryptBackup(sql, settings.key);
				if (decryptBackup(backup, settings.key) !== sql) throw new Error('Backup encryption verification failed.');
				await writeFile(backupPath, backup, { flag: 'wx', mode: 0o600 });
				backupHash = sha256(await readFile(backupPath));
			}
			await writeFile(planPath, JSON.stringify({ sha, signature, applied, backupHash }), { flag: 'wx', mode: 0o600 });
			await appendFile(process.env.GITHUB_OUTPUT, `pending=${applied < expected.length}\n`);
			console.log(
				`Production journal verified: ${applied}/${expected.length}; encrypted backup ${backupHash ? 'prepared' : 'not needed'}.`
			);
		} else {
			const plan = JSON.parse(await readFile(planPath, 'utf8'));
			if (
				plan.sha !== sha ||
				plan.signature !== signature ||
				!Number.isInteger(plan.applied) ||
				plan.applied < 0 ||
				plan.applied > expected.length
			)
				throw new Error('Invalid migration preparation.');
			await applyPreparedMigrations(client, expected, folder, plan.applied, async () => {
				if (!process.env.CAMPUS_BACKUP_ARTIFACT_ID?.match(/^\d+$/))
					throw new Error('Durable backup upload must succeed before migration.');
				if (!plan.backupHash || sha256(await readFile(backupPath)) !== plan.backupHash)
					throw new Error('Prepared encrypted backup is missing or changed.');
			});
			console.log(`Production migrations verified: ${expected.length}/${expected.length}; foreign keys valid.`);
		}
	} finally {
		client.close();
	}
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch(() => {
		// Driver errors can contain SQL or credentials; keep private data out of Actions logs.
		console.error(
			'Production database operation failed. Deployment blocked; inspect configuration, journal and encrypted backup through the operator procedure.'
		);
		process.exitCode = 1;
	});
}
