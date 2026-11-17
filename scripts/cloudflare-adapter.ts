import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { ServerResponse, type IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { join, relative, resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import adapter from '@sveltejs/adapter-cloudflare';
import type { Adapter, AdapterViteConfig } from '@sveltejs/kit';
import { setResponse } from '@sveltejs/kit/node';
import { build } from 'esbuild';
import {
	Miniflare,
	type Response as MiniflareResponse,
	type WebSocket as MiniflareWebSocket,
	convertV4MiniflareOptions,
	coupleWebSocket
} from 'miniflare';
import type { Plugin } from 'vite';
import type { Client } from '@libsql/client/web';
import { unstable_readConfig as readCloudflareConfig } from 'wrangler';
import { WebSocketServer } from 'ws';
import { z } from 'zod';

type PendingUpgrade = { request: IncomingMessage; socket: Socket; head: Buffer };
type DevelopmentNamespace = Awaited<ReturnType<Miniflare['getDurableObjectNamespace']>>;
const developmentUpgradeSockets = new WeakMap<Response, MiniflareWebSocket>();
const developmentRpcMethods = new Set([
	'rpc',
	'initialize',
	'teacherState',
	'participantState',
	'command',
	'createRetake',
	'purge'
]);
const cloudflareConfigSchema = z.object({
	name: z.string(),
	compatibility_date: z.string(),
	compatibility_flags: z.array(z.string()),
	assets: z.object({ directory: z.string().optional() }).passthrough().optional()
});
const developmentConfig = (config: string) => cloudflareConfigSchema.parse(readCloudflareConfig({ config }));

// Kit checks Node's Response brand, whose constructor rejects status 101.
class DevelopmentUpgradeResponse extends Response {
	constructor(response: MiniflareResponse, socket: MiniflareWebSocket) {
		super(null, { headers: Array.from(response.headers) });
		developmentUpgradeSockets.set(this, socket);
	}
	override get status() {
		return 101;
	}
	override get statusText() {
		return 'Switching Protocols';
	}
	override get ok() {
		return false;
	}
}

const developmentNamespace = (
	binding: DevelopmentNamespace,
	invoke: (id: string, method: string, args: unknown[]) => Promise<unknown>
) => {
	const wrap = (stub: ReturnType<DevelopmentNamespace['getByName']>) =>
		new Proxy(stub, {
			get(target, property) {
				if (typeof property === 'string' && developmentRpcMethods.has(property))
					return (...args: unknown[]) => invoke(target.id.toString(), property, args);
				if (property === 'fetch')
					return async (...args: Parameters<typeof stub.fetch>) => {
						const response = await target.fetch(...args);
						if (response.status === 101 && response.webSocket)
							return new DevelopmentUpgradeResponse(response, response.webSocket);
						const reader = response.body?.getReader();
						const body = reader
							? new ReadableStream<Uint8Array>({
									async pull(controller) {
										const result = await reader.read();
										if (result.done) controller.close();
										else {
											const value: unknown = result.value;
											if (value instanceof Uint8Array) controller.enqueue(value);
											else controller.error(new TypeError('A quiz HTTP response must contain bytes.'));
										}
									},
									cancel: (reason) => reader.cancel(reason)
								})
							: null;
						return new Response(body, {
							status: response.status,
							statusText: response.statusText,
							headers: Array.from(response.headers)
						});
					};
				const value: unknown = Reflect.get(target, property);
				const member: unknown = typeof value === 'function' ? value.bind(target) : value;
				return member;
			}
		});
	return new Proxy(binding, {
		get(target, property) {
			if (property === 'getByName')
				return (...args: Parameters<typeof binding.getByName>) => wrap(target.getByName(...args));
			if (property === 'get') return (...args: Parameters<typeof binding.get>) => wrap(target.get(...args));
			const value: unknown = Reflect.get(target, property);
			const member: unknown = typeof value === 'function' ? value.bind(target) : value;
			return member;
		}
	});
};

const developmentPlatform = () => {
	const value: unknown = Reflect.get(globalThis, '__sveltekit_cloudflare_platform');
	if (!value || typeof value !== 'object' || !('env' in value) || !value.env || typeof value.env !== 'object')
		throw new Error('The Cloudflare platform must be initialized before quiz development.');
	return value.env;
};

const quizDevelopment = () => {
	const rpcSecret = randomBytes(32).toString('hex');
	const pending = new WeakMap<ServerResponse, PendingUpgrade>();
	const headers = new WeakMap<IncomingMessage, Headers>();
	let sockets: WebSocketServer | undefined;
	let runtime: Miniflare | undefined;
	let stopWatching: (() => void) | undefined;
	let reloading = Promise.resolve();
	const plugin: Plugin = {
		name: 'campus-quiz-durable-development',
		async configureServer(server) {
			const root = server.config.root;
			const configurationPath = join(root, 'wrangler.jsonc');
			let dependencies = new Set<string>();
			const reload = async () => {
				const configuration = developmentConfig(configurationPath);
				const bundled = await build({
					stdin: {
						contents: `export { QuizRoom } from './src/lib/server/quizzes/room.ts';
import { WorkerEntrypoint } from 'cloudflare:workers';
export class QuizAuthorization extends WorkerEntrypoint {
	async canReadTeacher(input) {
		const response = await this.env.QUIZ_AUTHORIZATION_DEVELOPMENT.fetch(new Request('https://quiz-authorization.internal', {
			method: 'POST', body: JSON.stringify(input)
		}));
		if (!response.ok) throw new Error('Quiz authorization unavailable');
		return response.json();
	}
}
const methods = new Set(${JSON.stringify([...developmentRpcMethods])});
export default {
	async fetch(request, env) {
		if (request.method !== 'POST' || new URL(request.url).pathname !== '/rpc' || request.headers.has('origin'))
			return new Response(null, { status: 403 });
		const expected = env.QUIZ_DEVELOPMENT_RPC_SECRET;
		if (typeof expected !== 'string' || !expected) return new Response(null, { status: 403 });
		const encoder = new TextEncoder();
		const [providedHash, expectedHash] = await Promise.all([
			crypto.subtle.digest('SHA-256', encoder.encode(request.headers.get('x-coursely-quiz-development') ?? '')),
			crypto.subtle.digest('SHA-256', encoder.encode(expected))
		]);
		if (!crypto.subtle.timingSafeEqual(providedHash, expectedHash))
			return new Response(null, { status: 403 });
		try {
			const { id, method, args } = await request.json();
			if (!methods.has(method) || !Array.isArray(args)) return new Response(null, { status: 400 });
			const room = env.QUIZ_ROOMS.get(env.QUIZ_ROOMS.idFromString(id));
			const value = await room[method](...args);
			return Response.json({ ok: true, value });
		} catch (cause) {
			return Response.json({ ok: false, name: cause?.name ?? 'Error', message: cause?.message ?? String(cause) });
		}
	}
};`,
						resolveDir: root
					},
					absWorkingDir: root,
					bundle: true,
					write: false,
					format: 'esm',
					platform: 'browser',
					external: ['cloudflare:workers'],
					metafile: true
				});
				const options = {
					...convertV4MiniflareOptions({
						name: 'campus-quiz-development',
						modules: true,
						script: bundled.outputFiles[0].text,
						compatibilityDate: configuration.compatibility_date,
						compatibilityFlags: configuration.compatibility_flags,
						cf: false,
						bindings: { QUIZ_DEVELOPMENT_RPC_SECRET: rpcSecret },
						durableObjects: { QUIZ_ROOMS: { className: 'QuizRoom', useSQLite: true } },
						serviceBindings: {
							QUIZ_AUTHORIZATION_DEVELOPMENT: async (request) => {
								const runtime = (await server.ssrLoadModule('/src/lib/server/auth/runtime.ts')) as {
									withPrivateClient: <T>(operation: (client: Client) => Promise<T>) => Promise<T>;
								};
								const database = (await server.ssrLoadModule(
									'/src/lib/server/db/index.ts'
								)) as typeof import('../src/lib/server/db/index.js');
								const authorization = (await server.ssrLoadModule(
									'/src/lib/server/quizzes/teacher-authorization.ts'
								)) as typeof import('../src/lib/server/quizzes/teacher-authorization.js');
								const input: unknown = await request.json();
								return Response.json(
									await runtime.withPrivateClient((client) =>
										authorization.isQuizTeacherAuthorized(database.createDatabase(client), input)
									)
								);
							}
						},
						outboundService: () => {
							throw new Error('Quiz Durable Objects must not contact external services.');
						}
					}),
					resourcePersistencePath: join(root, '.wrangler/state/quiz-development')
				};
				if (runtime) await runtime.setOptions(options);
				else runtime = new Miniflare(options);
				const binding = await runtime.getDurableObjectNamespace('QUIZ_ROOMS');
				const worker = runtime;
				// The installed Miniflare RPC proxy loses rejected-call headers; the Worker preserves errors.
				const invoke = async (id: string, method: string, args: unknown[]) => {
					const response = await worker.dispatchFetch('https://quiz-development.internal/rpc', {
						method: 'POST',
						headers: {
							'content-type': 'application/json',
							'x-coursely-quiz-development': rpcSecret
						},
						body: JSON.stringify({ id, method, args })
					});
					const result: unknown = await response.json();
					if (!response.ok || !result || typeof result !== 'object' || !('ok' in result))
						throw new Error('The quiz development RPC transport returned an invalid response.');
					if (result.ok === true) return 'value' in result ? result.value : undefined;
					if (
						result.ok !== false ||
						!('message' in result) ||
						typeof result.message !== 'string' ||
						!('name' in result) ||
						typeof result.name !== 'string'
					)
						throw new Error('The quiz development RPC transport returned an invalid error.');
					const failure = new Error(result.message);
					failure.name = result.name;
					throw failure;
				};
				if (!Reflect.set(developmentPlatform(), 'QUIZ_ROOMS', developmentNamespace(binding, invoke)))
					throw new Error('The quiz development binding could not be installed.');
				dependencies = new Set(Object.keys(bundled.metafile.inputs).map((file) => resolve(root, file)));
				server.watcher.add([...dependencies, configurationPath]);
			};
			await reload();
			sockets = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
			sockets.on('headers', (lines, request) => {
				const extra = headers.get(request);
				if (!extra) return;
				for (const [name, value] of extra)
					if (!name.startsWith('sec-websocket-') && !['connection', 'upgrade', 'set-cookie'].includes(name))
						lines.push(`${name}: ${value}`);
				for (const value of extra.getSetCookie()) lines.push(`set-cookie: ${value}`);
				headers.delete(request);
			});
			const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
				const path = new URL(request.url ?? '/', 'http://localhost').pathname;
				if (!/^\/api\/(?:quizzes\/[^/]+\/rooms\/[^/]+|teaching\/quiz-rooms\/[^/]+)\/?$/.test(path)) return;
				if (!(socket instanceof Socket)) {
					socket.destroy();
					return;
				}
				const response = new ServerResponse(request);
				response.assignSocket(socket);
				socket.on('error', () => {});
				pending.set(response, { request, socket, head });
				// Preserve Kit hooks, teacher auth, public scoping and origin validation.
				server.middlewares.handle(request, response, (cause?: unknown) => {
					if (!response.writableEnded) response.writeHead(cause ? 500 : 404).end();
				});
			};
			server.httpServer?.on('upgrade', upgrade);
			const changed = (file: string) => {
				if (!dependencies.has(file) && file !== configurationPath) return;
				reloading = reloading.then(reload).catch((cause: unknown) => {
					server.config.logger.error(cause instanceof Error ? cause.message : String(cause));
				});
			};
			server.watcher.on('change', changed);
			stopWatching = () => {
				server.watcher.off('change', changed);
				server.httpServer?.off('upgrade', upgrade);
			};
		},
		async closeServer() {
			stopWatching?.();
			for (const socket of sockets?.clients ?? []) socket.terminate();
			sockets?.close();
			await reloading;
			await runtime?.dispose();
		}
	};
	const writeResponse: NonNullable<AdapterViteConfig['setResponse']> = (response, rendered) => {
		const upgrade = pending.get(response);
		if (!upgrade) return setResponse(response, rendered);
		pending.delete(response);
		if (rendered.status !== 101) return setResponse(response, rendered);
		const socket = developmentUpgradeSockets.get(rendered);
		developmentUpgradeSockets.delete(rendered);
		if (!socket || !sockets) {
			response.writeHead(500).end('A quiz upgrade must provide a Cloudflare WebSocket.');
			return;
		}
		response.detachSocket(upgrade.socket);
		headers.set(upgrade.request, rendered.headers);
		sockets.handleUpgrade(upgrade.request, upgrade.socket, upgrade.head, (client) => {
			upgrade.socket.resume();
			void coupleWebSocket(client, socket).catch((cause: unknown) => {
				console.error('Quiz development WebSocket relay failed.', cause);
				client.terminate();
			});
		});
	};
	return { plugin, writeResponse };
};

export const quizCloudflareAdapter = (): Adapter => {
	const proxyConfigPath = resolve('.svelte-kit/quiz-proxy/wrangler.json');
	const cloudflare = adapter({
		platformProxy: { configPath: proxyConfigPath, envFiles: [], remoteBindings: false }
	});
	const development = quizDevelopment();
	const proxyConfig: Plugin = {
		name: 'campus-cloudflare-proxy-config',
		async configureServer(server) {
			const root = server.config.root;
			const config = developmentConfig(join(root, 'wrangler.jsonc'));
			await mkdir(resolve(root, '.svelte-kit/quiz-proxy'), { recursive: true });
			await writeFile(
				proxyConfigPath,
				JSON.stringify({
					name: config.name,
					compatibility_date: config.compatibility_date,
					compatibility_flags: config.compatibility_flags,
					...(config.assets?.directory && {
						assets: { ...config.assets, directory: resolve(root, config.assets.directory) }
					})
				})
			);
		}
	};
	return {
		...cloudflare,
		vite: (context) => {
			const original = typeof cloudflare.vite === 'function' ? cloudflare.vite(context) : cloudflare.vite;
			const plugins = Array.isArray(original?.plugins) ? { pre: original.plugins } : original?.plugins;
			return {
				...original,
				setResponse: development.writeResponse,
				plugins: { ...plugins, pre: [proxyConfig, ...(plugins?.pre ?? []), development.plugin] }
			};
		},
		adapt: async (builder) => {
			await cloudflare.adapt(builder);
			const directory = builder.getBuildDirectory('cloudflare');
			const serverDirectory = builder.getBuildDirectory('cloudflare-tmp');
			const server = relative(directory, resolve(serverDirectory, 'server.js')).split('\\').join('/');
			// Route module evaluation belongs to Worker startup, not the first request's CPU budget.
			await appendFile(
				resolve(serverDirectory, 'server.js'),
				`\nexport const prepareRoutes = async () => {
	await Promise.all([
		...manifest.nodes.map(async (load) => {
			const node = await load();
			await node.component?.();
		}),
		...manifest.routes.map((route) => route.endpoint?.())
	]);
};\n`
			);
			const source = relative(directory, resolve('src/lib/server/quizzes/room.ts')).split('\\').join('/');
			const authorization = relative(directory, resolve('src/lib/server/quizzes/authorization-worker.ts'))
				.split('\\')
				.join('/');
			// Adapter 8 emits only fetch; Wrangler bundles the explicit Durable Object export.
			await appendFile(
				resolve(directory, '_worker.js'),
				`\nimport { prepareRoutes } from ${JSON.stringify(server.startsWith('.') ? server : './' + server)};\n` +
					`await initialized;\nawait prepareRoutes();\n` +
					`export { QuizRoom } from ${JSON.stringify(source.startsWith('.') ? source : './' + source)};\n` +
					`export { QuizAuthorization } from ${JSON.stringify(authorization.startsWith('.') ? authorization : './' + authorization)};\n`
			);
		}
	};
};
