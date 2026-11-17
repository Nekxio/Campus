import { afterEach, expect, it } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { randomBytes } from 'node:crypto';
import { createAuth } from '#lib/server/auth.js';
import { createDatabase } from '#lib/server/db/index.js';
import { issueInvitation, invitationCookieName } from '#lib/server/auth/invitations.js';
import { virtualPasskey } from '#lib/server/auth/testing/webauthn.js';

const origin = 'https://campus.example.test';
let client: Client | undefined;
afterEach(() => client?.close());

it('updates only the name through a fictional teacher passkey session', async () => {
	client = createClient({ url: ':memory:' });
	await migrate(createDatabase(client), { migrationsFolder: './drizzle' });
	const auth = await createAuth({ ORIGIN: origin, BETTER_AUTH_SECRET: randomBytes(32).toString('hex') }, client);
	const invite = await issueInvitation(client, {
		role: 'teacher',
		name: 'Compte fictif',
		email: 'compte@example.test'
	});
	const invitationCookie = invitationCookieName + '=' + invite.token;
	const options = await auth.handler(
		new Request(origin + '/api/auth/passkey/generate-register-options', {
			headers: { origin, cookie: invitationCookie }
		})
	);
	expect(options.status).toBe(200);
	const cookie = (response: Response) =>
		response.headers
			.getSetCookie()
			.map((part) => part.split(';')[0])
			.join(';');
	const registered = await auth.handler(
		new Request(origin + '/api/auth/passkey/verify-registration', {
			method: 'POST',
			headers: {
				origin,
				cookie: invitationCookie + ';' + cookie(options),
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				response: virtualPasskey(origin).register(await options.json()),
				createSession: true
			})
		})
	);
	expect(registered.status).toBe(200);
	const headers = new Headers({ origin, cookie: cookie(registered) });
	await auth.api.updateUser({ body: { name: 'Nom modifié' }, headers });
	const session = await auth.api.getSession({ headers });
	expect(session?.user).toMatchObject({
		name: 'Nom modifié',
		email: 'compte@example.test',
		role: 'teacher'
	});
});
