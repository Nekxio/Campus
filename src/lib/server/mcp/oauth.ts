import { stringArray } from './values.js';
import type { Client } from '@libsql/client/web';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError } from 'better-auth/api';
import { mcp } from '@better-auth/mcp';
import { extendOAuthProvider } from '@better-auth/oauth-provider';
import { and, eq } from 'drizzle-orm';
import { createDatabase } from '../db/index.js';
import { oauthConsent, session } from '../db/schema.js';
import { mcpScopes } from '../../domain/remote-mcp.js';

export const nativeOAuthPaths = new Set([
	'/oauth2/token',
	'/oauth2/register',
	'/oauth2/revoke',
	'/oauth2/introspect'
]);
export function loopbackRedirect(value: string) {
	try {
		const url = new URL(value);
		return (
			url.protocol === 'http:' &&
			['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) &&
			!url.username &&
			!url.password &&
			!url.hash &&
			!url.search &&
			/^\/callback(?:\/[A-Za-z0-9_-]{1,128})?$/.test(url.pathname)
		);
	} catch {
		return false;
	}
}
export function remoteOAuth(origin: string) {
	return mcp({
		resource: origin + '/mcp',
		loginPage: '/connexion/application',
		consentPage: '/autoriser',
		scopes: [...mcpScopes],
		advertisedMetadata: { scopes_supported: ['modules:read'] },
		grantTypes: ['authorization_code', 'refresh_token'],
		accessTokenExpiresIn: 600,
		refreshTokenExpiresIn: 8 * 60 * 60,
		codeExpiresIn: 120,
		refreshTokenReuseInterval: 0,
		storeTokens: 'hashed',
		storeClientSecret: 'hashed',
		allowDynamicClientRegistration: true,
		allowUnauthenticatedClientRegistration: true,
		clientRegistrationDefaultScopes: ['modules:read'],
		clientRegistrationAllowedScopes: [...mcpScopes],
		clientPrivileges: () => false,
		validateRedirectUri: (uri, registered, valid) =>
			valid &&
			loopbackRedirect(uri) &&
			registered.some((r) => {
				if (!loopbackRedirect(r)) return false;
				const actual = new URL(uri);
				const expected = new URL(r);
				return actual.hostname === expected.hostname && actual.pathname === expected.pathname;
			})
	});
}

// A signed access token names the exact consent row, so re-authorizing after a
// revocation cannot revive an older JWT. Refresh and issuance also require a live session.
export function teachingOAuthClaims(client: Client): BetterAuthPlugin {
	return {
		id: 'coursely-teaching-oauth',
		init(ctx) {
			extendOAuthProvider(ctx, {
				claims: {
					accessToken: async ({ user, client: application, scopes, sessionId }) => {
						if (!user || user.role !== 'teacher' || !sessionId)
							throw new APIError('FORBIDDEN', { message: 'Une session enseignant est requise.' });
						const db = createDatabase(client);
						const [live] = await db
							.select()
							.from(session)
							.where(and(eq(session.id, sessionId), eq(session.userId, user.id)));
						const [consent] = await db
							.select()
							.from(oauthConsent)
							.where(
								and(
									eq(oauthConsent.clientId, application.clientId),
									eq(oauthConsent.userId, user.id)
								)
							);
						if (
							!live ||
							live.expiresAt.getTime() <= Date.now() ||
							!consent ||
							!scopes.every((s) => stringArray(consent.scopes).includes(s))
						)
							throw new APIError('FORBIDDEN', { message: 'Autorisation expirée ou révoquée.' });
						return { coursely_consent: consent.id };
					}
				}
			});
		}
	};
}
