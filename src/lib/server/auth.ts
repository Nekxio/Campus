import { jwt } from 'better-auth/plugins/jwt';
import {
	remoteOAuth,
	teachingOAuthClaims,
	nativeOAuthPaths,
	loopbackRedirect
} from './mcp/oauth.js';
import { apiKey } from '@better-auth/api-key';
import { agentConfigId } from '../domain/module-import.js';
import type { Client } from '@libsql/client/web';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { passkey } from '@better-auth/passkey';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { createDatabase } from './db/index.js';
import * as schema from './db/schema.js';
import { authOrigin, type AuthSettings } from './auth/config.js';
import {
	invitationFromHeaders,
	invitationIdentifier,
	parseInvitation,
	readInvitation
} from './auth/invitations.js';
import { consumeRateLimit } from './auth/rate-limit.js';
import { cleanupUnusedOAuthClients, withOAuthRegistrationLimit } from './mcp/registration.js';

export async function createAuth(settings: AuthSettings, client: Client) {
	const origin = authOrigin(settings);
	const database = drizzleAdapter(createDatabase(client), {
		provider: 'sqlite',
		schema,
		transaction: true
	});
	const auth = betterAuth({
		appName: 'Coursely',
		baseURL: origin,
		secret: settings.BETTER_AUTH_SECRET,
		trustedOrigins: [origin],
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				if (ctx.path === '/oauth2/register') {
					const body = ctx.body;
					if (
						body?.token_endpoint_auth_method !== 'none' ||
						!Array.isArray(body.redirect_uris) ||
						body.redirect_uris.length !== 1 ||
						!body.redirect_uris.every((uri: string) => loopbackRedirect(uri)) ||
						body.jwks_uri ||
						body.jwks ||
						body.client_uri ||
						body.logo_uri ||
						body.software_statement ||
						body.token_endpoint_auth_signing_alg ||
						body.dpop_bound_access_tokens ||
						body.require_pkce === false ||
						(typeof body.client_name === 'string' &&
							(body.client_name.length > 100 ||
								Array.from(body.client_name as string).some(
									(character) => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127
								)))
					)
						throw new APIError('BAD_REQUEST', {
							error: 'invalid_client_metadata',
							message: 'Seuls les clients publics à retour loopback sont permis.'
						});
				}
				if (
					ctx.path === '/oauth2/authorize' &&
					(ctx.query?.claims || ctx.query?.request || ctx.query?.request_uri)
				)
					throw new APIError('BAD_REQUEST', {
						error: 'invalid_request',
						message: 'Demande OAuth non prise en charge.'
					});
				if (
					ctx.path === '/oauth2/authorize' &&
					(ctx.query?.resource !== origin + '/mcp' ||
						ctx.query?.code_challenge_method !== 'S256' ||
						!ctx.query?.code_challenge)
				)
					throw new APIError('BAD_REQUEST', {
						error: 'invalid_request',
						message: 'Ressource et PKCE S256 requis.'
					});
				if (ctx.path === '/oauth2/token' && ctx.body?.resource !== origin + '/mcp')
					throw new APIError('BAD_REQUEST', {
						error: 'invalid_target',
						message: 'Ressource MCP exacte requise.'
					});
				const claimedOrigin = ctx.headers?.get('origin');
				// OAuth starts with a top-level navigation from the client site.
				// Writes and browser fetches keep the normal same-origin requirement.
				const authorizationNavigation =
					ctx.path === '/oauth2/authorize' &&
					ctx.request?.method === 'GET' &&
					ctx.headers?.get('sec-fetch-mode') === 'navigate';
				if (
					(ctx.headers?.get('sec-fetch-site') === 'cross-site' && !authorizationNavigation) ||
					(claimedOrigin && claimedOrigin !== origin) ||
					(ctx.request?.method === 'POST' && !claimedOrigin && !nativeOAuthPaths.has(ctx.path))
				)
					throw new APIError('FORBIDDEN', { message: 'Origine refusée.' });
				if (ctx.path === '/oauth2/register') await cleanupUnusedOAuthClients(client);
			})
		},
		database: (options: Parameters<typeof database>[0]) =>
			withOAuthRegistrationLimit(database(options)),
		emailAndPassword: { enabled: false },
		user: {
			additionalFields: {
				role: {
					type: ['teacher'],
					required: true,
					defaultValue: 'teacher',
					input: false
				}
			},
			changeEmail: { enabled: false },
			deleteUser: { enabled: false }
		},
		account: { accountLinking: { enabled: false } },
		session: { expiresIn: 8 * 60 * 60, updateAge: 60 * 60, cookieCache: { enabled: false } },
		advanced: {
			cookiePrefix: 'coursely',
			useSecureCookies: origin.startsWith('https:'),
			defaultCookieAttributes: { httpOnly: true, sameSite: 'strict' },
			ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] }
		},
		rateLimit: {
			enabled: true,
			window: 60,
			max: 30,
			customStorage: { consume: (key, rule) => consumeRateLimit(client, key, rule) }
		},
		telemetry: { enabled: false },
		plugins: [
			jwt({ jwt: { issuer: origin + '/api/auth', audience: origin + '/mcp' } }),
			remoteOAuth(origin),
			teachingOAuthClaims(client),
			apiKey({
				configId: agentConfigId,
				references: 'user',
				defaultPrefix: 'coursely_',
				requireName: true,
				maximumNameLength: 64,
				startingCharactersConfig: { shouldStore: false },
				enableSessionForAPIKeys: false,
				keyExpiration: { defaultExpiresIn: 30 * 86400, minExpiresIn: 1, maxExpiresIn: 90 },
				rateLimit: { enabled: true, timeWindow: 60000, maxRequests: 60 },
				permissions: { defaultPermissions: {} }
			}),
			passkey({
				rpID: new URL(origin).hostname,
				rpName: 'Coursely',
				origin,
				authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
				registration: {
					requireSession: false,
					async resolveUser({ ctx }) {
						try {
							const invite = await readInvitation(client, invitationFromHeaders(ctx.headers));
							return { id: invite.id, name: invite.email, displayName: invite.name };
						} catch {
							throw new APIError('FORBIDDEN', { message: 'Une invitation valide est nécessaire.' });
						}
					},
					async afterVerification({ ctx, verification, user }) {
						if (!verification.registrationInfo?.userVerified)
							throw new APIError('FORBIDDEN', {
								message: 'La validation sur votre appareil est requise.'
							});
						let identifier: string;
						try {
							identifier = await invitationIdentifier(invitationFromHeaders(ctx.headers));
						} catch {
							throw new APIError('FORBIDDEN', { message: 'Une invitation valide est nécessaire.' });
						}
						// Atomic consumption runs inside Better Auth's passkey creation transaction.
						const row = await ctx.context.internalAdapter.consumeVerificationValue(identifier);
						if (!row)
							throw new APIError('FORBIDDEN', { message: 'Invitation expirée ou déjà utilisée.' });
						const invite = parseInvitation(row.value);
						const target = await ctx.context.internalAdapter.findUserById(invite.id);
						if (
							invite.id !== user.id ||
							!target ||
							!('role' in target) ||
							target.role !== invite.role ||
							target.email !== invite.email
						)
							throw new APIError('FORBIDDEN', {
								message: 'Invitation incompatible avec ce compte.'
							});
						return { userId: invite.id };
					}
				},
				authentication: {
					afterVerification({ verification }) {
						if (!verification.authenticationInfo?.userVerified)
							throw new APIError('FORBIDDEN', {
								message: 'La validation sur votre appareil est requise.'
							});
					}
				}
			})
		]
	});
	await auth.$context;
	return auth;
}
export type Auth = Awaited<ReturnType<typeof createAuth>>;
export type AuthSession = Auth['$Infer']['Session'];
