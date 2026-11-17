import { json, error, isHttpError } from '@sveltejs/kit';
import { requireTeacher } from '#lib/server/auth/access.js';
import { withAuth } from '#lib/server/auth/runtime.js';
import { withBoundedAuthRequest } from '#lib/server/auth/request-body.js';
import { revokeConsentSchema } from '#lib/domain/remote-mcp.js';
import { revokeApplication } from '#lib/server/mcp/consent.js';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async ({ locals, request, url }) => {
	try {
		const teacher = requireTeacher(locals);
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
			const parsed = revokeConsentSchema.safeParse(value);
			if (!parsed.success) error(422, 'Confirmation invalide.');
			return withAuth(async (_auth, client) => json(await revokeApplication(client, teacher.id, parsed.data)));
		});
	} catch (cause) {
		return json(
			{
				message: isHttpError(cause) ? cause.body.message : 'La révocation n’a pas pu être confirmée. Réessayez.'
			},
			{ status: isHttpError(cause) ? cause.status : 503 }
		);
	}
};
