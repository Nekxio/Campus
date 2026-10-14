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

export function createAuth(settings: AuthSettings, client: Client) {
	const origin = authOrigin(settings);
	return betterAuth({
		appName: 'Coursely',
		baseURL: origin,
		secret: settings.BETTER_AUTH_SECRET,
		trustedOrigins: [origin],
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				const claimedOrigin = ctx.headers?.get('origin');
				if (
					(claimedOrigin && claimedOrigin !== origin) ||
					(ctx.request?.method === 'POST' && !claimedOrigin)
				)
					throw new APIError('FORBIDDEN', { message: 'Origine refusée.' });
			})
		},
		database: drizzleAdapter(createDatabase(client), {
			provider: 'sqlite',
			schema,
			transaction: true
		}),
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
}
export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth['$Infer']['Session'];
