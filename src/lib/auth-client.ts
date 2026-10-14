import { createAuthClient } from 'better-auth/svelte';
import { inferAdditionalFields } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';
import { InvitationPreparationError, invitationIdentitySchema } from './auth/flow.js';
import type { Auth } from './server/auth.js';

export const authClient = createAuthClient({
	plugins: [passkeyClient(), inferAdditionalFields<Auth>()]
});

// The activation screen exchanges the secret from a URL fragment for an HttpOnly cookie.
// No token is ever sent in a query string or a log.
export async function prepareInvitation(token: string) {
	const response = await fetch('/api/activation', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token })
	});
	if (!response.ok) throw new InvitationPreparationError(response.status);
	return invitationIdentitySchema.parse(await response.json());
}
