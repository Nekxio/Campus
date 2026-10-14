import { createClient } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createDatabase } from '../src/lib/server/db/index.js';
import { seedPublicationFixtures } from '../src/lib/server/db/testing/publication-fixtures.js';

// No env file is loaded. Only a new local .db file is accepted; existing files are preserved.
const path = resolve(process.argv[2] ?? 'data/foundation-demo.db');
if (!path.endsWith('.db')) throw new Error('Use a new local .db path.');
await mkdir(dirname(path), { recursive: true });
await writeFile(path, '', { flag: 'wx', mode: 0o600 });
const client = createClient({ url: 'file:' + path });
try {
	const db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	await seedPublicationFixtures(db);
	console.log(
		'Fictional foundation data saved to ' + path + '. This command does not connect to Turso.'
	);
} finally {
	client.close();
}
