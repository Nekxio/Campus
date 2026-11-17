import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

export type ProductionEnvironment = Readonly<Record<string, string | undefined>>;

// Stable production origin; configuration alone does not prove deployment.
export const productionWorkerName = 'campus-mds';
export const expectedProductionOrigin = `https://${productionWorkerName}.leohilaire-1f7.workers.dev`;

// Deliberately allowlist the current local config: new infrastructure needs a separate review.
const sourceConfig = z.strictObject({
	$schema: z.string(),
	// The local development Worker keeps its name; production has an independent explicit target.
	name: z.string().min(1),
	compatibility_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	compatibility_flags: z.tuple([z.literal('nodejs_compat')]),
	main: z.literal('.svelte-kit/cloudflare/_worker.js'),
	assets: z.strictObject({
		binding: z.literal('ASSETS'),
		directory: z.literal('.svelte-kit/cloudflare')
	}),
	durable_objects: z.strictObject({
		bindings: z.tuple([
			z.strictObject({
				name: z.literal('QUIZ_ROOMS'),
				class_name: z.literal('QuizRoom')
			})
		])
	}),
	exports: z.strictObject({
		QuizAuthorization: z.strictObject({ type: z.literal('worker') }),
		QuizRoom: z.strictObject({
			type: z.literal('durable-object'),
			storage: z.literal('sqlite')
		})
	}),
	placement: z.strictObject({ region: z.literal('gcp:europe-west1') }),
	workers_dev: z.literal(true),
	preview_urls: z.literal(false)
});

export function validateRelease(settings: ProductionEnvironment, checkedOutSha: string) {
	if (
		settings.GITHUB_EVENT_NAME !== 'push' ||
		settings.GITHUB_REF !== 'refs/heads/main' ||
		settings.GITHUB_REPOSITORY?.toLowerCase() !== 'nekxio/campus'
	) {
		throw new Error('Production : push sur main de Nekxio/Campus uniquement.');
	}
	if (
		!settings.GITHUB_SHA?.match(/^[a-f0-9]{40}$/) ||
		settings.COURSELY_CHECKED_SHA !== settings.GITHUB_SHA ||
		checkedOutSha !== settings.GITHUB_SHA
	) {
		throw new Error('Production : le checkout doit correspondre au commit vérifié par la CI.');
	}
	if (settings.COURSELY_QUALITY_RESULT !== 'success') {
		throw new Error('Production : les vérifications du même commit doivent réussir.');
	}
	if (settings.COURSELY_PRODUCTION_ENABLED !== 'true') {
		throw new Error('Production désactivée : renseigner COURSELY_PRODUCTION_ENABLED après préparation.');
	}
}

export async function checkCurrentMain(settings: ProductionEnvironment, request = fetch) {
	if (
		settings.GITHUB_REPOSITORY?.toLowerCase() !== 'nekxio/campus' ||
		!settings.GITHUB_SHA?.match(/^[a-f0-9]{40}$/) ||
		!settings.GITHUB_TOKEN
	) {
		throw new Error('Vérification de main : contexte GitHub incomplet.');
	}
	let body: unknown;
	try {
		// Fixed GitHub destination and no redirects: the job token never reaches another origin.
		const response = await request('https://api.github.com/repos/Nekxio/Campus/git/ref/heads/main', {
			headers: {
				Authorization: 'Bearer ' + settings.GITHUB_TOKEN,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2026-03-10'
			},
			redirect: 'error',
			signal: AbortSignal.timeout(10000)
		});
		if (!response.ok) throw new Error('GitHub reference unavailable.');
		body = await response.json();
	} catch {
		throw new Error('Lecture de main impossible ; déploiement bloqué.');
	}
	const parsed = z
		.object({
			ref: z.literal('refs/heads/main'),
			object: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) })
		})
		.safeParse(body);
	if (!parsed.success) throw new Error('Référence main invalide ; déploiement bloqué.');
	return parsed.data.object.sha === settings.GITHUB_SHA;
}

