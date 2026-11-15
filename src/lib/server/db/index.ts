import { createClient, type Client } from '@libsql/client/web';
import { drizzle } from 'drizzle-orm/libsql/web';
import * as schema from './schema.js';

export function createDatabase(client: Client) {
	return drizzle(client, { schema });
}

export function validateTursoSettings(url: string, authToken: string) {
	const parsed = new URL(url);
	if (
		!['libsql:', 'https:'].includes(parsed.protocol) ||
		!parsed.hostname ||
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash ||
		(parsed.pathname !== '/' && parsed.pathname !== '') ||
		!authToken
	) {
		throw new Error('Configurer TURSO_DATABASE_URL et TURSO_AUTH_TOKEN.');
	}
}

export function createTursoClient(url: string, authToken: string) {
	validateTursoSettings(url, authToken);
	return createClient({ url, authToken });
}

export type Database = ReturnType<typeof createDatabase>;
