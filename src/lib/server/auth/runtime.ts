import { ORIGIN, BETTER_AUTH_SECRET, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN } from '$app/env/private';
import { error, isHttpError } from '@sveltejs/kit';
import { createAuth, type Auth } from '../auth.js';
import { authOrigin } from './config.js';
import { createTursoClient, validateTursoSettings } from '../db/index.js';
import type { Client } from '@libsql/client/web';
import { privateFailureReason } from './failure-reason.js';

const reportPrivateFailure = (phase: 'configuration' | 'auth-initialization' | 'operation', cause: unknown) => {
	console.error(
		JSON.stringify({
			event: 'campus.private.unavailable',
			phase,
			reason: privateFailureReason(cause)
		})
	);
};

export const withPrivateClient = async <T>(operation: (client: Client, origin: string) => Promise<T>): Promise<T> => {
	let client: Client | undefined;
	let origin: string;
	try {
		const settings = { ORIGIN, BETTER_AUTH_SECRET };
		origin = authOrigin(settings);
		client = createTursoClient(TURSO_DATABASE_URL, TURSO_AUTH_TOKEN);
	} catch (cause) {
		client?.close();
		reportPrivateFailure('configuration', cause);
		error(503, 'La connexion privée doit être configurée.');
	}
	try {
		return await operation(client, origin);
	} catch (cause) {
		if (isHttpError(cause)) throw cause;
		reportPrivateFailure('operation', cause);
		if (privateFailureReason(cause) === 'QUIZ_SCHEMA_MISSING')
			error(503, 'L’espace quiz nécessite une mise à jour de la base de données.');
		error(503, 'La connexion privée est temporairement indisponible.');
	} finally {
		client.close();
	}
};

export const withAuth = <T>(operation: (auth: Auth, client: Client, origin: string) => Promise<T>): Promise<T> =>
	withPrivateClient(async (client, origin) => {
		let auth: Auth;
		try {
			auth = await createAuth({ ORIGIN, BETTER_AUTH_SECRET }, client);
		} catch (cause) {
			reportPrivateFailure('auth-initialization', cause);
			error(503, 'La connexion privée doit être configurée.');
		}
		return operation(auth, client, origin);
	});

export function authConfigurationReady() {
	try {
		authOrigin({ ORIGIN, BETTER_AUTH_SECRET });
		validateTursoSettings(TURSO_DATABASE_URL, TURSO_AUTH_TOKEN);
		return true;
	} catch {
		return false;
	}
}
