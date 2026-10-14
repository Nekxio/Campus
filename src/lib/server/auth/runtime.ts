import { ORIGIN, BETTER_AUTH_SECRET, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } from '$app/env/private';
import { error, isHttpError } from '@sveltejs/kit';
import { createAuth, type Auth } from '../auth.js';
import { authOrigin } from './config.js';
import { createTursoClient, validateTursoSettings } from '../db/index.js';
import type { Client } from '@libsql/client/web';

export async function withAuth<T>(
	operation: (auth: Auth, client: Client, origin: string) => Promise<T>
): Promise<T> {
	let client: Client;
	let auth: Auth;
	let origin: string;
	try {
		const settings = { ORIGIN, BETTER_AUTH_SECRET };
		origin = authOrigin(settings);
		client = createTursoClient(TURSO_DATABASE_URL, TURSO_AUTH_TOKEN);
		auth = createAuth(settings, client);
	} catch {
		error(503, 'La connexion privée doit être configurée.');
	}
	try {
		return await operation(auth, client, origin);
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		error(503, 'La connexion privée est temporairement indisponible.');
	} finally {
		client.close();
	}
}

export function authConfigurationReady() {
	try {
		authOrigin({ ORIGIN, BETTER_AUTH_SECRET });
		validateTursoSettings(TURSO_DATABASE_URL, TURSO_AUTH_TOKEN);
		return true;
	} catch {
		return false;
	}
}
