import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDatabase } from '../src/lib/server/db/index.js';
import { operatorClient } from './operator-client.js';

// Explicit operator action. Never called by install, build, preview, tests or CI.
const client = operatorClient();
try {
	await migrate(createDatabase(client), { migrationsFolder: './drizzle' });
	console.log('Versioned Coursely migrations applied.');
} finally {
	client.close();
}
