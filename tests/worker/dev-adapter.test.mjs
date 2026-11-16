import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import WebSocket from 'ws';
import { testEnvironment } from '../../scripts/test-environment.ts';

const require = createRequire(import.meta.url);
const nextMessage = (socket, matches = () => true) =>
	new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			socket.off('message', listener);
			reject(new Error('Timed out waiting for the real quiz dev WebSocket.'));
		}, 5000);
		const listener = (raw) => {
			const value = JSON.parse(String(raw));
			if (!matches(value)) return;
			clearTimeout(timeout);
			socket.off('message', listener);
			resolve(value);
		};
		socket.on('message', listener);
		socket.once('error', (cause) => {
			clearTimeout(timeout);
			socket.off('message', listener);
			reject(cause);
		});
	});

test(
	'the dev adapter refuses direct RPC and preserves Kit HTTP and authenticated quiz upgrades',
	{ timeout: 30_000 },
	async () => {
		const root = process.cwd();
		const directory = await mkdtemp(join(tmpdir(), 'campus-quiz-dev-'));
		const runId = crypto.randomUUID();
		const runtimeFile = join(directory, 'quiz-runtime.json');
		await mkdir(join(directory, 'home'));
		await mkdir(join(directory, 'temp'));
		await mkdir(join(directory, 'src/lib/server/quizzes'), { recursive: true });
		await mkdir(join(directory, 'src/routes/api/teaching/quiz-rooms/[runId]'), { recursive: true });
		await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
		await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
		await writeFile(
			join(directory, 'wrangler.jsonc'),
			JSON.stringify({
				name: 'campus-quiz-dev-test',
				main: '.svelte-kit/cloudflare/_worker.js',
				compatibility_date: '2026-10-11',
				compatibility_flags: ['nodejs_compat'],
				durable_objects: { bindings: [{ name: 'QUIZ_ROOMS', class_name: 'QuizRoom' }] },
				exports: { QuizRoom: { type: 'durable-object', storage: 'sqlite' } }
			})
		);
		await writeFile(
			join(directory, 'vite.config.ts'),
			`import { writeFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { quizCloudflareAdapter } from ${JSON.stringify(join(root, 'scripts/cloudflare-adapter.ts'))};
const getNamespace = Miniflare.prototype.getDurableObjectNamespace;
Miniflare.prototype.getDurableObjectNamespace = async function (...args) {
	const namespace = await getNamespace.apply(this, args);
	if (args[0] === 'QUIZ_ROOMS') {
		await writeFile(${JSON.stringify(runtimeFile)}, JSON.stringify({
			origin: (await this.ready).origin,
			id: namespace.idFromName(${JSON.stringify(runId)}).toString()
		}), { mode: 0o600 });
	}
	return namespace;
};
export default { plugins: [sveltekit({ adapter: quizCloudflareAdapter() })] };`
		);
		await writeFile(
			join(directory, 'src/lib/server/quizzes/room.ts'),
			`export { QuizRoom } from ${JSON.stringify(join(root, 'src/lib/server/quizzes/room.ts'))};`
		);
		await writeFile(
			join(directory, 'src/app.html'),
			'<!doctype html><html><head>%sveltekit.head%</head><body><div>%sveltekit.body%</div></body></html>'
		);
		const participantId = crypto.randomUUID();
		const questionId = crypto.randomUUID();
		const correctId = crypto.randomUUID();
		const actor = {
			kind: 'participant',
			participantId,
			credentialHash: 'a'.repeat(64),
			connectionId: crypto.randomUUID()
		};
		const input = {
			id: runId,
			shuffleSeed: 'fictional-dev-seed',
			createdAt: Date.now(),
			roster: [{ id: participantId, name: 'Fictional Student' }],
			content: {
				version: 1,
				title: 'Dev quiz',
				durationSeconds: 60,
				questions: [
					{
						id: questionId,
						type: 'single',
						prompt: 'Choose one',
						code: '',
						codeLanguage: '',
						options: [
							{ id: correctId, text: 'Correct' },
							{ id: crypto.randomUUID(), text: 'Other' }
						],
						correctOptionIds: [correctId]
					}
				]
			}
		};
		await writeFile(
			join(directory, 'src/routes/+server.ts'),
			`import { env } from 'cloudflare:workers';
export const GET = () => new Response('quiz-dev-http-proof');
export const POST = async () => {
	const room = env.QUIZ_ROOMS.getByName(${JSON.stringify(runId)});
	const uninitialized = await room.rpc({ method: 'teacherState' });
	if (uninitialized.ok || uninitialized.error.code !== 'quiz_room_not_initialized') throw new Error('The room RPC error envelope was lost.');
	try {
		await room.teacherState();
		throw new Error('A new quiz room must be uninitialized.');
	} catch (cause) {
		if (!(cause instanceof Error) || !cause.message.includes('quiz_room_not_initialized')) throw cause;
	}
	await room.initialize(${JSON.stringify(input)});
	await room.command(${JSON.stringify(actor)}, { type: 'join', requestId: crypto.randomUUID() });
	await room.command({ kind: 'teacher' }, { type: 'start', requestId: crypto.randomUUID() });
	return Response.json({ ready: true });
};`
		);
		await writeFile(
			join(directory, 'src/routes/api/teaching/quiz-rooms/[runId]/+server.ts'),
			`import { env } from 'cloudflare:workers';
export const GET = async ({ request, params }) => {
	if (request.headers.get('x-fictional-authorization') !== 'allowed') return new Response(null, { status: 403 });
	const room = env.QUIZ_ROOMS.getByName(params.runId);
	return room.fetch(new Request('https://quiz-room.internal/socket', { headers: {
		Upgrade: 'websocket', 'x-campus-quiz-actor': ${JSON.stringify(JSON.stringify(actor))},
		'x-campus-quiz-expires-at': String(Date.now() + 60000)
	} }));
};`
		);
		const reservation = createServer();
		reservation.listen(0, '127.0.0.1');
		await once(reservation, 'listening');
		const port = reservation.address().port;
		await new Promise((resolve) => reservation.close(resolve));
		const environment = {
			...testEnvironment(process.env, directory),
			NODE_ENV: 'development',
			WRANGLER_SEND_METRICS: 'false',
			WRANGLER_LOG_PATH: join(directory, 'wrangler.log'),
			CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false'
		};
		const server = spawn(
			process.execPath,
			[
				join(dirname(require.resolve('vite/package.json')), 'bin/vite.js'),
				'--host',
				'127.0.0.1',
				'--port',
				String(port),
				'--strictPort'
			],
			{ cwd: directory, env: environment, stdio: ['ignore', 'pipe', 'pipe'] }
		);
		let output = '';
		server.stdout.on('data', (data) => {
			output += data;
		});
		server.stderr.on('data', (data) => {
			output += data;
		});
		let socket;
		try {
			const origin = `http://127.0.0.1:${port}`;
			let ready = false;
			for (let attempt = 0; attempt < 60; attempt++) {
				if (server.exitCode !== null) throw new Error(output);
				try {
					ready = (await fetch(origin)).ok;
				} catch {
					/* The owned server is still starting. */
				}
				if (ready) break;
				await delay(100);
			}
			assert.ok(ready, output);
			assert.doesNotMatch(
				output,
				/no such Durable Object class is exported|internal Durable Objects|bindings are at the top level/
			);
			assert.equal(await (await fetch(origin)).text(), 'quiz-dev-http-proof');
			const initialized = await fetch(origin, { method: 'POST' });
			assert.equal(initialized.status, 200, (await initialized.text()) + output);
			const runtime = JSON.parse(await readFile(runtimeFile, 'utf8'));
			assert.notEqual(new URL(runtime.origin).port, String(port));
			const teacherState = JSON.stringify({ id: runtime.id, method: 'teacherState', args: [] });
			for (const request of [
				{ method: 'POST', body: teacherState },
				{
					method: 'POST',
					headers: { Origin: 'https://foreign.example.test', 'Content-Type': 'text/plain' },
					body: teacherState
				},
				{
					method: 'POST',
					headers: { 'x-coursely-quiz-development': '0'.repeat(64) },
					body: teacherState
				},
				{
					method: 'POST',
					body: JSON.stringify({
						id: runtime.id,
						method: 'command',
						args: [{ kind: 'teacher' }, { type: 'close', requestId: crypto.randomUUID() }]
					})
				},
				{ method: 'POST', body: JSON.stringify({ id: runtime.id, method: 'purge', args: [] }) },
				{ method: 'POST', body: '[' },
				{ method: 'GET' }
			]) {
				const response = await fetch(new URL('/rpc', runtime.origin), request);
				assert.equal(response.status, 403, 'Direct development RPC must require its private capability.');
				assert.equal(await response.text(), '');
			}
			const wrongPath = await fetch(new URL('/other', runtime.origin), { method: 'POST', body: teacherState });
			assert.equal(wrongPath.status, 403);
			assert.equal(await wrongPath.text(), '');
			const path = `ws://127.0.0.1:${port}/api/teaching/quiz-rooms/${runId}`;
			const rejected = new WebSocket(path);
			const refusal = new Promise((resolve, reject) => {
				rejected.once('unexpected-response', (_request, response) => {
					response.resume();
					resolve(response.statusCode);
				});
				rejected.once('open', () => reject(new Error('The Kit authorization route was bypassed.')));
			});
			rejected.on('error', () => {});
			assert.equal(await refusal, 403);
			rejected.terminate();
			socket = new WebSocket(path, { headers: { 'x-fictional-authorization': 'allowed' } });
			socket.on('error', () => {});
			socket.on('open', () => {
				output += '\nBrowser WebSocket opened.\n';
			});
			socket.on('message', () => {
				output += '\nBrowser WebSocket received a frame.\n';
			});
			socket.once('unexpected-response', (_request, response) => {
				let body = '';
				response.on('data', (data) => {
					body += data;
				});
				response.once('end', () =>
					socket.emit('error', new Error(`Upgrade returned ${response.statusCode}: ${body}\n${output}`))
				);
			});
			const first = await nextMessage(socket);
			output += '\nInitial state received.\n';
			assert.equal(first.type, 'state');
			assert.equal(first.view.status, 'running');
			assert.doesNotMatch(JSON.stringify(first), /correctOptionIds|credentialHash/);
			const saved = {
				type: 'save_answers',
				requestId: crypto.randomUUID(),
				version: 1,
				answers: [{ questionId, optionIds: [correctId] }]
			};
			const acknowledgement = nextMessage(socket, (value) => value.type === 'ack');
			socket.send(JSON.stringify(saved));
			const ack = await acknowledgement;
			assert.equal(ack.receipt.answerVersion, 1);
			assert.deepEqual(ack.view.participant.answers, saved.answers);
		} catch (cause) {
			throw new Error((cause instanceof Error ? cause.message : String(cause)) + '\n' + output, {
				cause
			});
		} finally {
			socket?.terminate();
			server.kill('SIGTERM');
			if (server.exitCode === null && server.signalCode === null) await once(server, 'exit');
		}
	}
);
