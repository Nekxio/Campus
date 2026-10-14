import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withAuth } from '#lib/server/auth/runtime.js';

// Key management is deliberately operator-only; keys cannot become browser sessions.
export const GET: RequestHandler = ({ request, url }) => {
	if (url.pathname.startsWith('/api/auth/api-key/'))
		return json(
			{ message: 'La gestion des clés agent utilise les commandes opérateur.' },
			{ status: 403, headers: { 'Cache-Control': 'private, no-store' } }
		);
	return withAuth((auth) => auth.handler(request));
};
export const POST: RequestHandler = GET;
