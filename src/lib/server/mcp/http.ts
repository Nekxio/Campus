import { createMcpHandler } from '@modelcontextprotocol/server';
import { isHttpError, json, error } from '@sveltejs/kit';
import type { Client } from '@libsql/client/web';
import type { Auth } from '../auth.js';
import { createDatabase } from '../db/index.js';
import { authenticateMcp } from './principal.js';
import { createRemoteMcp, requiredToolScopes } from './tools.js';
import { withBoundedAuthRequest } from '../auth/request-body.js';

export function mcpChallenge(origin: string, scopes = ['modules:read'], status = 401) {
	return {
		status,
		headers: {
			'Cache-Control': 'private, no-store',
			'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="${scopes.join(' ')}"${status === 403 ? ', error="insufficient_scope"' : ''}`
		}
	};
}
export async function handleRemoteMcp(
	request: Request,
	auth: Auth,
	client: Client,
	origin: string
) {
	try {
		const claimed = request.headers.get('origin');
		if ((claimed && claimed !== origin) || request.headers.get('sec-fetch-site') === 'cross-site')
			error(403, 'Origine refusée.');
		const principal = await authenticateMcp(auth, client, origin, request);
		if (request.method !== 'POST')
			return new Response(null, {
				status: 405,
				headers: { Allow: 'POST', 'Cache-Control': 'no-store' }
			});
		if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
			error(415, 'Données JSON requises.');
		return await withBoundedAuthRequest(request, 256000, async (bounded) => {
			let message: unknown;
			try {
				message = await bounded.json();
			} catch {
				error(400, 'Requête JSON invalide.');
			}
			if (!message || typeof message !== 'object' || Array.isArray(message))
				error(400, 'Requête MCP invalide.');
			const envelope = message as Record<string, unknown>;
			if (envelope.method === 'subscriptions/listen')
				return json(
					{
						jsonrpc: '2.0',
						id: envelope.id ?? null,
						error: { code: -32601, message: 'Méthode non disponible.' }
					},
					{ status: request.headers.get('mcp-protocol-version') === '2026-07-28' ? 404 : 200 }
				);
			if (
				envelope.method === 'tools/call' &&
				envelope.params &&
				typeof envelope.params === 'object'
			) {
				const params = envelope.params as Record<string, unknown>;
				const required = requiredToolScopes(String(params.name), params.arguments);
				if (!required.every((scope) => principal.scopes.includes(scope)))
					return json({ error: 'insufficient_scope' }, mcpChallenge(origin, required, 403));
			}
			const handler = createMcpHandler(() => createRemoteMcp(createDatabase(client), principal), {
				legacy: 'stateless',
				responseMode: 'json',
				maxRequestBodySize: 256000,
				keepAliveMs: 0
			});
			try {
				const response = await handler.fetch(
					new Request(bounded.url, {
						method: 'POST',
						headers: bounded.headers,
						body: JSON.stringify(message),
						signal: bounded.signal
					})
				);
				// Drain request-scoped legacy SSE before withAuth closes its database client.
				const reader = response.body?.getReader();
				const chunks: Uint8Array[] = [];
				let size = 0;
				if (reader)
					try {
						while (true) {
							const chunk = await reader.read();
							if (chunk.done) break;
							size += chunk.value.byteLength;
							if (size > 4 * 1024 * 1024) {
								void reader.cancel().catch(() => undefined);
								error(413, 'Réduisez le périmètre demandé.');
							}
							chunks.push(chunk.value);
						}
					} finally {
						reader.releaseLock();
					}
				const body = new Uint8Array(size);
				let offset = 0;
				for (const chunk of chunks) {
					body.set(chunk, offset);
					offset += chunk.byteLength;
				}
				const headers = new Headers(response.headers);
				headers.set('Cache-Control', 'private, no-store');
				return new Response(size ? body : null, { status: response.status, headers });
			} finally {
				await handler.close();
			}
		});
	} catch (cause) {
		const status = isHttpError(cause) ? cause.status : 503;
		return json(
			{
				message: isHttpError(cause)
					? cause.body.message
					: 'Connexion de l’application indisponible.'
			},
			status === 401
				? mcpChallenge(origin)
				: { status, headers: { 'Cache-Control': 'private, no-store' } }
		);
	}
}
