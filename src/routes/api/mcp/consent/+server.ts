import { json, isHttpError, error } from '@sveltejs/kit';
import { requireTeacher } from '#lib/server/auth/access.js';
import { withAuth } from '#lib/server/auth/runtime.js';
import { withBoundedAuthRequest } from '#lib/server/auth/request-body.js';
import { consentDecisionSchema } from '#lib/domain/remote-mcp.js';
import { decideOAuth } from '#lib/server/mcp/consent.js';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ locals, request, url }) => {
	try {
		requireTeacher(locals);
		if (request.headers.get('origin') !== url.origin) error(403, 'Origine refusée.');
		if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
			error(415, 'Données JSON requises.');
		return await withBoundedAuthRequest(request, 16384, async (bounded) => {
			let value: unknown;
			try {
				value = await bounded.json();
			} catch {
				error(400, 'Données JSON invalides.');
			}
			const parsed = consentDecisionSchema.safeParse(value);
			if (!parsed.success) error(422, 'Vérifiez les droits demandés.');
			return withAuth(async (auth, client, origin) =>
				json(await decideOAuth(auth, client, origin, request.headers, parsed.data))
			);
		});
	} catch (cause) {
		return json(
			{
				message: isHttpError(cause) ? cause.body.message : 'La décision n’a pas pu être confirmée. Réessayez.'
			},
			{ status: isHttpError(cause) ? cause.status : 503 }
		);
	}
};
