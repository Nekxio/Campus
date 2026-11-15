import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const run = (args: string[], cwd = process.cwd()) => {
	const result = spawnSync('pnpm', ['--config.verifyDepsBeforeRun=false', ...args], { cwd, stdio: 'inherit' });
	if (result.error || result.status !== 0) throw new Error('Local validation failed; push stopped.');
};

const main = async () => {
	if (process.argv[2] !== 'pre-push') throw new Error('Usage: tsx scripts/git-hooks.ts pre-push');
	const input = readFileSync(0, 'utf8');
	const checked = new Set<string>();
	for (const line of input.trim().split('\n')) {
		const [, sha, remote] = line.split(/\s+/);
		if (!sha || /^0+$/.test(sha) || remote?.startsWith('refs/heads/automation/')) continue;
		if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid pushed commit.');
		const browser = remote === 'refs/heads/develop' || remote?.startsWith('refs/heads/release/');
		const key = `${sha}:${browser}`;
		if (checked.has(key)) continue;
		checked.add(key);
		// Test the pushed tree, including older commits, rather than unrelated working changes.
		const directory = await mkdtemp(join(tmpdir(), 'campus-push-'));
		const archive = execFileSync('git', ['archive', '--format=tar', sha], { maxBuffer: 128 * 1024 * 1024 });
		const pushedLock = execFileSync('git', ['show', `${sha}:pnpm-lock.yaml`]);
		if (!pushedLock.equals(readFileSync('pnpm-lock.yaml'))) {
			throw new Error('Install and validate the pushed lockfile in its own checkout before pushing.');
		}
		const extracted = spawnSync('tar', ['-xf', '-', '-C', directory], { input: archive });
		if (extracted.status !== 0) throw new Error('Cannot prepare the pushed source tree.');
		const dependencies = resolve('node_modules');
		await mkdir(join(directory, 'node_modules'));
		// Kit 3 generates $app here; never share it with another checkout or fixture.
		for (const entry of await readdir(dependencies)) {
			if (entry === '$app' || (entry.startsWith('.') && entry !== '.bin')) continue;
			await symlink(await realpath(join(dependencies, entry)), join(directory, 'node_modules', entry));
		}
		run(['exec', 'svelte-kit', 'sync'], directory);
		run(['lint'], directory);
		if (browser) {
			run(['check:browser'], directory);
			run(['test:browser', '--project=desktop', '--project=mobile'], directory);
		}
	}
};

main().catch((cause: unknown) => {
	console.error(cause instanceof Error ? cause.message : 'Git hook failed.');
	process.exitCode = 1;
});
