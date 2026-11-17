import { error, isHttpError, json } from '@sveltejs/kit';
import { profileSchema } from '#lib/domain/profile.js';
import { requireTeacher } from '#lib/server/auth/access.js';
import { updateTeacherProfile } from '#lib/server/auth/profile.js';
import { withBoundedAuthRequest } from '#lib/server/auth/request-body.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request, url }) => {
	try {
		requireTeacher(locals);
		const origin = request.headers.get('origin');
		const fetchSite = request.headers.get('sec-fetch-site');
		// The site's no-referrer policy makes Chrome send Origin: null even for same-origin POSTs.
		// JSON is not form-submittable cross-site; fetch metadata confirms the browser context.
		if (fetchSite === 'cross-site' || (origin !== url.origin && !(origin === 'null' && fetchSite === 'same-origin')))
			error(403, 'Origine refusée.');
		if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
			error(415, 'Données JSON requises.');
		return await withBoundedAuthRequest(request, 1024, async (bounded) => {
			let value: unknown;
			try {
				value = await bounded.json();
			} catch {
				error(400, 'Données JSON invalides.');
			}
			const parsed = profileSchema.safeParse(value);
			if (!parsed.success)
				return json({ fieldError: parsed.error.issues[0]?.message ?? 'Nom invalide.' }, { status: 422 });
			return json(await updateTeacherProfile(parsed.data, { locals, request }));
		});
	} catch (cause) {
		return json(
			{
				message: isHttpError(cause)
					? cause.body.message
					: 'Le nom n’a pas pu être enregistré. Réessayez sans quitter la page.'
			},
			{ status: isHttpError(cause) ? cause.status : 503 }
		);
	}
};