export const productionConfig = (source: unknown, settings: ProductionEnvironment, root: string) => {
	const parsed = sourceConfig.safeParse(source);
	if (!parsed.success) throw new Error('wrangler.jsonc a changé : revoir la projection de production.');
	const account = settings.CLOUDFLARE_ACCOUNT_ID;
	if (!account?.match(/^[a-f0-9]{32}$/) || /^(.)\1+$/.test(account)) {
		throw new Error('Renseigner CLOUDFLARE_ACCOUNT_ID avec le compte vérifié.');
	}
	const origin = settings.COURSELY_PRODUCTION_ORIGIN;
	if (origin !== expectedProductionOrigin) {
		throw new Error(
			'Renseigner COURSELY_PRODUCTION_ORIGIN avec l’origine prévue ' + expectedProductionOrigin + ', sans slash final.'
		);
	}
	return {
		name: productionWorkerName,
		account_id: account,
		compatibility_date: parsed.data.compatibility_date,
		compatibility_flags: parsed.data.compatibility_flags,
		main: resolve(root, parsed.data.main),
		assets: { binding: 'ASSETS', directory: resolve(root, parsed.data.assets.directory) },
		durable_objects: parsed.data.durable_objects,
		exports: parsed.data.exports,
		placement: parsed.data.placement,
		workers_dev: true,
		preview_urls: false,
		keep_vars: false,
		vars: { ORIGIN: origin },
		secrets: { required: ['BETTER_AUTH_SECRET', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'] },
		observability: {
			enabled: true,
			redact_query_string: true,
			logs: { enabled: true, head_sampling_rate: 0.1, invocation_logs: true },
			traces: { enabled: true, head_sampling_rate: 0.01 }
		}
	};
};

export function productionSecrets(settings: ProductionEnvironment) {
	// Never include rejected values or Zod issues in errors/logs.
	if (!settings.BETTER_AUTH_SECRET || settings.BETTER_AUTH_SECRET.length < 32) {
		throw new Error('BETTER_AUTH_SECRET manque ou fait moins de 32 caractères.');
	}
	if (!settings.TURSO_AUTH_TOKEN?.trim()) throw new Error('TURSO_AUTH_TOKEN manque.');
	const url = z.url().safeParse(settings.TURSO_DATABASE_URL);
	if (!url.success) throw new Error('TURSO_DATABASE_URL manque ou est invalide.');
	const parsed = new URL(url.data);
	if (
		!['libsql:', 'https:'].includes(parsed.protocol) ||
		!parsed.hostname.endsWith('.turso.io') ||
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash ||
		parsed.port ||
		(parsed.pathname !== '' && parsed.pathname !== '/') ||
		/your-|example|demo|localhost/i.test(parsed.hostname)
	)
		throw new Error('TURSO_DATABASE_URL doit désigner la base Turso de production vérifiée.');
	return {
		BETTER_AUTH_SECRET: settings.BETTER_AUTH_SECRET,
		TURSO_DATABASE_URL: url.data,
		TURSO_AUTH_TOKEN: settings.TURSO_AUTH_TOKEN
	};
}

async function main() {
	const command = process.argv[2];
	if (command === 'validate-release') {
		validateRelease(process.env, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
		console.log('Push main, checkout et CI du même commit validés.');
	} else if (command === 'check-current-main') {
		if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT est requis.');
		const current = await checkCurrentMain(process.env);
		await appendFile(process.env.GITHUB_OUTPUT, `current=${current}\n`);
		console.log(current ? 'Le commit est toujours en tête de main.' : 'Main a avancé : ancien déploiement ignoré.');
	} else if (command === 'prepare') {
		const path = resolve('.wrangler/production/wrangler.json');
		// This source file is intentionally JSON, despite its jsonc extension. No env file is read.
		const config = productionConfig(JSON.parse(await readFile('wrangler.jsonc', 'utf8')), process.env, process.cwd());
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, JSON.stringify(config, null, '\t') + '\n');
		console.log('Configuration locale prête : .wrangler/production/wrangler.json');
	} else if (command === 'secrets') {
		// Used only by the production job, after the secret-free build, dry run and current-main check.
		if (!process.env.RUNNER_TEMP) throw new Error('RUNNER_TEMP est requis pour le fichier éphémère.');
		const secrets = productionSecrets(process.env);
		await writeFile(resolve(process.env.RUNNER_TEMP, 'campus-production-secrets.json'), JSON.stringify(secrets), {
			mode: 0o600,
			flag: 'wx'
		});
		console.log('Fichier de secrets éphémère prêt ; valeurs non affichées.');
	} else {
		throw new Error('Usage : tsx scripts/production.ts <validate-release|check-current-main|prepare|secrets>');
	}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch((cause: unknown) => {
		console.error(cause instanceof Error ? cause.message : 'Préparation de production impossible.');
		process.exitCode = 1;
	});
}
