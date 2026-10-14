import { createHash } from 'node:crypto';
import {
	chmod,
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const roots = ['src', 'static', 'drizzle'];
const configFiles = [
	'package.json',
	'vite.config.ts',
	'tsconfig.json',
	'wrangler.jsonc',
	'worker-configuration.d.ts'
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
export function fixtureEnvironment(overrides: Record<string, string>) {
	const environment: NodeJS.ProcessEnv = {};
	for (const name of ['PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'CI'])
		if (process.env[name] !== undefined) environment[name] = process.env[name];
	return { ...environment, ...overrides };
}
export async function copyFixture(
	sourceRoot: string,
	allocated?: (directory: string) => void
): Promise<CopyManifest> {
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
				await copyFile(source, join(directory, relative));
				const original = hash(await readFile(source));
				files[relative] = { original, copied: hash(await readFile(join(directory, relative))) };
			}
		}
		for (const relative of [...roots, ...configFiles]) await copy(relative);
		await symlink(join(sourceRoot, 'node_modules'), join(directory, 'node_modules'), 'dir');
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
