import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { testEnvironment } from '../../scripts/test-environment.ts';

const require = createRequire(import.meta.url);
const wrangler = createRequire(require.resolve('wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare');
const execute = promisify(execFile);

test(
	'the Cloudflare adapter initializes routes before requests and preserves quiz Durable Object exports',
	{ timeout: 30_000 },
	async () => {
		const root = process.cwd();
		const directory = await mkdtemp(join(tmpdir(), 'campus-quiz-adapter-'));
		const environment = {
			...testEnvironment(process.env, directory),
			NODE_ENV: 'production',
			WRANGLER_SEND_METRICS: 'false',
			WRANGLER_LOG_PATH: join(directory, 'wrangler.log'),
			CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false'
		};
		await mkdir(join(directory, 'home'));
		await mkdir(join(directory, 'temp'));
		await mkdir(join(directory, 'src/routes'), { recursive: true });
		await mkdir(join(directory, 'src/lib/server/quizzes'), { recursive: true });
		await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
		await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
		await writeFile(join(directory, 'wrangler.jsonc'), await readFile(join(root, 'wrangler.jsonc')));
		await writeFile(
			join(directory, 'vite.config.ts'),
			`import { sveltekit } from '@sveltejs/kit/vite';
import { quizCloudflareAdapter } from ${JSON.stringify(join(root, 'scripts/cloudflare-adapter.ts'))};
export default { plugins: [sveltekit({ adapter: quizCloudflareAdapter() })] };`
		);
		await writeFile(
			join(directory, 'src/lib/server/quizzes/room.ts'),
			`export { QuizRoom } from ${JSON.stringify(join(root, 'src/lib/server/quizzes/room.ts'))};`
		);
		await writeFile(
			join(directory, 'src/lib/server/quizzes/authorization-worker.ts'),
			`export { QuizAuthorization } from ${JSON.stringify(join(root, 'src/lib/server/quizzes/authorization-worker.ts'))};`
		);
		await writeFile(
			join(directory, 'src/app.html'),
			'<!doctype html><html><head>%sveltekit.head%</head><body><div>%sveltekit.body%</div></body></html>'
		);
		await writeFile(
			join(directory, 'src/env.ts'),
			`import { defineEnvVars } from '@sveltejs/kit/env';
export const variables = defineEnvVars({ FIXTURE_STARTUP: { schema: (value) => value ?? '' } });`
		);
		await writeFile(
			join(directory, 'src/routes/+server.ts'),
			`import { FIXTURE_STARTUP } from '$app/env/private';
const binding = FIXTURE_STARTUP;
const initialization = globalThis.fixtureRequestActive ? 'request' : 'startup';
export const GET = () => new Response('quiz-adapter-proof', {
	headers: { 'x-fixture-initialization': initialization, 'x-fixture-binding': binding }
});`
		);
		await writeFile(
			join(directory, 'src/hooks.server.ts'),
			`export const handle = ({ event, resolve }) => {
	globalThis.fixtureRequestActive = true;
	return resolve(event);
};`
		);
		await mkdir(join(directory, 'src/routes/course'), { recursive: true });
		await writeFile(
			join(directory, 'src/routes/course/+page.server.ts'),
			`const initialization = globalThis.fixtureRequestActive ? 'load-request' : 'load-startup';
export const load = () => ({ initialization });`
		);
		await writeFile(
			join(directory, 'src/routes/course/+page.svelte'),
			`<script module>
	const initialization = globalThis.fixtureRequestActive ? 'page-request' : 'page-startup';
</script>
<script>
	let { data } = $props();
</script>
<p>{initialization} {data.initialization}</p>`
		);
		const options = { cwd: directory, env: environment, maxBuffer: 2 * 1024 * 1024 };
		await execute(
			process.execPath,
			[join(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), 'build'],
			options
		);
		const entry = await readFile(join(directory, '.svelte-kit/cloudflare/_worker.js'), 'utf8');
		assert.match(entry, /export\s*\{\s*QuizRoom\s*\}/);
		assert.match(entry, /export\s*\{\s*QuizAuthorization\s*\}/);
		await execute(
			process.execPath,
			[
				join(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js'),
				'deploy',
				'--dry-run',
				'--outdir',
				join(directory, 'bundle'),
				'--env-file=/dev/null'
			],
			options
		);
		const bundled = await readFile(join(directory, 'bundle/_worker.js'), 'utf8');
		const runtime = new Miniflare(
			convertV4MiniflareOptions({
				name: 'quiz-adapter-proof',
				modules: true,
				compatibilityDate: '2026-10-11',
				compatibilityFlags: ['nodejs_compat'],
				bindings: { FIXTURE_STARTUP: 'initialized-environment' },
				script: bundled,
				cf: false,
				durableObjects: { QUIZ_ROOMS: { className: 'QuizRoom', useSQLite: true } },
				serviceBindings: { ASSETS: () => new Response(null, { status: 404 }) },
				outboundService: () => {
					throw new Error('Adapter proof must not contact an external service.');
				}
			})
		);
		try {
			const response = await runtime.dispatchFetch('http://localhost/');
			assert.equal(response.status, 200, await response.clone().text());
			assert.equal(await response.text(), 'quiz-adapter-proof');
			assert.equal(response.headers.get('x-fixture-initialization'), 'startup');
			assert.equal(response.headers.get('x-fixture-binding'), 'initialized-environment');
			const page = await runtime.dispatchFetch('http://localhost/course');
			assert.equal(page.status, 200);
			assert.match(await page.text(), /page-startup load-startup/);
			const rooms = await runtime.getDurableObjectNamespace('QUIZ_ROOMS');
			const refused = await rooms.getByName(crypto.randomUUID()).fetch('http://localhost/', {
				headers: { Upgrade: 'websocket' }
			});
			assert.equal(refused.status, 403);
		} finally {
			await runtime.dispose();
		}
	}
);
