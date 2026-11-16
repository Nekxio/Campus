import { isHttpError, redirect } from '@sveltejs/kit';
import { requireTeacher } from '#lib/server/auth/access.js';
import { withAuth } from '#lib/server/auth/runtime.js';
import { decideOAuth, readOAuthRequest } from '#lib/server/mcp/consent.js';
import { consentDecisionSchema } from '#lib/domain/remote-mcp.js';
import { teacherFormAction } from '#lib/server/teaching/form-actions.js';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
	const query = new URLSearchParams(url.searchParams);
	query.delete('/decideConsent');
	if (!locals.user || !locals.session)
		redirect(303, '/connexion/application' + (query.size ? '?' + query.toString() : ''));
	const teacher = requireTeacher(locals);
	try {
		const application = await withAuth((auth, client, origin) =>
			readOAuthRequest(auth, client, query.toString(), origin)
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
export const actions = {
	decideConsent: teacherFormAction(
		consentDecisionSchema,
		async (input, { request }) => {
			const target = await withAuth((auth, client, origin) =>
				decideOAuth(auth, client, origin, request.headers, input)
			);
			redirect(303, target.url, { external: [new URL(target.url).origin] });
		},
		{ id: 'application-consent', native: true, maxBytes: 16384 }
	)
} satisfies Actions;
export const prerender = false;
