import { mkdir, open, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createAuth } from '../src/lib/server/auth.js';
import { authOrigin } from '../src/lib/server/auth/config.js';
import { issueAgentKey, revokeAgentKey } from '../src/lib/server/agent/keys.js';
import { operatorClient } from './operator-client.js';

const [command, email, value, duration, access] = process.argv.slice(2);
if (
	!['issue', 'revoke'].includes(command) ||
	!email ||
	(command === 'revoke' && !value) ||
	(access !== undefined && access !== 'corrections')
)
	throw new Error(
		'Usage: pnpm agent:key issue <teacher-email> [name] [days] [corrections] | revoke <teacher-email> <key-id>'
	);
const client = operatorClient();
try {
	if (command === 'revoke') {
		const removed = await revokeAgentKey(client, email, value);
		console.log(
			removed
				? 'Agent key revoked; teacher passkeys and sessions are unchanged.'
				: 'No matching agent key was found.'
		);
	} else {
		const settings = {
			ORIGIN: process.env.ORIGIN ?? '',
			BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? ''
		};
		const origin = authOrigin(settings);
		const path = resolve(process.env.COURSELY_AGENT_CONFIG_FILE ?? 'data/agent/codex.json');
		await mkdir(dirname(path), { recursive: true, mode: 0o700 });
		const handle = await open(path, 'wx', 0o600);
		let created: Awaited<ReturnType<typeof issueAgentKey>> | undefined;
		try {
			created = await issueAgentKey(
				createAuth(settings, client),
				client,
				email,
				value ?? 'Codex',
				duration === undefined ? 30 : Number(duration),
				access === 'corrections'
			);
			await handle.writeFile(
				JSON.stringify(
					{
						version: 1,
						origin,
						key: created.key,
						keyId: created.id,
						teacherId: created.referenceId,
						expiresAt: created.expiresAt!.toISOString()
					},
					null,
					2
				) + '\n'
			);
			await handle.sync();
			console.log(
				'Agent access saved to ' +
					path +
					'. Key ID: ' +
					created.id +
					'. Keep this private file out of Git and chat.'
			);
		} catch (cause) {
			if (created) await revokeAgentKey(client, email, created.id);
			await unlink(path);
			throw cause;
		} finally {
			await handle.close();
		}
	}
} finally {
	client.close();
}
