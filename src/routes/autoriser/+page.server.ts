import { isHttpError, redirect } from '@sveltejs/kit';
import { requireTeacher } from '#lib/server/auth/access.js';
import { withAuth } from '#lib/server/auth/runtime.js';
import { readOAuthRequest } from '#lib/server/mcp/consent.js';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user || !locals.session) redirect(303, '/connexion/application' + url.search);
	const teacher = requireTeacher(locals);
	try {
		const application = await withAuth((auth, client, origin) =>
			readOAuthRequest(auth, client, url.search.slice(1), origin)
		);
		return { application, name: teacher.name, issue: '' };
	} catch (cause) {
		if (!isHttpError(cause)) throw cause;
		return {
			application: null,
			name: teacher.name,
			issue:
				cause.status === 400
					? 'Votre décision ne peut plus être enregistrée. Relancez la connexion depuis Codex pour recevoir une nouvelle demande.'
					: 'La vérification de la demande est momentanément indisponible. Réessayez plus tard.'
		};
	}
};
export const prerender = false;
