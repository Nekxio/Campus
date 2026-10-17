import { stringArray } from './values.js';
import type { Client } from '@libsql/client/web';
import type { Auth } from '../auth.js';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { createDatabase } from '../db/index.js';
import { oauthConsent, oauthClient, session, user } from '../db/schema.js';
import { consumeRateLimit } from '../auth/rate-limit.js';
import { mcpScopes, type McpScope } from '../../domain/remote-mcp.js';

export type McpPrincipal = {
	teacherId: string;
	sessionId: string;
	clientId: string;
	scopes: McpScope[];
};
export async function authenticateMcp(
	auth: Auth,
	client: Client,
	origin: string,
	request: Request
): Promise<McpPrincipal> {
	const bearer = /^Bearer ([A-Za-z0-9_.-]{40,8000})$/.exec(
		request.headers.get('authorization') ?? ''
	);
	if (!bearer || new URL(request.url).searchParams.has('access_token'))
		error(401, 'Connexion de l’application requise.');
	const { payload } = await auth.api.verifyJWT({
		body: { token: bearer[1], issuer: origin + '/api/auth' }
	});
	if (
		!payload ||
		payload.aud !== origin + '/mcp' ||
		typeof payload.sid !== 'string' ||
		typeof payload.client_id !== 'string' ||
		typeof payload.coursely_consent !== 'string' ||
		typeof payload.exp !== 'number' ||
		payload.exp * 1000 <= Date.now() ||
		typeof payload.scope !== 'string'
	)
		error(401, 'Jeton invalide ou expiré.');
	const db = createDatabase(client);
	const [bound] = await db
		.select({
			role: user.role,
			teacherId: user.id,
			sessionId: session.id,
			expiresAt: session.expiresAt,
			clientId: oauthClient.clientId,
			disabled: oauthClient.disabled,
			scopes: oauthConsent.scopes
		})
		.from(session)
		.innerJoin(user, eq(session.userId, user.id))
		.innerJoin(
			oauthConsent,
			and(
				eq(oauthConsent.userId, user.id),
				eq(oauthConsent.id, payload.coursely_consent),
				eq(oauthConsent.clientId, payload.client_id)
			)
		)
		.innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
		.where(and(eq(session.id, payload.sid), eq(user.id, payload.sub)));
	const scopes = payload.scope.split(' ');
	if (
		!bound ||
		bound.role !== 'teacher' ||
		bound.disabled ||
		bound.expiresAt.getTime() <= Date.now() ||
		!scopes.every((s) => mcpScopes.includes(s as McpScope) && stringArray(bound.scopes).includes(s))
	)
		error(401, 'Autorisation expirée ou révoquée.');
	const limit = await consumeRateLimit(client, 'mcp:' + bound.teacherId + ':' + bound.clientId, {
		window: 60,
		max: 60
	});
	if (!limit.allowed) error(429, 'Trop de requêtes. Réessayez dans une minute.');
	return {
		teacherId: bound.teacherId,
		sessionId: bound.sessionId,
		clientId: bound.clientId,
		scopes: scopes as McpScope[]
	};
}
