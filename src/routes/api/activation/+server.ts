import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withAuth } from '#lib/server/auth/runtime.js';
import {
	InvalidInvitationError,
	invitationCookieName,
	readInvitation
} from '#lib/server/auth/invitations.js';
import { consumeRateLimit } from '#lib/server/auth/rate-limit.js';

export const POST: RequestHandler = (event) =>
	withAuth(async (_auth, client, origin) => {
		if (event.request.headers.get('origin') !== origin) error(403, 'Origine refusée.');
		const limit = await consumeRateLimit(client, 'activation:' + event.getClientAddress(), {
			window: 60,
			max: 10
		});
		if (!limit.allowed)
			return json(
				{ message: 'Réessayez plus tard.' },
				{ status: 429, headers: { 'Retry-After': String(limit.retryAfter) } }
			);
		let token: string;
		try {
			const body: unknown = await event.request.json();
			if (!body || typeof body !== 'object' || !('token' in body) || typeof body.token !== 'string')
				throw new InvalidInvitationError();
			token = body.token;
		} catch {
			error(400, 'Invitation invalide.');
		}
		try {
			const invite = await readInvitation(client, token);
			event.cookies.set(invitationCookieName, token, {
				path: '/api/auth',
				httpOnly: true,
				secure: origin.startsWith('https:'),
				sameSite: 'strict',
				maxAge: 15 * 60
			});
			return json({ name: invite.name, email: invite.email });
		} catch (cause) {
			if (cause instanceof InvalidInvitationError) error(400, cause.message);
			error(503, 'La connexion privée est temporairement indisponible.');
		}
	});
