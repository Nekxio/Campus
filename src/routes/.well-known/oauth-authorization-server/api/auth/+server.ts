import { json } from '@sveltejs/kit';
import { withAuth } from '#lib/server/auth/runtime.js';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = () =>
	withAuth(async (auth) =>
		json(await auth.api.getOAuthServerConfig(), {
			headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }
		})
	);
