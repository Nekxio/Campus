import { constants } from 'node:fs';
import { open, realpath, readdir, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { folderBindingSchema, type FolderBinding } from '../../src/lib/domain/local-module.js';

export async function allowedFolder(folder: string, roots: string[]) {
	if (!isAbsolute(folder)) throw new Error('Use the full absolute path to the module folder.');
	const canonical = await realpath(folder);
	const allowed = await Promise.all(roots.map((root) => realpath(root)));
	if (!allowed.some((root) => canonical === root || canonical.startsWith(root + sep)))
		throw new Error('This folder is outside the configured course roots.');
	return canonical;
}
async function safeRead(path: string, maxBytes: number) {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size > maxBytes)
			throw new Error('Invalid or oversized local binding file.');
		return await handle.readFile('utf8');
	} finally {
		await handle.close();
	}
}
export async function readBinding(folder: string) {
	try {
		return folderBindingSchema.parse(
			JSON.parse(await safeRead(join(folder, '.coursely.json'), 2000000))
		);
	} catch (cause) {
		if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT')
			return null;
		throw new Error(
			'The .coursely.json binding is invalid or unsafe. It has not been overwritten.',
			{ cause }
		);
	}
}
export async function saveBinding(folder: string, value: FolderBinding) {
	const data = folderBindingSchema.parse(value);
	const path = join(folder, '.coursely-' + crypto.randomUUID() + '.tmp');
	const handle = await open(path, 'wx', 0o600);
	try {
		await handle.writeFile(JSON.stringify(data, null, 2) + '\n');
		await handle.sync();
		await handle.close();
		await rename(path, join(folder, '.coursely.json'));
	} catch (cause) {
		await handle.close().catch(() => {});
		await unlink(path).catch(() => {});
		throw cause;
	}
}
export async function withFolderLock<T>(folder: string, operation: () => Promise<T>): Promise<T> {
	const path = join(folder, '.coursely.lock');
	let handle;
	try {
		handle = await open(path, 'wx', 0o600);
	} catch (cause) {
		if (!cause || typeof cause !== 'object' || !('code' in cause) || cause.code !== 'EEXIST')
			throw cause;
		const pid = Number((await safeRead(path, 100)).trim());
		if (!Number.isSafeInteger(pid) || pid < 1)
			throw new Error('Invalid folder lock; no files were overwritten.', { cause });
		try {
			process.kill(pid, 0);
		} catch (owner) {
			if (owner && typeof owner === 'object' && 'code' in owner && owner.code === 'ESRCH') {
				throw new Error(
					'An interrupted import left .coursely.lock. After checking that no import is running, remove only that lock and retry the same request.',
					{ cause: owner }
				);
			}
		}
		throw new Error('Another import is using this module folder. Retry when it finishes.', {
			cause
		});
	}
	try {
		await handle.writeFile(String(process.pid));
		return await operation();
	} finally {
		await handle.close();
		await unlink(path);
	}
}
export async function folderDocuments(folder: string) {
	const files: { path: string; kind: string }[] = [];
	async function visit(dir: string, depth: number) {
		if (files.length >= 200) return;
		for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
			a.name.localeCompare(b.name)
		)) {
			if (files.length >= 200) return;
			if (
				entry.name.startsWith('.') ||
				['node_modules', 'data', 'dist', 'build'].includes(entry.name) ||
				entry.isSymbolicLink()
			)
				continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory() && depth < 3) await visit(path, depth + 1);
			if (
				entry.isFile() &&
				/\.(md|txt|pdf|pptx|odp)$/i.test(entry.name) &&
				!['AGENTS.md', 'SKILL.md'].includes(entry.name)
			)
				files.push({
					path: relative(folder, path),
					kind: entry.name.split('.').at(-1)!.toLowerCase()
				});
			if (files.length >= 200) return;
		}
	}
	await visit(folder, 0);
	return files.slice(0, 200);
}
