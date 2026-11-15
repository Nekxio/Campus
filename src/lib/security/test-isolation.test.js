import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import net, { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { resolveConfig } from 'vite';
import config from '../../../vitest.config.ts';
import { testEnvironment } from '../../../scripts/test-environment.ts';
import { listenLoopbackFixture } from '../../../scripts/test-loopback.mjs';

const networkBlocked = 'CAMPUS_TEST_NETWORK_BLOCKED';
const fileBlocked = 'CAMPUS_TEST_PRIVATE_FILE_BLOCKED';

// The identical matrix runs in the worker and in a real synchronously preloaded child.
async function negativeMatrix(origin) {
	// Keep the serialized probe independent of Vite's dynamic-import rewriting.
	const fs = process.getBuiltinModule('node:fs');
	const net = process.getBuiltinModule('node:net');
	const http = process.getBuiltinModule('node:http');
	const https = process.getBuiltinModule('node:https');
	const tls = process.getBuiltinModule('node:tls');
	const dgram = process.getBuiltinModule('node:dgram');
	const dns = process.getBuiltinModule('node:dns');
	const { join, resolve } = process.getBuiltinModule('node:path');
	const { pathToFileURL } = process.getBuiltinModule('node:url');
	const results = {};
	async function rejected(name, run) {
		try {
			await run();
			results[name] = 'NOT_BLOCKED';
		} catch (error) {
			results[name] = error.message;
		}
	}
	const port = Number(new URL(origin).port);
	const network = {
		'fetch-hostname': () => fetch('http://hostile.example.test'),
		'fetch-ip': () => fetch('http://192.0.2.1'),
		'fetch-request': () => fetch(new Request('https://hostile.example.test')),
		'fetch-unregistered': () => fetch('http://127.0.0.1:1'),
		'fetch-localhost': () => fetch(`http://localhost:${port}`),
		'fetch-dispatcher': () => fetch(origin, { dispatcher: {} }),
		'http-string': () => http.request('http://hostile.example.test'),
		'http-url': () => http.get(new URL('http://192.0.2.1')),
		'http-options': () => http.get({ host: 'hostile.example.test', port: 80 }),
		'http-url-overload': () => http.request(origin, { hostname: 'hostile.example.test' }),
		'http-host-overload': () => http.get(origin, { host: 'hostile.example.test' }),
		'http-unregistered': () => http.get({ hostname: '127.0.0.1', port: 1 }),
		'http-agent': () => http.get(origin, { agent: new http.Agent() }),
		'http-default-agent': () =>
			http.get(origin, {
				_defaultAgent: {
					constructor() {
						throw new Error('NATIVE_CALLED');
					}
				}
			}),
		'http-on-socket': () =>
			http.request(origin, {
				onSocket() {
					throw new Error('NATIVE_CALLED');
				}
			}),
		'http-connection': () =>
			http.get(origin, {
				createConnection() {
					throw new Error('NATIVE_CALLED');
				}
			}),
		'http-unix': () => http.get({ socketPath: '/fictional/not-owned.pipe', path: '/' }),
		https: () => https.get(origin.replace('http:', 'https:')),
		'net-port-host': () => net.connect(80, 'hostile.example.test'),
		'net-create': () => net.createConnection({ host: '192.0.2.1', port: 80 }),
		'net-default-host': () => net.connect(port),
		'net-other-ip': () => net.connect(port, '127.0.0.2'),
		'net-unregistered': () => net.connect(1, '127.0.0.1'),
		'socket-host': () => new net.Socket().connect(80, 'hostile.example.test'),
		'socket-options': () => new net.Socket().connect({ host: '192.0.2.1', port: 80 }),
		'socket-path': () => net.connect('/fictional/not-owned.pipe'),
		'socket-lookup': () =>
			net.connect({
				host: '127.0.0.1',
				port,
				lookup() {
					throw new Error('NATIVE_CALLED');
				}
			}),
		tls: () => tls.connect(port, '127.0.0.1'),
		'tls-socket': () => new tls.TLSSocket().connect(port, '127.0.0.1'),
		udp: () => dgram.createSocket('udp4'),
		'listen-public': () => net.createServer().listen(0, '0.0.0.0'),
		'listen-unregistered': () => http.createServer().listen(0, '127.0.0.1'),
		'listen-unix': () => net.createServer().listen('/fictional/not-owned.pipe'),
		'dns-lookup': () => dns.lookup('hostile.example.test', () => {}),
		'dns-numeric': () => dns.lookup('127.0.0.1', () => {}),
		'dns-all': () => dns.lookup('hostile.example.test', { all: true }, () => {}),
		'dns-promises-lookup': () => dns.promises.lookup('hostile.example.test', { all: true })
	};
	for (const [name, run] of Object.entries(network)) await rejected(name, run);
	for (const [label, resolver] of [
		['dns', dns],
		['promises', dns.promises],
		['resolver', new dns.Resolver()],
		['promises-resolver', new dns.promises.Resolver()]
	]) {
		const names = new Set([
			...Object.getOwnPropertyNames(resolver),
			...Object.getOwnPropertyNames(Object.getPrototypeOf(resolver))
		]);
		for (const name of names) {
			if (/^(?:resolve|reverse|lookupService)/.test(name) && typeof resolver[name] === 'function') {
				await rejected(`${label}-${name}`, () => resolver[name]('hostile.example.test', () => {}));
			}
		}
	}
	const files = {};
	const base = join(process.env.HOME, 'fictional-does-not-exist');
	for (const suffix of [
		'.env',
		'.env.local',
		'.dev.vars',
		'.dev.vars.test',
		'.aws/config',
		'.ssh/id_ed25519',
		'privatekeys/fictional',
		'credentialstores/fictional',
		'fictional.pem',
		'fictional.key',
		'.npmrc'
	]) {
		const file = join(base, suffix);
		for (const [encoding, value] of [
			['string', file],
			['url', pathToFileURL(file)],
			['buffer', Buffer.from(file)]
		]) {
			for (const [operation, run] of [
				['sync', () => fs.readFileSync(value)],
				['open-sync', () => fs.openSync(value, 'r')],
				['callback', () => fs.readFile(value, () => {})],
				['stream', () => fs.createReadStream(value)],
				['promise', () => fs.promises.readFile(value)],
				['open-promise', () => fs.promises.open(value, 'r')]
			]) {
				const key = `file-${suffix}-${encoding}-${operation}`;
				await rejected(key, run);
				files[key] = results[key];
				delete results[key];
			}
		}
	}
	for (const value of [
		resolve('data/fictional-does-not-exist'),
		pathToFileURL(resolve('data/fictional-does-not-exist')),
		Buffer.from(resolve('data/fictional-does-not-exist'))
	]) {
		await rejected(`private-data-${Object.keys(files).length}`, () => fs.promises.readdir(value));
		const key = `private-data-${Object.keys(files).length}`;
		files[key] = results[key];
		delete results[key];
	}
	return { network: results, files };
}

function runChild(env, code, args = [], timeoutMs = 15000) {
	const child = spawn(process.execPath, [...args, '-e', code], {
		env,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let stdout = '',
		stderr = '';
	child.stdout.setEncoding('utf8').on('data', (value) => {
		stdout += value;
	});
	child.stderr.setEncoding('utf8').on('data', (value) => {
		stderr += value;
	});
	const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
	const result = once(child, 'close')
		.then(([status]) => ({ status, stdout, stderr }))
		.finally(() => clearTimeout(timeout));
	return { child, result };
}

function get(url, options) {
	return new Promise((resolve, reject) => {
		const request = http.get(url, options, (response) => {
			let body = '';
			response.setEncoding('utf8').on('data', (chunk) => {
				body += chunk;
			});
			response.on('end', () => resolve(body));
		});
		request.on('error', reject);
	});
}

function expectMatrix(matrix) {
	expect(Object.keys(matrix.network).length).toBeGreaterThan(70);
	expect(new Set(Object.values(matrix.network))).toEqual(new Set([networkBlocked]));
	expect(Object.keys(matrix.files).length).toBeGreaterThan(190);
	expect(new Set(Object.values(matrix.files))).toEqual(new Set([fileBlocked]));
}

describe('isolation des tests unitaires', () => {
	it('ne lit que les variables héritées explicitement permises', () => {
		const source = { PATH: '/fictional/bin', CI: '1', NODE_ENV: 'production' };
		for (const name of ['BETTER_AUTH_SECRET', 'TURSO_AUTH_TOKEN', 'NODE_OPTIONS', 'VITE_PRIVATE'])
			Object.defineProperty(source, name, {
				get() {
					throw new Error('Une variable privée ne doit pas être lue.');
				}
			});
		expect(testEnvironment(source, '/fictional/unit')).toMatchObject({
			PATH: '/fictional/bin',
			CI: '1',
			NODE_ENV: 'test',
			HOME: '/fictional/unit/home',
			TMPDIR: '/fictional/unit/temp'
		});
		expect(Object.keys(testEnvironment(source, '/fictional/unit'))).not.toContain('BETTER_AUTH_SECRET');
	});

	it('transmet au processus enfant uniquement les descripteurs propres permis et les vrais répertoires possédés', async () => {
		const directory = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'campus-env-probe-')));
		const environment = testEnvironment({ PATH: process.env.PATH, CI: '1' }, directory);
		for (const value of [environment.HOME, environment.TMPDIR]) fs.mkdirSync(value, { mode: 0o700 });
		for (const [name, sub] of [
			['XDG_CONFIG_HOME', 'config'],
			['XDG_CACHE_HOME', 'cache']
		]) {
			environment[name] = join(directory, sub);
			fs.mkdirSync(environment[name], { mode: 0o700 });
		}
		environment.ORIGIN = 'http://localhost:43123';
		for (const name of [
			'BETTER_AUTH_SECRET',
			'TURSO_AUTH_TOKEN',
			'NODE_OPTIONS',
			'VITE_PRIVATE',
			'LANG',
			'CAMPUS_TEST_CAPABILITY'
		])
			Object.defineProperty(environment, name, {
				enumerable: true,
				get() {
					throw new Error('PRIVATE_GETTER');
				}
			});
		Object.setPrototypeOf(environment, {
			LC_ALL: 'fictional-inherited-must-not-propagate',
			PRIVATE_INHERITED: 'fictional'
		});
		let running;
		try {
			running = runChild(
				environment,
				`process.stdout.write(JSON.stringify({ keys: Object.keys(process.env), mode: process.env.NODE_ENV,
				home: process.env.HOME, homedir: require('node:os').homedir(), temp: process.env.TMPDIR,
				config: process.env.XDG_CONFIG_HOME, cache: process.env.XDG_CACHE_HOME, origin: process.env.ORIGIN,
				options: process.env.NODE_OPTIONS, ci: process.env.CI }));`
			);
			const result = await running.result;
			expect(result.status, result.stderr).toBe(0);
			const received = JSON.parse(result.stdout);
			expect(received).toMatchObject({
				mode: 'test',
				home: environment.HOME,
				homedir: environment.HOME,
				temp: environment.TMPDIR,
				config: environment.XDG_CONFIG_HOME,
				cache: environment.XDG_CACHE_HOME,
				origin: environment.ORIGIN,
				ci: '1'
			});
			expect(received.options).toMatch(/^--require ".*test-isolation\.mjs"$/);
			for (const name of [
				'BETTER_AUTH_SECRET',
				'TURSO_AUTH_TOKEN',
				'VITE_PRIVATE',
				'LANG',
				'LC_ALL',
				'PRIVATE_INHERITED',
				'CAMPUS_TEST_CAPABILITY'
			])
				expect(received.keys).not.toContain(name);
			expect(fs.existsSync(directory)).toBe(true);
		} finally {
			running?.child.kill('SIGKILL');
			fs.rmSync(directory, { recursive: true, force: true });
		}
	});

	it('alloue puis nettoie un environnement possédé si les répertoires sont absents ou invalides', async () => {
		for (const supplied of [{}, { HOME: '/fictional/not-a-directory', ORIGIN: 'https://hostile.example.test' }]) {
			const source = Object.create({
				get PATH() {
					throw new Error('INHERITED_GETTER');
				}
			});
			Object.assign(source, supplied);
			Object.defineProperty(source, 'NODE_OPTIONS', {
				enumerable: true,
				get() {
					throw new Error('PRIVATE_GETTER');
				}
			});
			Object.defineProperty(source, 'BETTER_AUTH_SECRET', {
				enumerable: true,
				get() {
					throw new Error('PRIVATE_GETTER');
				}
			});
			const running = runChild(
				source,
				`const fs = require('node:fs'), path = require('node:path');
				const names = ['HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME'];
				const dirs = Object.fromEntries(names.map(name => [name, process.env[name]]));
				process.stdout.write(JSON.stringify({ dirs, originAbsent: process.env.ORIGIN === undefined,
					privateAbsent: process.env.BETTER_AUTH_SECRET === undefined, homedir: require('node:os').homedir(),
					owned: Object.values(dirs).every(value => { const stat = fs.lstatSync(value); return stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.geteuid() && !(stat.mode & 0o077); }) }));`
			);
			try {
				const result = await running.result;
				expect(result.status, result.stderr).toBe(0);
				const received = JSON.parse(result.stdout);
				expect(received).toMatchObject({ owned: true, privateAbsent: true, originAbsent: true });
				expect(received.homedir).toBe(received.dirs.HOME);
				expect(received.dirs.USERPROFILE).toBe(received.dirs.HOME);
				expect(received.dirs.TMP).toBe(received.dirs.TMPDIR);
				expect(received.dirs.TEMP).toBe(received.dirs.TMPDIR);
				expect(new Set(Object.values(received.dirs).map(dirname)).size).toBe(1);
				expect(fs.existsSync(dirname(received.dirs.HOME))).toBe(false);
			} finally {
				running.child.kill('SIGKILL');
			}
		}
	});

	it('désactive les fichiers d’environnement dans la configuration Vite résolue', async () => {
		const reads = vi.spyOn(fs, 'readFileSync');
		try {
			const resolved = await resolveConfig({ ...config, configFile: false }, 'serve', 'test');
			expect(resolved.envDir).toBe(false);
			expect(reads.mock.calls.some(([value]) => /(?:^|[/\\])\.env(?:\.|$)/.test(String(value)))).toBe(false);
		} finally {
			reads.mockRestore();
		}
	});

	it('bloque le réseau et les lectures privées avant les tests', () => {
		expect(() => connect(443, 'example.test')).toThrow(networkBlocked);
		expect(() => fetch('https://example.test')).toThrow(networkBlocked);
		expect(() => fs.readFileSync(join(process.env.HOME, '.env'))).toThrow(fileBlocked);
		expect(() => fs.readdirSync(join(process.env.HOME, '.aws'))).toThrow(fileBlocked);
	});

	it('borne HTTP, fetch et net au serveur explicitement enregistré et vivant', async () => {
		const server = http.createServer((_request, response) => response.end('fictional'));
		const fixture = await listenLoopbackFixture(server);
		try {
			expect(await get(fixture.origin)).toBe('fictional');
			expect(await (await fetch(new Request(fixture.origin))).text()).toBe('fictional');
			const socket = net.createConnection({
				path: null,
				port: Number(new URL(fixture.origin).port),
				host: '127.0.0.1'
			});
			await once(socket, 'connect');
			socket.destroy();
			expectMatrix(await negativeMatrix(fixture.origin));
		} finally {
			await fixture.close();
			await fixture.close();
		}
		expect(() => fetch(fixture.origin)).toThrow(networkBlocked);

		await expect(get(fixture.origin)).rejects.toThrow(networkBlocked);
	});

	it('refuse les agents et sockets HTTP substitués avant leur constructeur ou leur utilisation', async () => {
		let constructors = 0,
			requests = 0;
		const fixture = await listenLoopbackFixture(
			http.createServer((_request, response) => {
				requests++;
				response.end('fictional');
			})
		);
		const other = await listenLoopbackFixture(
			http.createServer((_request, response) => {
				requests++;
				response.end('fictional');
			})
		);
		let req, alien, untracked;
		try {
			const injectedAgent = {
				constructor: function () {
					constructors++;
					throw new Error('NATIVE_CALLED');
				}
			};
			expect(() => http.get(fixture.origin, { _defaultAgent: injectedAgent })).toThrow(networkBlocked);
			expect(constructors).toBe(0);
			req = http.request(fixture.origin);
			req.on('error', () => {});
			const [socket] = await once(req, 'socket');
			if (socket.connecting) await once(socket, 'connect');
			untracked = new net.Socket();
			expect(() => req.onSocket(untracked)).toThrow(networkBlocked);
			alien = net.connect(Number(new URL(other.origin).port), '127.0.0.1');
			await once(alien, 'connect');
			expect(() => req.onSocket(alien)).toThrow(networkBlocked);
			expect(requests).toBe(0);
		} finally {
			req?.destroy();
			alien?.destroy();
			untracked?.destroy();
			await other.close();
			await fixture.close();
		}
	});

	it.each(['revoke', 'tamper'])(
		'bloque end et les vidages HTTP sur des sockets réutilisés dans le même tour après %s',
		async (action) => {
			let requests = 0,
				connections = 0;
			const server = http.createServer((_request, response) => {
				requests++;
				response.end('must not be read');
			});
			server.on('connection', () => {
				connections++;
			});
			const fixture = await listenLoopbackFixture(server);
			const environment = fixture.childEnvironment(process.env);
			let running;
			try {
				running = runChild(
					environment.env,
					`(async () => {
				const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), http = require('node:http');
				const { Writable } = require('node:stream');
				const { once } = require('node:events');
				const sockets = [];
				for (let i = 0; i < 3; i++) {
					const socket = net.connect(${Number(new URL(fixture.origin).port)}, '127.0.0.1');
					socket.on('error', () => {}); await once(socket, 'connect'); sockets.push(socket);
				}
				const payload = 'GET /fictional HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\nConnection: close\\r\\n\\r\\n';
				sockets[2].cork(); sockets[2].write(payload.slice(0, 12)); sockets[2].write(payload.slice(12));
				const req = http.request(${JSON.stringify(fixture.origin)}, { method: 'POST' }); req.on('error', () => {});
				const [requestSocket] = await once(req, 'socket');
				if (requestSocket.connecting) await once(requestSocket, 'connect');
				req.cork(); req.write('fictional');
				const file = path.join(path.dirname(process.env.TMPDIR), 'grant.json');
				if (${JSON.stringify(action)} === 'revoke') fs.unlinkSync(file);
				else { const receipt = JSON.parse(fs.readFileSync(file, 'utf8')); receipt.grant.port = 1; fs.writeFileSync(file, JSON.stringify(receipt)); }
				const denied = [];
				for (const run of [() => sockets[0].end(payload), () => Writable.prototype.end.call(sockets[1], payload),
					() => sockets[2].uncork(), () => req.uncork(), () => req.end('more')]) {
					try { run(); denied.push('NOT_BLOCKED'); } catch (e) { denied.push(e.message); }
				}
				for (const socket of sockets) socket.destroy(); req.destroy();
				process.stdout.write(JSON.stringify(denied));
			})().catch(e => { process.stderr.write(e.message); process.exitCode = 1; });`,
					[],
					3000
				);
				const result = await running.result;
				expect(result.status, result.stderr).toBe(0);
				expect(JSON.parse(result.stdout)).toEqual(Array(5).fill(networkBlocked));
				await new Promise((resolve) => setTimeout(resolve, 40));
				expect(connections).toBe(4);
				expect(requests).toBe(0);
			} finally {
				running?.child.kill('SIGKILL');
				environment.close();
				await fixture.close();
			}
		}
	);

	it('précharge le garde synchrone et vérifie la même matrice dans un enfant sélectionné', async () => {
		const fixture = await listenLoopbackFixture(http.createServer((_request, response) => response.end('fictional')));
		const source = { PATH: process.env.PATH };
		for (const key of [
			'BETTER_AUTH_SECRET',
			'TURSO_AUTH_TOKEN',
			'NODE_OPTIONS',
			'HOME',
			'PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN',
			'PNPM_CONFIG_OFFLINE',
			'PNPM_CONFIG_IGNORE_SCRIPTS',
			'PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS'
		])
			Object.defineProperty(source, key, {
				get() {
					throw new Error('PRIVATE_GETTER');
				}
			});
		const environment = fixture.childEnvironment(source);
		let child;
		try {
			expect(environment.env.NODE_OPTIONS).toMatch(/^--require ".*test-isolation\.mjs"$/);
			expect(environment.env.HOME).not.toBe(process.env.HOME);
			expect(environment.env).toMatchObject({
				PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false',
				PNPM_CONFIG_OFFLINE: 'true',
				PNPM_CONFIG_IGNORE_SCRIPTS: 'true',
				PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: 'false'
			});
			const running = runChild(
				environment.env,
				`(async () => {
				const matrix = await (${negativeMatrix.toString()})(${JSON.stringify(fixture.origin)});
				const body = await (await fetch(${JSON.stringify(fixture.origin)})).text();
				process.stdout.write(JSON.stringify({matrix, body, capability: process.env.CAMPUS_TEST_CAPABILITY, options: process.env.NODE_OPTIONS}));
			})().catch(e => { process.stderr.write(e.message); process.exitCode = 1; });`
			);
			child = running.child;
			const result = await running.result;
			expect(result.status, result.stderr).toBe(0);
			const received = JSON.parse(result.stdout);
			expect(received.body).toBe('fictional');
			expect(received.capability).toBeUndefined();
			expect(received.options).toBe(environment.env.NODE_OPTIONS);
			expectMatrix(received.matrix);
		} finally {
			child?.kill('SIGKILL');
			environment.close();
			environment.close();
			await fixture.close();
		}
	});

	it('refuse les redirections même locales sans contacter leur destination, parent et enfant', async () => {
		let destinationRequests = 0;
		const destination = await listenLoopbackFixture(
			http.createServer((_request, response) => {
				destinationRequests++;
				response.end('must not be read');
			})
		);
		let target = destination.origin;
		const redirect = await listenLoopbackFixture(
			http.createServer((_request, response) => {
				response.writeHead(302, { location: target });
				response.end();
			})
		);
		try {
			for (target of [destination.origin, 'http://127.0.0.1:1', 'https://hostile.example.test']) {
				await expect(fetch(redirect.origin, { redirect: 'follow' })).rejects.toThrow(networkBlocked);
				await expect(get(redirect.origin)).rejects.toThrow(networkBlocked);
				const environment = redirect.childEnvironment(process.env);
				try {
					const result = await runChild(
						environment.env,
						`fetch(${JSON.stringify(redirect.origin)}).then(() => process.exitCode = 1, e => process.stdout.write(e.message))`
					).result;
					expect(result.status, result.stderr).toBe(0);
					expect(result.stdout).toBe(networkBlocked);
				} finally {
					environment.close();
				}
			}
			expect(destinationRequests).toBe(0);
		} finally {
			await redirect.close();
			await destination.close();
		}
	});

	it('refuse les capacités falsifiées, absentes et révoquées avant connexion', async () => {
		let requests = 0;
		const fixture = await listenLoopbackFixture(
			http.createServer((_request, response) => {
				requests++;
				response.end('fictional');
			})
		);
		const environments = [];
		try {
			const valid = fixture.childEnvironment(process.env);
			environments.push(valid);
			const forged = {
				...valid.env,
				CAMPUS_TEST_CAPABILITY: JSON.stringify({
					...JSON.parse(valid.env.CAMPUS_TEST_CAPABILITY),
					token: 'fictional-forged-token'
				})
			};
			expect(() => runChild(forged, 'process.exitCode = 1')).toThrow(networkBlocked);
			const absent = { ...valid.env };
			delete absent.CAMPUS_TEST_CAPABILITY;
			const denied = await runChild(
				absent,
				`try { fetch(${JSON.stringify(fixture.origin)}); process.exitCode = 1; } catch(e) { process.stdout.write(e.message); }`
			).result;
			expect(denied.status, denied.stderr).toBe(0);
			expect(denied.stdout).toBe(networkBlocked);
			valid.revoke();
			expect(() => runChild(valid.env, 'process.exitCode = 1')).toThrow(networkBlocked);
			expect(requests).toBe(0);
		} finally {
			for (const environment of environments) environment.close();
			await fixture.close();
		}
	});

	it('authentifie le port, le propriétaire et les PID du reçu avant tout démarrage enfant', async () => {
		let requests = 0;
		const fixture = await listenLoopbackFixture(
			http.createServer((_request, response) => {
				requests++;
				response.end('fictional');
			})
		);
		try {
			for (const field of ['port', 'owner', 'rootPid', 'pids', 'host', 'directory', 'ipc']) {
				const environment = fixture.childEnvironment(process.env);
				let running;
				try {
					const { directory } = JSON.parse(environment.env.CAMPUS_TEST_CAPABILITY);
					const file = join(directory, 'grant.json');
					const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
					const changes = {
						port: 1,
						owner: process.ppid,
						rootPid: process.pid,
						pids: [process.pid],
						host: '127.0.0.2',
						directory: directory + '-other',
						ipc: { [process.pid]: { dev: 0, ino: 0 } }
					};
					receipt.grant[field] = changes[field];
					fs.writeFileSync(file, JSON.stringify(receipt));
					expect(() => {
						running = runChild(environment.env, 'process.exitCode = 1');
					}).toThrow(networkBlocked);
				} finally {
					if (running) {
						running.child.kill('SIGKILL');
						await running.result;
					}
					environment.close();
				}
			}
			expect(requests).toBe(0);
		} finally {
			await fixture.close();
		}
	});

	it('refuse dans un enfant vivant toute altération du reçu sans contacter un autre endpoint local', async () => {
		let requests = 0,
			destinationRequests = 0;
		const fixture = await listenLoopbackFixture(
			http.createServer((_request, response) => {
				requests++;
				response.end('fictional');
			})
		);
		const destination = await listenLoopbackFixture(
			http.createServer((_request, response) => {
				destinationRequests++;
				response.end('must not be read');
			})
		);
		try {
			for (const field of ['port', 'owner', 'rootPid', 'pids', 'host', 'directory', 'ipc']) {
				const environment = fixture.childEnvironment(process.env);
				let running;
				try {
					running = runChild(
						environment.env,
						`(async () => {
						const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), http = require('node:http');
						await (await fetch(${JSON.stringify(fixture.origin)})).text();
						const file = path.join(path.dirname(process.env.TMPDIR), 'grant.json');
						const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
						const changes = { port: ${Number(new URL(destination.origin).port)}, owner: process.pid,
							rootPid: process.ppid, pids: [...receipt.grant.pids, 1], host: '127.0.0.2',
							directory: receipt.grant.directory + '-other', ipc: { [process.pid]: { dev: 0, ino: 0 } } };
						receipt.grant[${JSON.stringify(field)}] = changes[${JSON.stringify(field)}];
						fs.writeFileSync(file, JSON.stringify(receipt));
						const denied = [];
						for (const run of [() => fetch(${JSON.stringify(fixture.origin)}),
							() => fetch(${JSON.stringify(destination.origin)}),
							() => http.get(${JSON.stringify(fixture.origin)}),
							() => net.connect(${Number(new URL(fixture.origin).port)}, '127.0.0.1')]) {
							try { run(); denied.push('NOT_BLOCKED'); } catch (e) { denied.push(e.message); }
						}
						process.stdout.write(JSON.stringify({ denied, capabilityAbsent: process.env.CAMPUS_TEST_CAPABILITY === undefined }));
					})().catch(e => { process.stderr.write(e.message); process.exitCode = 1; });`,
						[],
						3000
					);
					const result = await running.result;
					expect(result.status, `${field}: ${result.stderr}; ${result.stdout}`).toBe(0);
					const received = JSON.parse(result.stdout);
					expect(received.capabilityAbsent).toBe(true);
					expect(received.denied).toEqual(Array(4).fill(networkBlocked));
				} finally {
					running?.child.kill('SIGKILL');
					environment.close();
				}
			}
			expect(requests).toBe(7);
			expect(destinationRequests).toBe(0);
		} finally {
			await destination.close();
			await fixture.close();
		}
	}, 15000);

	it('révoque aussi un enfant déjà démarré et ne propage pas sa capacité à un autre enfant', async () => {
		const fixture = await listenLoopbackFixture(http.createServer((_request, response) => response.end('fictional')));
		const environment = fixture.childEnvironment(process.env);
		let child;
		try {
			const running = runChild(
				environment.env,
				`(async () => {
				const { spawn } = require('node:child_process');
				const grandchild = spawn(process.execPath, ['-e', 'try { fetch(${JSON.stringify(fixture.origin)}); process.exitCode = 1; } catch (e) { process.stdout.write(e.message); }'], { env: process.env });
				let denied = ''; grandchild.stdout.on('data', chunk => denied += chunk);
				await new Promise(resolve => grandchild.on('close', resolve));
				process.stdout.write(JSON.stringify({ denied, ready: true }) + '\\n');
				setTimeout(() => { try { fetch(${JSON.stringify(fixture.origin)}); process.exitCode = 1; } catch (e) { process.stdout.write(e.message); } }, 500);
			})().catch(() => { process.exitCode = 1; });`
			);
			child = running.child;
			await once(child.stdout, 'data');
			environment.revoke();
			environment.revoke();
			const result = await running.result;
			expect(result.status, result.stderr).toBe(0);
			const [line, denied] = result.stdout.split('\n');
			expect(JSON.parse(line)).toEqual({ denied: networkBlocked, ready: true });
			expect(denied).toBe(networkBlocked);
		} finally {
			child?.kill('SIGKILL');
			environment.close();
			await fixture.close();
		}
	});

	it('admet uniquement le pipe TSX possédé du PID exact et garde son fils avant preflight', async () => {
		const fixture = await listenLoopbackFixture(http.createServer((_request, response) => response.end('fictional')));
		const environment = fixture.childEnvironment(process.env);
		const directory = fs.mkdtempSync(join(tmpdir(), 'campus-tsx-probe-'));
		const probe = join(directory, 'probe.cjs');
		const require = createRequire(import.meta.url);
		const cli = require.resolve('tsx/cli');
		const code = `(async () => {
			const net = require('node:net'), fs = require('node:fs'), path = require('node:path');
			const pipe = path.join(process.env.TMPDIR, 'tsx-' + process.geteuid(), process.ppid + '.pipe');
			const socket = net.connect(pipe); await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); }); socket.destroy();
			const denied = [];
			for (const value of [pipe.replace(process.ppid + '.pipe', process.pid + '.pipe'), pipe + '.other']) {
				try { net.connect(value); } catch(e) { denied.push(e.message); }
			}
			const link = path.join(process.env.TMPDIR, 'linked'); fs.symlinkSync(path.dirname(pipe), link);
			try { net.connect(path.join(link, path.basename(pipe))); } catch(e) { denied.push(e.message); }
			try { net.createServer().listen(pipe); } catch(e) { denied.push(e.message); }
			process.stdout.write(JSON.stringify({ denied, body: await (await fetch(${JSON.stringify(fixture.origin)})).text(), options: process.env.NODE_OPTIONS }));
		})().catch(e => { process.stderr.write(e.message); process.exitCode = 1; });`;
		fs.writeFileSync(probe, code);
		let child;
		try {
			child = spawn(process.execPath, [cli, probe], {
				env: environment.env,
				stdio: ['ignore', 'pipe', 'pipe']
			});
			let stdout = '',
				stderr = '';
			child.stdout.on('data', (chunk) => {
				stdout += chunk;
			});
			child.stderr.on('data', (chunk) => {
				stderr += chunk;
			});
			const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
			let status;
			try {
				[status] = await once(child, 'close');
			} finally {
				clearTimeout(timer);
			}
			expect(status, stderr).toBe(0);
			const received = JSON.parse(stdout);
			expect(received.denied).toEqual(Array(4).fill(networkBlocked));
			expect(received.body).toBe('fictional');
			expect(received.options).toBe(environment.env.NODE_OPTIONS);
			const pipe = join(environment.env.TMPDIR, `tsx-${process.geteuid()}`, `${child.pid}.pipe`);
			expect(fs.existsSync(pipe)).toBe(false);
			expect(() => net.connect(pipe)).toThrow(networkBlocked);
		} finally {
			child?.kill('SIGKILL');
			environment.close();
			await fixture.close();
			fs.rmSync(directory, { recursive: true, force: true });
		}
	}, 20000);
});
