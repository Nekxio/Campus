import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withAuth } from '#lib/server/auth/runtime.js';
import { AUTH_BODY_LIMIT, withBoundedAuthRequest } from '#lib/server/auth/request-body.js';

// Key management is deliberately operator-only; keys cannot become browser sessions.
export const GET: RequestHandler = ({ request, url }) => {
	if (
		url.pathname.startsWith('/api/auth/api-key/') ||
		url.pathname.startsWith('/api/auth/admin/oauth2/') ||
		url.pathname === '/api/auth/token' ||
		(url.pathname.startsWith('/api/auth/oauth2/') &&
			![
				'/api/auth/oauth2/authorize',
				'/api/auth/oauth2/token',
				'/api/auth/oauth2/register',
				'/api/auth/oauth2/revoke',
				'/api/auth/oauth2/introspect'
			].includes(url.pathname))
	)
		return json(
			{ message: 'La gestion des clés agent utilise les commandes opérateur.' },
			{ status: 403, headers: { 'Cache-Control': 'private, no-store' } }
		);
	return withAuth((auth) =>
		withBoundedAuthRequest(
			request,
			url.pathname.startsWith('/api/auth/oauth2/') ? 16384 : AUTH_BODY_LIMIT,
			(bounded) => auth.handler(bounded)
		)
	);
};
export const POST: RequestHandler = GET;
