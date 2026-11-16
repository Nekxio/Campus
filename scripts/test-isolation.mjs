import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';

const installed = Symbol.for('campus.test-isolation');
const guardPath = fileURLToPath(import.meta.url);
const capabilityName = 'CAMPUS_TEST_CAPABILITY';
const blocked = () => new Error('CAMPUS_TEST_NETWORK_BLOCKED');
const deny = () => {
	throw blocked();
};

function install() {
	const privateData = fileURLToPath(new URL('../data', import.meta.url));
	function privatePath(value) {
		if (value instanceof URL) value = fileURLToPath(value);
		if (Buffer.isBuffer(value)) value = value.toString();
		if (typeof value !== 'string') return false;
		const resolved = path.resolve(value);
		return (
			resolved === privateData ||
			resolved.startsWith(privateData + path.sep) ||
			resolved
				.split(path.sep)
				.some(
					(part) =>
						/^\.env.*$|^\.dev\.vars.*$/i.test(part) ||
						['.ssh', '.aws', '.gnupg', 'privatekeys', 'credentialstores', '.npmrc', '.netrc'].includes(
							part.toLowerCase()
						)
				) ||
			/\.(?:pem|key|p12|pfx)$/i.test(resolved)
		);
	}
	for (const name of [
		'readFile',
		'readFileSync',
		'open',
		'openSync',
		'createReadStream',
		'readdir',
		'readdirSync',
		'opendir',
		'opendirSync'
	]) {
		const original = fs[name];
		fs[name] = function (value, ...args) {
			if (privatePath(value)) throw new Error('CAMPUS_TEST_PRIVATE_FILE_BLOCKED');
			return original.call(this, value, ...args);
		};
	}
	for (const name of ['readFile', 'open', 'readdir', 'opendir']) {
		const original = fs.promises[name];
		fs.promises[name] = function (value, ...args) {
			if (privatePath(value)) throw new Error('CAMPUS_TEST_PRIVATE_FILE_BLOCKED');
			return original.call(this, value, ...args);
		};
	}

	// Originals never leave this closure, including through the public fixture API.
	const listen = net.Server.prototype.listen;
	const connect = net.Socket.prototype.connect;
	const socketWrites = new Map(
		['write', 'end', '_write', '_writev', '_writeGeneric', '_final'].map((name) => [name, net.Socket.prototype[name]])
	);
	const request = http.request;
	const nativeFetch = globalThis.fetch;
	const spawn = childProcess.spawn;
	const execFileSync = childProcess.execFileSync;
	const fixtures = new Map();
	const leases = new Map();
	const sockets = new Map();
	const socketDestinations = new WeakMap();
	const ipcServers = new Map();
	const require = createRequire(import.meta.url);
	const tsxCli = fs.realpathSync(require.resolve('tsx/cli'));
	const tsxPreflight = path.join(path.dirname(tsxCli), 'preflight.cjs');
	const authenticate = (descriptor, grant) =>
		createHmac('sha256', descriptor.token).update(JSON.stringify(grant)).digest();
	const uid = process.geteuid();
	const liveProcess = (pid) => {
		if (!Number.isSafeInteger(pid) || pid < 1) return false;
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	};
	function noSymlinks(value) {
		if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value) deny();
		let current = path.parse(value).root;
		for (const part of value.slice(current.length).split(path.sep).filter(Boolean)) {
			current = path.join(current, part);
			const stat = fs.lstatSync(current);
			if (stat.isSymbolicLink()) deny();
		}
	}
	function ownedDirectory(value) {
		noSymlinks(value);
		const stat = fs.statSync(value);
		if (!stat.isDirectory() || stat.uid !== uid || stat.mode & 0o077) deny();
		return stat;
	}
	function ownValue(source, name) {
		const descriptor = Object.getOwnPropertyDescriptor(source, name);
		return descriptor && 'value' in descriptor && typeof descriptor.value === 'string' ? descriptor.value : undefined;
	}
	function environmentValues(source) {
		const env = {};
		for (const name of ['PATH', 'LANG', 'LC_ALL', 'CI', 'NO_COLOR', 'FORCE_COLOR', 'TERM']) {
			const value = ownValue(source, name);
			if (value !== undefined) env[name] = value;
		}
		const origin = ownValue(source, 'ORIGIN');
		if (origin !== undefined) {
			try {
				const url = new URL(origin);
				if (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.origin === origin)
					env.ORIGIN = origin;
			} catch {
				/* Non-loopback or malformed values are not inherited. */
			}
		}
		return Object.assign(env, {
			NODE_ENV: 'test',
			NODE_OPTIONS: `--require ${JSON.stringify(guardPath)}`,
			COREPACK_ENABLE_NETWORK: '0',
			PNPM_DISABLE_SELF_UPDATE_CHECK: 'true',
			// Native pnpm executes before JS preloads; prevent automatic installs too.
			PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false',
			PNPM_CONFIG_OFFLINE: 'true',
			PNPM_CONFIG_IGNORE_SCRIPTS: 'true',
			PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: 'false'
		});
	}
	const directoryValues = (directory) => ({
		HOME: path.join(directory, 'home'),
		USERPROFILE: path.join(directory, 'home'),
		TMPDIR: path.join(directory, 'temp'),
		TMP: path.join(directory, 'temp'),
		TEMP: path.join(directory, 'temp'),
		XDG_CONFIG_HOME: path.join(directory, 'config'),
		XDG_CACHE_HOME: path.join(directory, 'cache')
	});
	function allocateDirectories(prefix) {
		const directory = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), prefix));
		try {
			fs.chmodSync(directory, 0o700);
			for (const sub of ['home', 'temp', 'config', 'cache']) fs.mkdirSync(path.join(directory, sub), { mode: 0o700 });
			return {
				directory,
				env: directoryValues(directory),
				cleanup: () => fs.rmSync(directory, { recursive: true, force: true })
			};
		} catch (error) {
			fs.rmSync(directory, { recursive: true, force: true });
			throw error;
		}
	}
	function childDirectories(source) {
		try {
			const env = {};
			for (const name of ['HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP']) {
				const value = ownValue(source, name);
				if (!value) deny();
				env[name] = value;
			}
			const root = path.dirname(env.HOME);
			ownedDirectory(root);
			if (
				env.HOME !== env.USERPROFILE ||
				env.TMPDIR !== env.TMP ||
				env.TMPDIR !== env.TEMP ||
				env.HOME === env.TMPDIR ||
				path.dirname(env.TMPDIR) !== root
			)
				deny();
			function ownedChild(value) {
				noSymlinks(value);
				const info = fs.statSync(value);
				const relative = path.relative(root, value);
				if (
					!info.isDirectory() ||
					info.uid !== uid ||
					info.mode & 0o022 ||
					!relative ||
					relative.startsWith('..') ||
					path.isAbsolute(relative)
				)
					deny();
			}
			ownedChild(env.HOME);
			ownedChild(env.TMPDIR);
			for (const [name, suffix] of [
				['XDG_CONFIG_HOME', '.config'],
				['XDG_CACHE_HOME', '.cache']
			]) {
				let value = ownValue(source, name);
				if (value === undefined) {
					value = path.join(env.HOME, suffix);
					try {
						fs.mkdirSync(value, { mode: 0o700 });
					} catch (error) {
						if (error.code !== 'EEXIST') throw error;
					}
				}
				ownedChild(value);
				env[name] = value;
			}
			return { env, cleanup: () => {} };
		} catch {
			return allocateDirectories('campus-child-');
		}
	}
	function readGrant(descriptor) {
		try {
			const stat = ownedDirectory(descriptor.directory);
			if (stat.dev !== descriptor.dev || stat.ino !== descriptor.ino) deny();
			const file = path.join(descriptor.directory, 'grant.json');
			noSymlinks(file);
			const info = fs.statSync(file);
			if (!info.isFile() || info.uid !== uid || info.mode & 0o077) deny();
			const { grant, mac } = JSON.parse(fs.readFileSync(file, 'utf8'));
			if (
				typeof descriptor.token !== 'string' ||
				!/^[a-f0-9]{64}$/.test(descriptor.token) ||
				typeof mac !== 'string' ||
				!/^[a-f0-9]{64}$/.test(mac) ||
				!timingSafeEqual(Buffer.from(mac, 'hex'), authenticate(descriptor, grant))
			)
				deny();
			if (
				grant.directory !== descriptor.directory ||
				!liveProcess(grant.owner) ||
				grant.host !== '127.0.0.1' ||
				!Number.isInteger(grant.port) ||
				grant.port < 1 ||
				grant.port > 65535 ||
				!Array.isArray(grant.pids)
			)
				deny();
			return grant;
		} catch {
			deny();
		}
	}
	function saveGrant(descriptor, grant) {
		const next = path.join(descriptor.directory, 'next.json');
		// Authenticate every field, including future ones. The key stays in the guard's
		// closure, never in the receipt or the application's environment.
		const receipt = { grant, mac: authenticate(descriptor, grant).toString('hex') };
		fs.writeFileSync(next, JSON.stringify(receipt), { mode: 0o600, flag: 'wx' });
		fs.renameSync(next, path.join(descriptor.directory, 'grant.json'));
	}
	function registered(descriptor) {
		const grant = readGrant(descriptor);
		if (!grant.pids.includes(process.pid)) deny();
		return grant;
	}
	function isTsx() {
		try {
			return fs.realpathSync(process.argv[1]) === tsxCli;
		} catch {
			return false;
		}
	}
	function descendantOf(pid) {
		let current = process.ppid;
		for (let depth = 0; depth < 8 && current > 1; depth++) {
			if (current === pid) return true;
			// pnpm's installed native executable and its shell shim do not execute JS hooks.
			// Inspect only ancestry of this process; never discover/admit arbitrary sockets.
			const output = execFileSync('/bin/ps', ['-o', 'ppid=', '-p', String(current)], {
				env: { PATH: '/usr/bin:/bin', LANG: 'C' },
				encoding: 'utf8',
				timeout: 1000
			});
			current = Number(output.trim());
		}
		return false;
	}
	let inherited;
	if (process.env[capabilityName]) {
		try {
			inherited = JSON.parse(process.env[capabilityName]);
			// spawn returns the exact PID before the new Node process can run application code.
			// A short synchronous rendezvous handles scheduling before that receipt is written.
			for (let attempt = 0; ; attempt++) {
				const grant = readGrant(inherited);
				if (grant.pids.includes(process.pid)) break;
				if (isTsx() && grant.rootPid && descendantOf(grant.rootPid)) {
					grant.pids.push(process.pid);
					saveGrant(inherited, grant);
					break;
				}
				if (attempt === 100) deny();
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
			}
			registered(inherited);
		} catch {
			deny();
		}
	}
	// Merely inheriting process.env never selects a further child.
	delete process.env[capabilityName];
	const endpoint = (host, port) => {
		if (host !== '127.0.0.1' || !/^[1-9]\d*$/.test(String(port)) || Number(port) > 65535) deny();
		const fixture = fixtures.get(Number(port));
		if (fixture?.active && fixture.server.listening)
			return () => {
				if (!fixture.active || !fixture.server.listening) deny();
			};
		if (inherited) {
			const check = () => {
				const grant = registered(inherited);
				if (grant.host !== host || grant.port !== Number(port)) deny();
			};
			check();
			return check;
		}
		deny();
	};
	function track(socket, check) {
		sockets.set(socket, check);
		socket.once('close', () => sockets.delete(socket));
		return socket;
	}
	const pipePath = (directory, pid) => path.join(directory, 'temp', `tsx-${uid}`, `${pid}.pipe`);
	function pipeCheck(value) {
		if (!inherited || value !== pipePath(inherited.directory, process.ppid)) deny();
		const check = () => {
			const grant = registered(inherited);
			const record = grant.ipc?.[process.ppid];
			if (!record || !grant.pids.includes(process.ppid) || !liveProcess(process.ppid)) deny();
			noSymlinks(value);
			const stat = fs.lstatSync(value);
			if (!stat.isSocket() || stat.uid !== uid || stat.dev !== record.dev || stat.ino !== record.ino) deny();
		};
		check();
		return check;
	}
	net.Socket.prototype.connect = function (...args) {
		// Node itself re-enters connect with its normalized-arguments tuple.
		if (Array.isArray(args[0])) args = args[0];
		const first = args[0];
		let check;
		if (typeof first === 'string' && !/^\d+$/.test(first)) check = pipeCheck(first);
		else if (typeof first === 'object' && first !== null) {
			if (first.path != null) check = pipeCheck(first.path);
			else check = endpoint(first.host ?? 'localhost', first.port);
			if (first.lookup || first.socket || first.fd || first.localAddress || first.localPort) deny();
		} else check = endpoint(typeof args[1] === 'string' ? args[1] : 'localhost', first);
		const target =
			typeof first === 'object' && first !== null
				? first.path != null
					? undefined
					: `${first.host ?? 'localhost'}:${Number(first.port)}`
				: /^\d+$/.test(String(first))
					? `${typeof args[1] === 'string' ? args[1] : 'localhost'}:${Number(first)}`
					: undefined;
		socketDestinations.set(this, target);
		track(this, check);
		return connect.apply(this, args);
	};
	net.connect = net.createConnection = (...args) => new net.Socket().connect(...args);
	for (const [name, original] of socketWrites) {
		if (typeof original !== 'function') continue;
		net.Socket.prototype[name] = function (...args) {
			// Only admitted outbound sockets: never impose capability checks on stdio.
			sockets.get(this)?.();
			return original.apply(this, args);
		};
	}
	let binding = false;
	net.Server.prototype.listen = function (...args) {
		const value = typeof args[0] === 'object' ? args[0]?.path : args[0];
		if (!inherited || !isTsx() || value !== pipePath(inherited.directory, process.pid) || ipcServers.has(process.pid))
			deny();
		registered(inherited);
		ownedDirectory(path.dirname(value));
		if (fs.existsSync(value)) deny();
		ipcServers.set(process.pid, this);
		this.once('listening', () => {
			const grant = registered(inherited);
			noSymlinks(value);
			const stat = fs.lstatSync(value);
			grant.ipc[process.pid] = { dev: stat.dev, ino: stat.ino };
			saveGrant(inherited, grant);
		});
		this.once('close', () => {
			ipcServers.delete(process.pid);
			try {
				const grant = registered(inherited);
				delete grant.ipc[process.pid];
				saveGrant(inherited, grant);
			} catch {
				/* Revocation already removed the receipt. */
			}
		});
		return listen.apply(this, args);
	};
	function httpOptions(args) {
		let options;
		if (typeof args[0] === 'string' || args[0] instanceof URL) {
			const url = new URL(args[0]);
			if (url.protocol !== 'http:' || url.username || url.password) deny();
			options = { hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search };
			if (args[1] && typeof args[1] === 'object') Object.assign(options, args[1]);
		} else options = { ...args[0] };
		if (
			(options.protocol && options.protocol !== 'http:') ||
			['_defaultAgent', 'socketPath', 'socket', 'createConnection', 'connection', 'lookup', 'fd', 'onSocket'].some(
				(name) => Object.hasOwn(options, name)
			) ||
			(options.agent && options.agent !== false) ||
			options.defaultPort ||
			(options.host && options.hostname && options.host !== options.hostname)
		)
			deny();
		const check = endpoint(options.hostname ?? options.host ?? 'localhost', options.port ?? 80);
		const target = `${options.hostname ?? options.host ?? 'localhost'}:${Number(options.port ?? 80)}`;
		return { options: { ...options, agent: false }, check, target };
	}
	http.request = function (...args) {
		const { options, check, target } = httpOptions(args);
		check();
		const req = request.call(http, options);
		const onSocket = req.onSocket;
		req.onSocket = function (socket, ...args) {
			check();
			if (!sockets.has(socket) || socketDestinations.get(socket) !== target) deny();
			sockets.get(socket)();
			return onSocket.call(this, socket, ...args);
		};
		for (const name of ['write', 'end', 'flushHeaders']) {
			const original = req[name];
			req[name] = function (...args) {
				check();
				return original.apply(this, args);
			};
		}
		const emit = req.emit;
		req.emit = function (event, ...values) {
			if (event === 'response' && values[0].statusCode >= 300 && values[0].statusCode < 400) {
				values[0].resume();
				req.destroy(blocked());
				return false;
			}
			return emit.call(this, event, ...values);
		};
		const callback = args.at(-1);
		if (typeof callback === 'function') req.once('response', callback);
		return req;
	};
	http.get = (...args) => {
		const req = http.request(...args);
		req.end();
		return req;
	};
	globalThis.fetch = function (input, init) {
		const url = new URL(input instanceof Request ? input.url : input);
		if (url.protocol !== 'http:' || url.username || url.password || init?.dispatcher) deny();
		const check = endpoint(url.hostname, url.port || 80);
		check();
		return nativeFetch(input, { ...init, redirect: 'manual' }).then((response) => {
			check();
			if (response.status >= 300 && response.status < 400) {
				void response.body?.cancel();
				deny();
			}
			return response;
		});
	};
	for (const name of ['request', 'get']) https[name] = deny;
	tls.connect = tls.createServer = tls.TLSSocket.prototype.connect = deny;
	dgram.createSocket =
		dgram.Socket.prototype.connect =
		dgram.Socket.prototype.send =
		dgram.Socket.prototype.bind =
			deny;
	for (const module of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
		for (const name of Object.getOwnPropertyNames(module)) {
			if (/^(?:lookup|resolve|reverse|setServers)/.test(name) && typeof module[name] === 'function')
				module[name] = deny;
		}
	}
	dns.lookup = (hostname, options, callback) => {
		if (!binding || hostname !== '127.0.0.1') deny();
		if (typeof options === 'function') {
			callback = options;
			options = {};
		}
		queueMicrotask(() =>
			options?.all ? callback(null, [{ address: hostname, family: 4 }]) : callback(null, hostname, 4)
		);
	};

	childProcess.spawn = function (command, args, options) {
		if (!Array.isArray(args)) {
			options = args;
			args = [];
		}
		options = { ...options };
		const source = options.env ?? process.env;
		let selected;
		const descriptorText = ownValue(source, capabilityName);
		if (descriptorText) {
			try {
				const descriptor = JSON.parse(descriptorText);
				selected = leases.get(descriptor.token);
				if (
					!selected ||
					selected.used ||
					descriptor.directory !== selected.descriptor.directory ||
					descriptor.dev !== selected.descriptor.dev ||
					descriptor.ino !== selected.descriptor.ino
				)
					deny();
				readGrant(selected.descriptor);
			} catch {
				deny();
			}
		} else if (
			inherited &&
			isTsx() &&
			command === process.execPath &&
			args[0] === '--require' &&
			args[1] === tsxPreflight &&
			ipcServers.has(process.pid)
		) {
			registered(inherited);
			selected = { descriptor: inherited, used: false };
		}
		// Inspect only own data descriptors from a fixed allowlist, never enumerate source.
		const env = environmentValues(source);
		if (selected) {
			const grant = readGrant(selected.descriptor);
			if (options.shell) deny();
			selected.used = true;
			Object.assign(env, directoryValues(selected.descriptor.directory));
			for (const name of ['CAMPUS_MODULE_ROOTS', 'CAMPUS_AGENT_CONFIG_FILE']) {
				const value = ownValue(source, name);
				if (value !== undefined) env[name] = value;
			}
			env[capabilityName] = JSON.stringify(selected.descriptor);
			options.env = env;
			const child = spawn.call(this, command, args, options);
			if (child.pid) {
				grant.rootPid ??= child.pid;
				grant.pids.push(child.pid);
				saveGrant(selected.descriptor, grant);
			}
			return child;
		}
		const directories = childDirectories(source);
		Object.assign(env, directories.env);
		options.env = env;
		try {
			const child = spawn.call(this, command, args, options);
			child.once('error', directories.cleanup);
			child.once('close', directories.cleanup);
			return child;
		} catch (error) {
			directories.cleanup();
			throw error;
		}
	};
	if (inherited) {
		const file = path.join(inherited.directory, 'grant.json');
		fs.watchFile(file, { interval: 25, persistent: false }, () => {
			try {
				registered(inherited);
			} catch {
				for (const socket of sockets.keys()) socket.destroy();
				for (const server of ipcServers.values()) server.close();
				fs.unwatchFile(file);
			}
		});
	}

	/** @param {import('node:http').Server | import('node:net').Server} server */
	async function listenLoopbackFixture(server) {
		if (!(server instanceof net.Server) || server instanceof tls.Server || server.listening) deny();
		const fixture = { server, active: true, leases: new Set(), connections: new Set() };
		server.on('connection', (socket) => {
			fixture.connections.add(socket);
			socket.once('close', () => fixture.connections.delete(socket));
		});
		let port;
		const revoke = () => {
			fixture.active = false;
			fixtures.delete(port);
			for (const lease of fixture.leases) lease.revoke();
			for (const socket of fixture.connections) socket.destroy();
		};
		server.once('close', revoke);
		try {
			await new Promise((resolve, reject) => {
				server.once('error', reject);
				binding = true;
				try {
					listen.call(server, { host: '127.0.0.1', port: 0 }, () => {
						server.removeListener('error', reject);
						resolve();
					});
				} finally {
					binding = false;
				}
			});
			const address = server.address();
			if (!address || typeof address === 'string' || address.address !== '127.0.0.1') deny();
			port = address.port;
			fixtures.set(port, fixture);
		} catch (error) {
			revoke();
			server.close();
			throw error;
		}
		let closing;
		return Object.freeze({
			origin: `http://127.0.0.1:${port}`,
			/** @param {Record<string, string | undefined>} source @param {Record<string, string>} values */
			childEnvironment(source, values = {}) {
				if (!fixture.active || !server.listening) deny();
				const env = environmentValues(source);
				for (const name of Object.keys(values)) {
					if (!['CAMPUS_MODULE_ROOTS', 'CAMPUS_AGENT_CONFIG_FILE'].includes(name)) deny();
					const value = ownValue(values, name);
					if (value === undefined) deny();
					env[name] = value;
				}
				// Short, newly owned roots also fit macOS's Unix socket path limit. This is not
				// an admission of /tmp: only this directory's pinned inode and exact PID pipe count.
				const { directory } = allocateDirectories('campus-fixture-');
				fs.mkdirSync(path.join(directory, 'temp', `tsx-${uid}`), { mode: 0o700 });
				const stat = ownedDirectory(directory);
				const descriptor = {
					directory,
					dev: stat.dev,
					ino: stat.ino,
					token: randomBytes(32).toString('hex')
				};
				const grant = {
					directory,
					owner: process.pid,
					host: '127.0.0.1',
					port,
					rootPid: null,
					pids: [],
					ipc: {}
				};
				saveGrant(descriptor, grant);
				Object.assign(env, directoryValues(directory), {
					[capabilityName]: JSON.stringify(descriptor)
				});
				let disposed = false;
				const lease = {
					descriptor,
					used: false,
					revoke() {
						leases.delete(descriptor.token);
						fs.rmSync(path.join(directory, 'grant.json'), { force: true });
					},
					close() {
						if (disposed) return;
						disposed = true;
						lease.revoke();
						fixture.leases.delete(lease);
						fs.rmSync(directory, { recursive: true, force: true });
					}
				};
				leases.set(descriptor.token, lease);
				fixture.leases.add(lease);
				return Object.freeze({ env, revoke: lease.revoke, close: lease.close });
			},
			close() {
				if (!closing) {
					revoke();
					closing = new Promise((resolve) => server.close(() => resolve()));
				}
				return closing;
			}
		});
	}
	syncBuiltinESMExports();
	return Object.freeze({ listenLoopbackFixture });
}

// Node 26 can synchronously --require this ESM module: deliberately no top-level await.
if (!process[installed]) Object.defineProperty(process, installed, { value: install() });
export const listenLoopbackFixture = process[installed].listenLoopbackFixture;
