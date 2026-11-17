import { revokeAccount } from '../src/lib/server/auth/revoke.js';
import { operatorClient } from './operator-client.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) throw new Error('Usage: pnpm auth:revoke <email>');
const client = operatorClient();
try {
	await revokeAccount(client, email);
	console.log('Teacher account, passkeys, invitations and sessions revoked if present.');
} finally {
	client.close();
}
