import { TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } from '$app/env/private';
import type { Client } from '@libsql/client/web';
import { error, isHttpError } from '@sveltejs/kit';
import { createDatabase, createTursoClient, type Database } from '../db/index.js';
import { measureServerTiming, type ServerTiming } from '../server-timing.js';
import { instrumentDatabaseClient } from '../db/timing.js';

// Drizzle's libSQL adapter ignores transaction configuration and defaults to write mode.
const withReadTransactions = (client: Client): Client =>
	new Proxy(client, {
		get: (target, key) => {
			if (key === 'transaction') return () => target.transaction('read');
			const member = Reflect.get(target, key, target);
			return typeof member === 'function' ? member.bind(target) : member;
		}
	});

// This reader needs no teacher session or Better Auth configuration.
export const withPublicDatabase = <T>(
	operation: (db: Pick<Database, 'select' | 'transaction'>) => Promise<T>,
	timing?: ServerTiming
): Promise<T> =>
	measureServerTiming(timing, 'data', async () => {
		let client: ReturnType<typeof createTursoClient>;
		try {
			client = createTursoClient(TURSO_DATABASE_URL, TURSO_AUTH_TOKEN);
		} catch {
			error(503, 'Les pages de cours sont temporairement indisponibles.');
		}
		try {
			return await operation(createDatabase(withReadTransactions(instrumentDatabaseClient(client, timing))));
		} catch (cause) {
			if (isHttpError(cause)) throw cause;
			error(503, 'Les pages de cours sont temporairement indisponibles.');
		} finally {
			client.close();
		}
	});
