import { execFileSync } from 'node:child_process';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const contents = (hook: string) => `#!/bin/sh
# CAMPUS_MANAGED_HOOK_V1
exec "$(git rev-parse --show-toplevel)/.githooks/${hook}" "$@"
`;

const main = async () => {
	const directory = resolve(execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { encoding: 'utf8' }).trim());
	await mkdir(directory, { recursive: true });
	const hooks = [{ name: 'pre-push', source: 'pre-push' }];
	// Check every destination before writing, preserving GitButler and unrelated hooks.
	for (const hook of hooks) {
		const path = join(directory, hook.name);
		try {
			await access(path);
			if ((await readFile(path, 'utf8')) !== contents(hook.source))
				throw new Error(`Existing ${hook.name} hook requires manual integration.`);
		} catch (cause) {
			if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'ENOENT') throw cause;
		}
	}
	for (const hook of hooks) {
		const path = join(directory, hook.name);
		try {
			await writeFile(path, contents(hook.source), { mode: 0o755, flag: 'wx' });
		} catch (cause) {
			if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'EEXIST') throw cause;
		}
		await chmod(path, 0o755);
	}
	console.log('Campus hooks installed; existing GitButler guards preserved.');
};

main().catch((cause: unknown) => {
	console.error(cause instanceof Error ? cause.message : 'Git hook installation failed.');
	process.exitCode = 1;
});
