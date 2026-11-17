import { isHttpError, redirect } from '@sveltejs/kit';
import { withAuth } from '#lib/server/auth/runtime.js';
import { readOAuthRequest, browserOAuth } from '#lib/server/mcp/consent.js';
import { requireTeacher } from '#lib/server/auth/access.js';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ url, locals, request }) => {
	try {
		const reviewed = await withAuth((auth, client, origin) =>
			readOAuthRequest(auth, client, url.search.slice(1), origin)
		);
		const query = new URLSearchParams(reviewed.oauthQuery);
		const issuedAt = Number(query.get('ba_iat'));
		const maxAge = query.has('max_age') ? Number(query.get('max_age')) : null;
		const createdAt = locals.session?.createdAt.getTime() ?? 0;
		const fresh = Number.isFinite(issuedAt) && createdAt >= issuedAt;
		const signInRequired =
			(query.get('prompt')?.split(' ').includes('login') ||
				(maxAge !== null && (maxAge === 0 || createdAt + maxAge * 1000 < Date.now()))) &&
			!fresh;
		if (locals.user && locals.session && !signInRequired) {
			requireTeacher(locals);
			const result = await withAuth((auth, _client, origin) =>
				browserOAuth(auth, origin, request.headers, '/oauth2/continue', {
					oauth_query: reviewed.oauthQuery
				})
			);
			redirect(303, result.url);
		}
		return { application: reviewed, issue: '' };
	} catch (cause) {
		if (!isHttpError(cause)) throw cause;
		return {
			application: null,
			issue:
				cause.status === 400
					? 'La demande a expiré ou a été modifiée. Relancez la connexion depuis Codex.'
					: 'La connexion de l’application est momentanément indisponible. Réessayez plus tard.'
		};
	}
};
export const prerender = false;
