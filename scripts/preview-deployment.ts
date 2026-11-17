import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
	expectedProductionOrigin,
	productionConfig,
	productionSecrets,
	type ProductionEnvironment
} from './production.js';

export const previewWorkerName = 'campus-preview';
export const expectedPreviewOrigin = `https://${previewWorkerName}.leohilaire-1f7.workers.dev`;
export const previewDatabaseUrl = 'libsql://campus-dev-nekxio.aws-eu-west-1.turso.io';

export const validatePreview = (settings: ProductionEnvironment, checkout: string) => {
	if (
		settings.GITHUB_REPOSITORY?.toLowerCase() !== 'nekxio/campus' ||
		(settings.GITHUB_REF === 'refs/heads/develop' && settings.GITHUB_REF_PROTECTED !== 'true') ||
		!['push', 'workflow_dispatch'].includes(settings.GITHUB_EVENT_NAME ?? '') ||
		(settings.GITHUB_EVENT_NAME === 'workflow_dispatch' && settings.GITHUB_REF !== 'refs/heads/develop') ||
		!(
			settings.GITHUB_REF === 'refs/heads/develop' ||
			/^refs\/heads\/release\/\d+\.\d+\.\d+$/.test(settings.GITHUB_REF ?? '')
		) ||
		!settings.GITHUB_SHA?.match(/^[a-f0-9]{40}$/) ||
		checkout !== settings.GITHUB_SHA ||
		settings.COURSELY_CHECKED_SHA !== checkout ||
		settings.COURSELY_QUALITY_RESULT !== 'success' ||
		settings.CAMPUS_PREVIEW_ENABLED !== 'true'
	) {
		throw new Error('Preview requires an enabled, successfully checked develop or release commit.');
	}
};

export const previewConfig = (source: unknown, settings: ProductionEnvironment, root: string) => {
	if (settings.CAMPUS_PREVIEW_ORIGIN !== expectedPreviewOrigin)
		throw new Error('CAMPUS_PREVIEW_ORIGIN must match the dedicated preview Worker.');
	const config = productionConfig(source, { ...settings, COURSELY_PRODUCTION_ORIGIN: expectedProductionOrigin }, root);
	return { ...config, name: previewWorkerName, vars: { ORIGIN: expectedPreviewOrigin } };
};

export const previewSecrets = (settings: ProductionEnvironment) => {
	if (settings.CAMPUS_PREVIEW_TURSO_URL !== previewDatabaseUrl)
		throw new Error('Preview requires its dedicated development database.');
	return productionSecrets({
		BETTER_AUTH_SECRET: settings.CAMPUS_PREVIEW_AUTH_SECRET,
		TURSO_DATABASE_URL: settings.CAMPUS_PREVIEW_TURSO_URL,
		TURSO_AUTH_TOKEN: settings.CAMPUS_PREVIEW_TURSO_TOKEN
	});
};

export const checkCurrentPreview = async (settings: ProductionEnvironment, request = fetch) => {
	const branch = settings.GITHUB_REF?.replace('refs/heads/', '');
	if (
		settings.GITHUB_REPOSITORY?.toLowerCase() !== 'nekxio/campus' ||
		!settings.GITHUB_TOKEN ||
		!settings.GITHUB_SHA?.match(/^[a-f0-9]{40}$/) ||
		!(branch === 'develop' || /^release\/\d+\.\d+\.\d+$/.test(branch ?? ''))
	)
		throw new Error('Invalid preview reference.');
	const response = await request(`https://api.github.com/repos/Nekxio/Campus/git/ref/heads/${branch}`, {
		headers: {
			Authorization: `Bearer ${settings.GITHUB_TOKEN}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2026-03-10'
		},
		redirect: 'error',
		signal: AbortSignal.timeout(10000)
	});
	if (!response.ok) throw new Error('Preview reference unavailable; deployment blocked.');
	const reference = z
		.object({ ref: z.literal(`refs/heads/${branch}`), object: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }) })
		.parse(await response.json());
	return reference.object.sha === settings.GITHUB_SHA;
};

export const verifyPreview = async (
	origin: string,
	{
		request = fetch,
		pause = (milliseconds: number) => delay(milliseconds),
		report = console.info
	}: {
		request?: typeof fetch;
		pause?: (milliseconds: number) => Promise<void>;
		report?: (message: string) => void;
	} = {}
) => {
	const fail = (message: string): never => {
		report(message);
		throw new Error(message);
	};
	if (origin !== expectedPreviewOrigin) fail('HTTPS verification requires the dedicated preview origin.');
	const missingId = crypto.randomUUID();
	const routes: [string, number][] = [
		['/connexion', 200],
		['/', 303],
		['/api/session', 401],
		[`/modules/${missingId}`, 404],
		[`/classes/${missingId}`, 404]
	];
	for (const [path, expected] of routes) {
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			report(`Preview HTTPS ${path}: attempt ${attempt}/3`);
			let response: Response | undefined;
			try {
				response = await request(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
			} catch (error) {
				report(
					`Preview HTTPS ${path}: ${error instanceof Error && error.name === 'TimeoutError' ? '15-second timeout' : 'transport failure'}`
				);
			}
			if (response) {
				await response.body?.cancel().catch(() => undefined);
				report(`Preview HTTPS ${path}: HTTP ${response.status}`);
				if (![502, 503, 504].includes(response.status)) {
					if (response.status !== expected)
						fail(`Preview HTTPS ${path}: expected HTTP ${expected}, received ${response.status}.`);
					if (path !== '/connexion' && !response.headers.get('cache-control')?.includes('no-store'))
						fail(`Preview HTTPS ${path}: missing no-store cache protection.`);
					if (path === '/' && response.headers.get('location') !== '/connexion')
						fail(`Preview HTTPS ${path}: anonymous users must redirect to sign-in.`);
					break;
				}
			}
			if (attempt === 3) fail(`Preview HTTPS ${path}: failed after 3 attempts.`);
			await pause(attempt * 1000);
		}
	}
};

const main = async () => {
	const command = process.argv[2];
	const settings = process.env;
	if (command === 'validate')
		validatePreview(settings, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
	else if (command === 'prepare') {
		const config = previewConfig(JSON.parse(await readFile('wrangler.jsonc', 'utf8')), process.env, process.cwd());
		await mkdir('.wrangler/preview', { recursive: true });
		await writeFile('.wrangler/preview/wrangler.json', JSON.stringify(config, null, '\t') + '\n');
	} else if (command === 'current') {
		if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required.');
		await appendFile(process.env.GITHUB_OUTPUT, `current=${await checkCurrentPreview(settings)}\n`);
	} else if (command === 'verify') {
		const config = z
			.object({ vars: z.object({ ORIGIN: z.string() }) })
			.parse(JSON.parse(await readFile('.wrangler/preview/wrangler.json', 'utf8')));
		await verifyPreview(config.vars.ORIGIN);
	} else if (command === 'secrets') {
		if (!process.env.RUNNER_TEMP) throw new Error('RUNNER_TEMP is required.');
		await writeFile(
			resolve(process.env.RUNNER_TEMP, 'campus-preview-secrets.json'),
			JSON.stringify(previewSecrets(process.env)),
			{ mode: 0o600, flag: 'wx' }
		);
	} else throw new Error('Usage: tsx scripts/preview-deployment.ts <validate|prepare|current|verify|secrets>');
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch(() => {
		console.error('Preview command failed; no credentials are logged.');
		process.exitCode = 1;
	});
}
