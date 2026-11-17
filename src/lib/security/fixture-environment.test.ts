import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureEnvironment } from '../../../tests/browser/support/fixture-copy.js';

const requiredDirectories = ['HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP'] as const;
const directories = [...requiredDirectories, 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME'] as const;
const privateNames = [
	'BETTER_AUTH_SECRET',
	'TURSO_DATABASE_URL',
	'TURSO_AUTH_TOKEN',
	'DATABASE_URL',
	'CLOUDFLARE_API_TOKEN',
	'AWS_SECRET_ACCESS_KEY',
	'VITE_PRIVATE',
	'NODE_OPTIONS'
];
const refusal = 'Owned fixture environment required.';
const guard = new URL('../../../scripts/test-isolation.mjs', import.meta.url).href;
const guardedNodeOptions = `--require ${JSON.stringify(fileURLToPath(guard))}`;
const macOsInjectedKey = '__CF_USER_TEXT_ENCODING' as const;
const guardedPolicy = {
	NODE_ENV: 'test',
	COREPACK_ENABLE_NETWORK: '0',
	PNPM_DISABLE_SELF_UPDATE_CHECK: 'true',
	PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false',
	PNPM_CONFIG_OFFLINE: 'true',
	PNPM_CONFIG_IGNORE_SCRIPTS: 'true',
	PNPM_CONFIG_MANAGE_PACKAGE_MANAGER_VERSIONS: 'false'
};
const helper = new URL('../../../tests/browser/support/fixture-copy.ts', import.meta.url).href;
const probe = `
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { fixtureEnvironment } from ${JSON.stringify(helper)};
const environment = fixtureEnvironment({ ORIGIN: 'http://localhost:43123' });
const policy = Object.fromEntries(${JSON.stringify(Object.keys(guardedPolicy))}.map(name => [name, process.env[name]]));
const report = { environment, home: homedir(), keys: Object.keys(process.env).sort(), nodeOptions: process.env.NODE_OPTIONS, policy, pid: process.pid, parentPid: process.ppid };
if (process.argv[1] === '1') {
	const child = spawn(process.execPath, [
		'--import', ${JSON.stringify(guard)}, '--input-type=module', '--eval', process.argv[2], '2'
	], { env: environment, stdio: ['ignore', 'pipe', 'pipe'], timeout: 4000, killSignal: 'SIGKILL' });
	let stdout = '';
	let stderr = '';
	let failed = false;
	child.on('error', () => { failed = true; });
	child.stdout.on('data', (chunk) => {
		stdout += chunk;
		if (stdout.length > 65536) child.kill('SIGKILL');
	});
	child.stderr.on('data', (chunk) => {
		stderr += chunk;
		if (stderr.length > 65536) child.kill('SIGKILL');
	});
	const closed = new Promise((done) => child.once('close', (code) => done(code)));
	try {
		const code = await closed;
		if (failed || code !== 0 || stderr) throw new Error('Fixture descendant probe failed.');
		report.next = JSON.parse(stdout);
	} finally {
		if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
		await closed;
	}
}
process.stdout.write(JSON.stringify(report));
`;

type Probe = {
	environment: Record<string, string>;
	home: string;
	keys: string[];
	nodeOptions?: string;
	policy: Record<string, string>;
	pid: number;
	parentPid: number;
	next?: Probe;
};

async function runProbe(environment: Record<string, string>): Promise<Probe> {
	const child = spawn(process.execPath, ['--import', guard, '--input-type=module', '--eval', probe, '1', probe], {
		env: environment,
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 10000,
		killSignal: 'SIGKILL'
	});
	let stdout = '';
	let stderr = '';
	let failed = false;
	child.on('error', () => {
		failed = true;
	});
	child.stdout.on('data', (chunk: Buffer) => {
		stdout += chunk.toString();
		if (stdout.length > 65536) child.kill('SIGKILL');
	});
	child.stderr.on('data', (chunk: Buffer) => {
		stderr += chunk.toString();
		if (stderr.length > 65536) child.kill('SIGKILL');
	});
	const closed = new Promise<number | null>((done) => child.once('close', done));
	try {
		const code = await closed;
		if (failed || code !== 0 || stderr) throw new Error('Fixture child probe failed.');
		return JSON.parse(stdout) as Probe;
	} finally {
		if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
		await closed;
	}
}

describe('environnement possédé des fixtures navigateur', () => {
	let root: string;
	let source: Record<string, string | undefined>;

	beforeEach(() => {
		const temp = process.env.TMPDIR;
		if (!temp) throw new Error('Owned test temporary directory required.');
		root = mkdtempSync(join(temp, 'campus-fixture-environment-'));
		for (const name of ['home', 'temp', 'config', 'cache']) mkdirSync(join(root, name), { mode: 0o700 });
		source = {
			HOME: join(root, 'home'),
			USERPROFILE: join(root, 'home'),
			TMPDIR: join(root, 'temp'),
			TMP: join(root, 'temp'),
			TEMP: join(root, 'temp'),
			XDG_CONFIG_HOME: join(root, 'config'),
			XDG_CACHE_HOME: join(root, 'cache'),
			PATH: '/fictional/bin',
			LANG: 'C.UTF-8',
			LC_ALL: 'C.UTF-8',
			CI: 'true'
		};
	});

	afterEach(() => {
		if (root) rmSync(root, { recursive: true, force: true });
	});

	it('conserve exactement les chemins possédés et la petite allowlist', () => {
		expect(fixtureEnvironment({}, source)).toEqual(source);
	});

	it('ne lit aucun getter privé ni NODE_OPTIONS et ne propage aucune valeur privée', () => {
		const read = vi.fn(() => {
			throw new Error('Private fixture sentinel must not be read.');
		});
		for (const name of privateNames) Object.defineProperty(source, name, { enumerable: true, get: read });
		source.UNRELATED = 'fictional-private-sentinel';
		const environment = fixtureEnvironment({}, source);
		expect(read).not.toHaveBeenCalled();
		expect(Object.keys(environment).sort()).toEqual([...directories, 'PATH', 'LANG', 'LC_ALL', 'CI'].sort());
		expect(Object.values(environment)).not.toContain('fictional-private-sentinel');
	});

	it.each(requiredDirectories)('refuse %s absent sans repli système', (name) => {
		delete source[name];
		expect(() => fixtureEnvironment({}, source)).toThrow(new Error(refusal));
	});

	it.each(directories)('ne lit pas un getter de répertoire %s', (name) => {
		const read = vi.fn(() => '/fictional/user-home-sentinel');
		Object.defineProperty(source, name, { enumerable: true, get: read });
		expect(() => fixtureEnvironment({}, source)).toThrow(new Error(refusal));
		expect(read).not.toHaveBeenCalled();
	});

	it('ignore aussi un HOME utilisateur hérité sans évaluer son getter', () => {
		delete source.HOME;
		const read = vi.fn(() => '/fictional/user-home-sentinel');
		Object.setPrototypeOf(source, Object.defineProperty({}, 'HOME', { get: read }));
		expect(() => fixtureEnvironment({}, source)).toThrow(new Error(refusal));
		expect(read).not.toHaveBeenCalled();
	});

	it.each(directories)('refuse un répertoire %s inexistant avec une erreur neutre', (name) => {
		source[name] = join(root, 'missing-synthetic-directory');
		expect(() => fixtureEnvironment({}, source)).toThrow(new Error(refusal));
	});

	it.each(['HOME', 'TMP', 'XDG_CONFIG_HOME'] as const)('refuse un chemin %s relatif', (name) => {
		source[name] = 'fictional/relative';
		expect(() => fixtureEnvironment({}, source)).toThrow(new Error(refusal));
	});

	it('refuse une racine non privée même si les chemins existent', () => {
		chmodSync(root, 0o755);
		expect(() => fixtureEnvironment({}, source)).toThrow(new Error(refusal));
	});

	it('refuse HOME et TMP confondus', () => {
		for (const name of ['TMPDIR', 'TMP', 'TEMP']) source[name] = source.HOME;
		expect(() => fixtureEnvironment({}, source)).toThrow(new Error(refusal));
	});

	it('refuse un HOME extérieur à la racine du lanceur sans lire de domicile réel', () => {
		source.HOME = root;
		source.USERPROFILE = root;
		expect(() => fixtureEnvironment({}, source)).toThrow(new Error(refusal));
	});

	it('refuse un XDG existant hors de la racine possédée', () => {
		source.XDG_CONFIG_HOME = process.env.TMPDIR;
		expect(() => fixtureEnvironment({}, source)).toThrow(new Error(refusal));
	});

	it('refuse les liens symboliques et les fichiers à la place de répertoires', () => {
		const link = join(root, 'config-link');
		symlinkSync(join(root, 'config'), link, 'dir');
		source.XDG_CONFIG_HOME = link;
		expect(() => fixtureEnvironment({}, source)).toThrow(new Error(refusal));
		const file = join(root, 'not-a-directory');
		writeFileSync(file, 'fictional-only', { mode: 0o600 });
		source.XDG_CONFIG_HOME = file;
		expect(() => fixtureEnvironment({}, source)).toThrow(new Error(refusal));
	});

	it('réalloue seulement les XDG absents sous HOME et conserve les chemins déjà fournis', () => {
		delete source.XDG_CONFIG_HOME;
		const environment = fixtureEnvironment({}, source);
		expect(environment.XDG_CONFIG_HOME).toBe(join(root, 'home', '.config'));
		expect(environment.XDG_CACHE_HOME).toBe(source.XDG_CACHE_HOME);
		expect(fixtureEnvironment({}, environment)).toEqual(environment);
	});

	it('refuse un lien préexistant à la place du XDG de repli', () => {
		delete source.XDG_CONFIG_HOME;
		symlinkSync(join(root, 'config'), join(root, 'home', '.config'), 'dir');
		expect(() => fixtureEnvironment({}, source)).toThrow(new Error(refusal));
	});

	it('accepte uniquement les overrides fictifs explicites utilisés par les deux appelants', () => {
		const overrides = {
			ORIGIN: 'http://localhost:43123',
			BETTER_AUTH_SECRET: 'fictional-auth-secret',
			TURSO_DATABASE_URL: 'file:/fictional/fixture.db',
			TURSO_AUTH_TOKEN: 'fictional-auth-token',
			WRANGLER_SEND_METRICS: 'false',
			WRANGLER_LOG_PATH: join(root, 'fictional.log')
		};
		for (const name of Object.keys(overrides)) source[name] = 'fictional-inherited-private';
		expect(fixtureEnvironment(overrides, source)).toEqual({
			...Object.fromEntries([...directories, 'PATH', 'LANG', 'LC_ALL', 'CI'].map((name) => [name, source[name]])),
			...overrides
		});
	});

	it.each(['NODE_OPTIONS', 'HOME', 'TMPDIR', 'XDG_CONFIG_HOME', 'PATH', 'UNRELATED'])(
		'refuse un override %s sans en lire le getter',
		(name) => {
			const read = vi.fn(() => 'fictional-override');
			const overrides = Object.defineProperty({}, name, { enumerable: true, get: read });
			expect(() => fixtureEnvironment(overrides, source)).toThrow(new Error(refusal));
			expect(read).not.toHaveBeenCalled();
		}
	);

	it('refuse un getter même pour un override explicitement permis', () => {
		const read = vi.fn(() => 'fictional-auth-secret');
		const overrides = Object.defineProperty({}, 'BETTER_AUTH_SECRET', { get: read });
		expect(() => fixtureEnvironment(overrides, source)).toThrow(new Error(refusal));
		expect(read).not.toHaveBeenCalled();
	});

	it('fonctionne avec le lanceur unitaire inchangé et ne réalloue que ses XDG absents', () => {
		const environment = fixtureEnvironment({});
		for (const name of requiredDirectories) expect(environment[name]).toBe(process.env[name]);
		expect(environment.XDG_CONFIG_HOME).toBe(process.env.XDG_CONFIG_HOME ?? join(environment.HOME, '.config'));
		expect(environment.XDG_CACHE_HOME).toBe(process.env.XDG_CACHE_HOME ?? join(environment.HOME, '.cache'));
	});

	it.each([true, false])(
		'préserve les chemins sur deux vrais niveaux de processus (XDG fournis : %s)',
		async (providedXdg) => {
			if (!providedXdg) {
				delete source.XDG_CONFIG_HOME;
				delete source.XDG_CACHE_HOME;
			}
			const read = vi.fn(() => {
				throw new Error('Private fixture sentinel must not be read.');
			});
			for (const name of [...privateNames, macOsInjectedKey])
				Object.defineProperty(source, name, { enumerable: true, get: read });
			const environment = fixtureEnvironment({ ORIGIN: 'http://localhost:43123' }, source);
			expect(read).not.toHaveBeenCalled();
			expect(environment).not.toHaveProperty('NODE_OPTIONS');
			expect(environment).not.toHaveProperty(macOsInjectedKey);
			const child = await runProbe(environment);
			expect(child.next).toBeDefined();
			for (const report of [child, child.next!]) {
				expect(report.environment).toEqual(environment);
				expect(report.home).toBe(environment.HOME);
				// macOS may inject this single key after spawn; the source getter is still forbidden.
				const keys =
					process.platform === 'darwin' ? report.keys.filter((name) => name !== macOsInjectedKey) : report.keys;
				expect(keys).toEqual([...Object.keys(environment), ...Object.keys(guardedPolicy), 'NODE_OPTIONS'].sort());
				expect(report.policy).toEqual(guardedPolicy);
				expect(report.nodeOptions).toBe(guardedNodeOptions);
				for (const name of privateNames) if (name !== 'NODE_OPTIONS') expect(report.keys).not.toContain(name);
			}
			expect(child.pid).not.toBe(process.pid);
			expect(child.parentPid).toBe(process.pid);
			expect(child.next!.pid).not.toBe(child.pid);
			expect(child.next!.parentPid).toBe(child.pid);
			expect(read).not.toHaveBeenCalled();
			expect(environment).not.toHaveProperty('NODE_OPTIONS');
		},
		15000
	);
});
