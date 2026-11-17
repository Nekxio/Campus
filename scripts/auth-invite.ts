import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { authOrigin } from '../src/lib/server/auth/config.js';
import { issueInvitation } from '../src/lib/server/auth/invitations.js';
import { invitationDocument } from '../src/lib/server/auth/invitation-link.js';
import { operatorClient } from './operator-client.js';

const [email, name] = process.argv.slice(2);
if (!email || !name) throw new Error('Usage: pnpm auth:invite <email> "Full name"');
const origin = authOrigin({
	ORIGIN: process.env.ORIGIN ?? '',
	BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? ''
});
const client = operatorClient();
try {
	const invite = await issueInvitation(client, { role: 'teacher', email, name });
	await mkdir('data/invitations', { recursive: true, mode: 0o700 });
	const path = resolve('data/invitations', invite.id + '-' + Date.now());
	await writeFile(path + '.json', JSON.stringify({ origin, ...invite }, null, 2) + '\n', {
		mode: 0o600,
		flag: 'wx'
	});
	await writeFile(path + '.html', invitationDocument(origin, invite.token), {
		mode: 0o600,
		flag: 'wx'
	});
	console.log('Open the private invitation at ' + path + '.html. Do not paste its link or contents into logs or chat.');
} finally {
	client.close();
}
