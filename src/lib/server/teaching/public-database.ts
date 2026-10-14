import { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } from '$app/env/private';
import { error, isHttpError } from '@sveltejs/kit';
import { createDatabase, createTursoClient, type Database } from '../db/index.js';

// This reader needs no teacher session or Better Auth configuration.
export async function withPublicDatabase<T>(
	operation: (db: Pick<Database, 'select' | 'transaction'>) => Promise<T>
): Promise<T> {
	let client: ReturnType<typeof createTursoClient>;
	try {
		client = createTursoClient(TURSO_DATABASE_URL, TURSO_AUTH_TOKEN);
	} catch {
		error(503, 'Les pages de cours sont temporairement indisponibles.');
	}
	try {
		return await operation(createDatabase(client));
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		error(503, 'Les pages de cours sont temporairement indisponibles.');
	} finally {
		client.close();
	}
}
