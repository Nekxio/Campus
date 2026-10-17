import type { Client } from '@libsql/client/web';
import type { DBAdapter } from 'better-auth/adapters';
import { APIError } from 'better-auth/api';

export const unusedClientLimit = 100;
export const unusedClientRetentionMs = 24 * 60 * 60 * 1000;

// Keep this predicate aligned with migration 0011. Any ownership, consent or token
// record protects a client, even if its token is expired or revoked. In-flight
// logins without consent have a full day to complete and are never evicted for space.
const unusedPublicClient = `user_id IS NULL AND reference_id IS NULL
	AND client_discovery_id IS NULL AND client_secret IS NULL
	AND token_endpoint_auth_method = 'none' AND COALESCE(skip_consent, 0) = 0
	AND NOT EXISTS (SELECT 1 FROM oauth_consent WHERE client_id = oauth_client.client_id)
	AND NOT EXISTS (SELECT 1 FROM oauth_access_token WHERE client_id = oauth_client.client_id)
	AND NOT EXISTS (SELECT 1 FROM oauth_refresh_token WHERE client_id = oauth_client.client_id)`;

export async function cleanupUnusedOAuthClients(client: Client, now = Date.now()) {
	// A single SQLite write checks references and deletes together. Do not select
	// identities then delete later: consent/token issuance can race that selection.
	await client.execute({
		sql: `DELETE FROM oauth_client WHERE id IN (
			SELECT id FROM oauth_client WHERE ${unusedPublicClient} AND created_at < ?
			ORDER BY created_at, id LIMIT ?
		)`,
		args: [now - unusedClientRetentionMs, unusedClientLimit]
	});
}

function registrationError(cause: unknown): never {
	let current = cause;
	for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
		if (current.message.includes('coursely_unused_oauth_client_limit'))
			throw new APIError('TOO_MANY_REQUESTS', {
				error: 'temporarily_unavailable',
				message: 'Trop de connexions en attente. Réessayez plus tard.'
			});
		current = current.cause;
	}
	throw cause;
}

// The provider inserts clients inside its adapter transaction. Translate the
// database guard at both entry points, without changing transaction semantics.
export function withOAuthRegistrationLimit(adapter: DBAdapter): DBAdapter {
	return {
		...adapter,
		async create(data) {
			try {
				return await adapter.create(data);
			} catch (cause) {
				registrationError(cause);
			}
		},
		async transaction(callback) {
			try {
				return await adapter.transaction(callback);
			} catch (cause) {
				registrationError(cause);
			}
		}
	};
}
