import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import {
	chmod,
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	readdir,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const roots = ['src', 'static', 'drizzle'];
const configFiles = [
	'package.json',
	'vite.config.ts',
	'tsconfig.json',
	'wrangler.jsonc',
	'worker-configuration.d.ts',
	'scripts/cloudflare-adapter.ts'
];
export const adapterPath = 'src/lib/server/db/index.ts';
export type CopyManifest = {
	directory: string;
	databasePath: string;
	files: Record<string, { original: string; copied: string }>;
	override: typeof adapterPath;
};
export const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function requireOwnedOrigin(value: string, origin: string) {
	const url = new URL(value);
	if (url.origin !== origin || url.hostname !== 'localhost' || url.protocol !== 'http:')
		throw new Error('Only the owned loopback origin is permitted.');
}
export function fixtureEnvironment(
	overrides: Readonly<Record<string, string>>,
	source: Readonly<Record<string, string | undefined>> = process.env
): Record<string, string> {
	const refused = () => new Error('Owned fixture environment required.');
	function value(settings: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
		const descriptor = Object.getOwnPropertyDescriptor(settings, name);
		if (!descriptor) return undefined;
		if (!('value' in descriptor)) throw refused();
		const stored: unknown = descriptor.value;
		if (typeof stored !== 'string') throw refused();
		return stored;
	}
	try {
		const owner = process.getuid?.();
		function directory(path: string, privateRoot = false) {
			if (!isAbsolute(path) || owner === undefined) throw refused();
			const info = lstatSync(path);
			if (
				!info.isDirectory() ||
				info.isSymbolicLink() ||
				info.uid !== owner ||
				(privateRoot && (info.mode & 0o077) !== 0)
			)
				throw refused();
			return realpathSync(path);
		}
		const environment: Record<string, string> = {};
		for (const name of ['HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP']) {
			const path = value(source, name);
			if (!path) throw refused();
			environment[name] = path;
		}
		const { HOME: home, TMPDIR: temp } = environment;
		if (
			home !== environment.USERPROFILE ||
			temp !== environment.TMP ||
			temp !== environment.TEMP ||
			dirname(resolve(home)) !== dirname(resolve(temp))
		)
			throw refused();
		// Both launchers allocate sibling HOME/TMP directories below a private, owned root.
		const root = directory(dirname(resolve(home)), true);
		const homePath = directory(home);
		const tempPath = directory(temp);
		if (homePath === tempPath || dirname(homePath) !== root || dirname(tempPath) !== root) throw refused();
		for (const [name, fallback] of [
			['XDG_CONFIG_HOME', '.config'],
			['XDG_CACHE_HOME', '.cache']
		]) {
			let path = value(source, name);
			if (path === undefined) {
				// The test environment supplies no XDG paths: allocate only inside its verified HOME.
				path = join(home, fallback);
				try {
					mkdirSync(path, { mode: 0o700 });
				} catch (cause) {
					if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'EEXIST') throw refused();
				}
			}
			const contained = relative(root, directory(path));
			if (!contained || contained === '..' || contained.startsWith(`..${sep}`) || isAbsolute(contained))
				throw refused();
			environment[name] = path;
		}
		for (const name of ['PATH', 'LANG', 'LC_ALL', 'CI']) {
			const inherited = value(source, name);
			if (inherited !== undefined) environment[name] = inherited;
		}
		const allowedOverrides = [
			'ORIGIN',
			'BETTER_AUTH_SECRET',
			'TURSO_DATABASE_URL',
			'TURSO_AUTH_TOKEN',
			'WRANGLER_SEND_METRICS',
			'WRANGLER_LOG_PATH'
		];
		for (const name of Object.getOwnPropertyNames(overrides)) {
			if (!allowedOverrides.includes(name)) throw refused();
			const explicit = value(overrides, name);
			if (explicit === undefined) throw refused();
			environment[name] = explicit;
		}
		return environment;
	} catch {
		throw refused();
	}
}
export async function copyFixture(sourceRoot: string, allocated?: (directory: string) => void): Promise<CopyManifest> {
	const parent = resolve(sourceRoot, '.svelte-kit/browser-fixture');
	await mkdir(parent, { recursive: true, mode: 0o700 });
	const directory = await mkdtemp(join(parent, 'run-'));
	allocated?.(directory);
	try {
		await chmod(directory, 0o700);
		const files: CopyManifest['files'] = {};
		async function copy(relative: string) {
			const source = join(sourceRoot, relative);
			const info = await lstat(source);
			if (info.isSymbolicLink()) throw new Error('Fixture source symlinks are forbidden.');
			if (info.isDirectory()) {
				await mkdir(join(directory, relative), { recursive: true });
				for (const name of await readdir(source)) {
					if (
						name.startsWith('.env') ||
						name.startsWith('.dev.vars') ||
						/\.(?:pem|key|p12|pfx|db)(?:-shm|-wal)?$/i.test(name) ||
						['.git', '.agents', '.codex', '.impeccable', 'data'].includes(name)
					)
						throw new Error('Private source files are forbidden.');
					await copy(join(relative, name));
				}
			} else {
				await mkdir(dirname(join(directory, relative)), { recursive: true });
				await copyFile(source, join(directory, relative));
				const original = hash(await readFile(source));
				files[relative] = { original, copied: hash(await readFile(join(directory, relative))) };
			}
		}
		for (const relative of [...roots, ...configFiles]) await copy(relative);
		// Kit 3 writes $app types inside node_modules. Keep those files request-fixture local,
		// so parallel fixtures cannot overwrite the project's or each other's generated types.
		const dependencies = join(sourceRoot, 'node_modules');
		await mkdir(join(directory, 'node_modules'));
		for (const entry of await readdir(dependencies, { withFileTypes: true })) {
			if (entry.name === '$app' || entry.name.startsWith('.')) continue;
			const target = await realpath(join(dependencies, entry.name));
			await symlink(
				target,
				join(directory, 'node_modules', entry.name),
				(await lstat(target)).isDirectory() ? 'dir' : 'file'
			);
		}
		const databasePath = join(directory, 'fictional.db');
		await writeFile(databasePath, '', { mode: 0o600, flag: 'wx' });
		const databaseUrl = pathToFileURL(databasePath).href;
		await writeFile(
			join(directory, adapterPath),
			`import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';
const allocatedUrl = ${JSON.stringify(databaseUrl)};
export function createDatabase(client: Client) { return drizzle(client, { schema }); }
export function validateTursoSettings(url: string, authToken: string) {
	if (url !== allocatedUrl || !authToken) throw new Error('Only the allocated fictional database is permitted.');
}
export function createTursoClient(url: string, authToken: string) {
	validateTursoSettings(url, authToken);
	return createClient({ url });
}
export type Database = ReturnType<typeof createDatabase>;
`
		);
		files[adapterPath].copied = hash(await readFile(join(directory, adapterPath)));
		// Only the launch configuration is extended; copied source files stay byte-for-byte exact.
		await writeFile(
			join(directory, 'vite.fixture.config.mjs'),
			`import { mergeConfig } from 'vite';
import base from './vite.config.ts';
export default mergeConfig(base, { cacheDir: ${JSON.stringify(join(directory, '.vite-cache'))}, server: { fs: { allow: ${JSON.stringify([directory, await realpath(dependencies)])} } } });
`,
			{ mode: 0o600 }
		);
		const manifest: CopyManifest = { directory, databasePath, files, override: adapterPath };
		await writeFile(join(directory, 'fixture-manifest.json'), JSON.stringify(manifest), {
			mode: 0o600
		});
		return manifest;
	} catch (cause) {
		await rm(directory, { recursive: true, force: true });
		throw cause;
	}
}
