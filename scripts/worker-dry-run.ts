import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

export const workersFreeBundleBytes = 64 * 1024 * 1024;

export function checkBundleBudget(bytes: number) {
	if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > workersFreeBundleBytes) {
		throw new Error('Bundle absent ou supérieur à la limite Workers Free de 64 Mio non compressés.');
	}
}

const bundleMetadataSchema = z.object({
	inputs: z.record(z.string(), z.unknown()),
	outputs: z.record(z.string(), z.object({ bytes: z.int().nonnegative() }))
});

const isBrowserPdfDependency = (path: string) => /pdfmake|pdfkit|vfs_fonts/.test(path);

export const inspectBundleMetadata = (value: unknown) => {
	const metadata = bundleMetadataSchema.parse(value);
	const inputs = Object.keys(metadata.inputs);
	if (inputs.some((path) => /@libsql\/client\/lib-esm\/node/.test(path))) {
		throw new Error('Adaptateur libSQL Node présent dans le bundle Worker : utiliser libSQL web.');
	}
	if (inputs.some(isBrowserPdfDependency)) {
		throw new Error('Bibliothèque PDF navigateur présente dans le bundle Worker : isoler les imports côté navigateur.');
	}
	const outputs = Object.entries(metadata.outputs).filter(([path]) => !path.endsWith('.map'));
	const bytes = outputs.reduce((total, [, output]) => total + output.bytes, 0);
	checkBundleBudget(bytes);
	return { inputs, bytes };
};

async function main() {
	const config = resolve(process.argv[2] ?? 'wrangler.jsonc');
	for (const directory of new Set([process.cwd(), dirname(config)])) {
		const files = await readdir(directory);
		if (files.some((name) => (name.startsWith('.env') && name !== '.env.example') || name.startsWith('.dev.vars'))) {
			throw new Error('Dry-run refusé : utiliser une copie sans fichiers .env ni .dev.vars.');
		}
	}
	for (const name of [
		'CLOUDFLARE_API_TOKEN',
		'CLOUDFLARE_API_KEY',
		'BETTER_AUTH_SECRET',
		'TURSO_DATABASE_URL',
		'TURSO_AUTH_TOKEN'
	]) {
		if (process.env[name]) throw new Error('Dry-run refusé : retirer les credentials de l’environnement.');
	}
	const directory = resolve('.wrangler/preflight');
	await mkdir(directory, { recursive: true });
	const metadataPath = resolve(directory, 'metafile.json');
	const result = spawnSync(
		process.execPath,
		[
			resolve('node_modules/wrangler/bin/wrangler.js'),
			'deploy',
			'--config',
			config,
			'--dry-run',
			'--outdir',
			resolve(directory, 'bundle'),
			'--metafile',
			metadataPath
		],
		{
			encoding: 'utf8',
			maxBuffer: 10 * 1024 * 1024,
			env: {
				...process.env,
				WRANGLER_SEND_METRICS: 'false',
				CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
				WRANGLER_LOG_PATH: resolve(directory, 'wrangler.log')
			}
		}
	);
	process.stdout.write(result.stdout ?? '');
	process.stderr.write(result.stderr ?? '');
	if (result.error || result.status !== 0) throw new Error('Wrangler dry-run a échoué.');
	const { inputs, bytes } = inspectBundleMetadata(JSON.parse(await readFile(metadataPath, 'utf8')));
	const assets: { path: string; bytes: number }[] = [];
	async function inspectAssets(path: string) {
		for (const entry of await readdir(path, { withFileTypes: true })) {
			if (entry.name === '_worker.js' || entry.name === '.assetsignore') continue;
			const child = resolve(path, entry.name);
			if (entry.isDirectory()) await inspectAssets(child);
			else if (entry.isFile()) assets.push({ path: child, bytes: (await stat(child)).size });
		}
	}
	await inspectAssets(resolve('.svelte-kit/cloudflare'));
	const largestAssetBytes = Math.max(0, ...assets.map((asset) => asset.bytes));
	if (assets.length > 20000 || largestAssetBytes > 25 * 1024 * 1024) {
		throw new Error('Assets supérieurs aux limites Workers Free (20 000 fichiers, 25 Mio/fichier).');
	}
	const summary = {
		uncompressedWorkerBytes: bytes,
		workersFreeBundleBytes,
		assetCount: assets.length,
		largestAssetBytes,
		pdfLibraryBundled: inputs.some(isBrowserPdfDependency),
		cpuAndRemoteResourcesValidated: false
	};
	await writeFile(resolve(directory, 'summary.json'), JSON.stringify(summary, null, '\t') + '\n');
	console.log(JSON.stringify(summary));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch((cause: unknown) => {
		console.error(cause instanceof Error ? cause.message : 'Dry-run impossible.');
		process.exitCode = 1;
	});
}
