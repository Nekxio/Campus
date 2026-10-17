import { z } from 'zod';
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import { and, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { Client } from '@libsql/client/web';
import type { Auth } from '../auth.js';
import { createDatabase } from '../db/index.js';
import { oauthConsent, oauthClient, oauthRefreshToken, oauthAccessToken } from '../db/schema.js';
import {
	mcpScopes,
	type McpScope,
	type ConsentDecision,
	type RevokeConsent
} from '../../domain/remote-mcp.js';
import { stringArray } from './values.js';
import { loopbackRedirect } from './oauth.js';

export async function readOAuthRequest(auth: Auth, client: Client, query: string, origin: string) {
	if (
		!query ||
		query.length > 12000 ||
		!(await verifyOAuthQueryParams(query, (await auth.$context).secret))
	)
		error(400, 'La demande a expiré ou a été modifiée. Reprenez depuis Codex.');
	const params = new URLSearchParams(query);
	for (const name of [
		'client_id',
		'scope',
		'resource',
		'redirect_uri',
		'code_challenge',
		'code_challenge_method'
	])
		if (params.getAll(name).length !== 1) error(400, 'Demande de connexion invalide.');
	if (
		params.get('resource') !== origin + '/mcp' ||
		!loopbackRedirect(params.get('redirect_uri') ?? '') ||
		params.get('code_challenge_method') !== 'S256'
	)
		error(400, 'Demande de connexion invalide.');
	const requested = (params.get('scope') ?? '').split(' ');
	if (
		!requested.includes('modules:read') ||
		!requested.every((s) => mcpScopes.includes(s as McpScope))
	)
		error(400, 'Droits demandés invalides.');
	const [application] = await createDatabase(client)
		.select({
			clientId: oauthClient.clientId,
			name: oauthClient.name,
			disabled: oauthClient.disabled,
			redirectUris: oauthClient.redirectUris
		})
		.from(oauthClient)
		.where(eq(oauthClient.clientId, params.get('client_id')!));
	if (
		!application ||
		application.disabled ||
		!stringArray(application.redirectUris).some((uri) => {
			const expected = new URL(uri);
			const actual = new URL(params.get('redirect_uri')!);
			return expected.hostname === actual.hostname && expected.pathname === actual.pathname;
		})
	)
		error(400, 'Application indisponible. Reprenez depuis Codex.');
	return {
		clientId: application.clientId,
		name: application.name || 'Application sans nom',
		scopes: [...new Set(requested)] as McpScope[],
		oauthQuery: query
	};
}
export async function decideOAuth(
	auth: Auth,
	client: Client,
	origin: string,
	headers: Headers,
	command: ConsentDecision
) {
	const request = await readOAuthRequest(auth, client, command.oauthQuery, origin);
	if (
		!command.scopes.includes('modules:read') ||
		!command.scopes.every((s) => request.scopes.includes(s))
	)
		error(422, 'Choisissez uniquement les droits demandés.');
	if (
		command.accept &&
		command.scopes.includes('corrections:propose') &&
		!command.scopes.includes('corrections:read')
	)
		error(422, 'La proposition nécessite la lecture des corrections.');
	return browserOAuth(auth, origin, headers, '/oauth2/consent', {
		accept: command.accept,
		scope: command.scopes.join(' '),
		oauth_query: command.oauthQuery
	});
}
export async function listApplications(client: Client, teacherId: string) {
	const rows = await createDatabase(client)
		.select({
			id: oauthConsent.id,
			clientId: oauthConsent.clientId,
			name: oauthClient.name,
			scopes: oauthConsent.scopes,
			createdAt: oauthConsent.createdAt,
			updatedAt: oauthConsent.updatedAt
		})
		.from(oauthConsent)
		.innerJoin(oauthClient, eq(oauthConsent.clientId, oauthClient.clientId))
		.where(eq(oauthConsent.userId, teacherId));
	return rows.map((row) => ({
		id: row.id,
		clientId: row.clientId,
		name: row.name || 'Application sans nom',
		scopes: stringArray(row.scopes).filter((s): s is McpScope => mcpScopes.includes(s as McpScope)),
		createdAt: row.createdAt.toISOString(),
		reviewedVersion: row.updatedAt.toISOString() + ':' + stringArray(row.scopes).join(' ')
	}));
}
export async function revokeApplication(client: Client, teacherId: string, command: RevokeConsent) {
	return createDatabase(client).transaction(async (tx) => {
		const [consent] = await tx
			.select()
			.from(oauthConsent)
			.where(and(eq(oauthConsent.id, command.id), eq(oauthConsent.userId, teacherId)));
		if (!consent) error(409, 'Cette autorisation a changé. Actualisez avant de décider.');
		if (
			consent.updatedAt.toISOString() + ':' + stringArray(consent.scopes).join(' ') !==
			command.reviewedVersion
		)
			error(409, 'Cette autorisation a changé. Actualisez avant de décider.');
		await tx
			.update(oauthRefreshToken)
			.set({ revoked: new Date() })
			.where(
				and(
					eq(oauthRefreshToken.clientId, consent.clientId),
					eq(oauthRefreshToken.userId, teacherId)
				)
			);
		await tx
			.update(oauthAccessToken)
			.set({ revoked: new Date() })
			.where(
				and(eq(oauthAccessToken.clientId, consent.clientId), eq(oauthAccessToken.userId, teacherId))
			);
		await tx.delete(oauthConsent).where(eq(oauthConsent.id, consent.id));
		return { revoked: true };
	});
}

export async function browserOAuth(
	auth: Auth,
	origin: string,
	headers: Headers,
	path: '/oauth2/consent' | '/oauth2/continue',
	body: { oauth_query: string; accept?: boolean; scope?: string }
) {
	const forwarded = new Headers({ cookie: headers.get('cookie') ?? '', origin });
	forwarded.set('Content-Type', 'application/json');
	forwarded.set('Accept', 'application/json');
	const response = await auth.handler(
		new Request(origin + '/api/auth' + path, {
			method: 'POST',
			headers: forwarded,
			body: JSON.stringify(path === '/oauth2/continue' ? { ...body, postLogin: true } : body)
		})
	);
	if (!response.ok)
		error(
			response.status >= 500 ? 503 : 400,
			'La demande a expiré ou a été modifiée. Reprenez depuis Codex.'
		);
	const result = z
		.object({ url: z.string().min(1).max(16000), redirect: z.boolean().optional() })
		.parse(await response.json());
	const target = new URL(result.url, origin);
	const expected = new URL(new URLSearchParams(body.oauth_query).get('redirect_uri')!);
	const internal =
		target.origin === origin && ['/autoriser', '/connexion/application'].includes(target.pathname);
	const callback = target.origin === expected.origin && target.pathname === expected.pathname;
	if (target.username || target.password || target.hash || (!internal && !callback))
		error(400, 'Redirection de la demande refusée.');
	return { ...result, url: target.href };
}
