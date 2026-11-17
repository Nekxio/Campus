import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);
const preload = fileURLToPath(new URL('../../scripts/prepare-tests.ts', import.meta.url));

test('native test entrypoints isolate the environment before loading the runner and preserve child context', async () => {
	const { stdout } = await execute(
		process.execPath,
		[
			`--import=${preload}`,
			'--input-type=module',
			'--eval',
			`
		import { statSync } from 'node:fs';
		import { homedir } from 'node:os';
		import { spawnSync } from 'node:child_process';
		const child = spawnSync(process.execPath, [
			...process.execArgv.filter((_, index, args) => args[index - 1] !== '--eval' && args[index] !== '--eval'),
			'--eval', 'console.log(JSON.stringify({ value: process.env.TEST_CHILD_VALUE, home: process.env.HOME }))'
		], { env: { ...process.env, TEST_CHILD_VALUE: 'worker-context' }, encoding: 'utf8' });
		if (child.status !== 0) throw new Error(child.stderr);
		console.log(JSON.stringify({
			privatePresent: 'TEST_PRIVATE_SENTINEL' in process.env,
			nodeOptionsPresent: 'NODE_OPTIONS' in process.env,
			mode: process.env.NODE_ENV,
			home: process.env.HOME,
			nativeHome: homedir(),
			temp: process.env.TMPDIR,
			homeMode: statSync(process.env.HOME).mode & 0o777,
			args: process.argv.slice(1),
			child: JSON.parse(child.stdout)
		}));
		`,
			'--',
			'forwarded-option'
		],
		{
			env: { PATH: process.env.PATH, TEST_PRIVATE_SENTINEL: 'fictional', NODE_OPTIONS: '--no-warnings' },
			timeout: 10000
		}
	);
	const result = JSON.parse(stdout);
	assert.equal(result.privatePresent, false);
	assert.equal(result.nodeOptionsPresent, false);
	assert.equal(result.mode, 'test');
	assert.equal(result.home, result.nativeHome);
	assert.equal(result.homeMode, 0o700);
	assert.deepEqual(result.args, ['forwarded-option']);
	assert.deepEqual(result.child, { value: 'worker-context', home: result.home });
	assert.equal(existsSync(result.home), false);
	assert.equal(existsSync(result.temp), false);
});
