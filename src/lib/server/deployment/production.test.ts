import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
	assertFreePricingWindow,
	checkCurrentMain,
	expectedProductionOrigin,
	productionWorkerName,
	productionConfig as createProductionConfig,
	productionSecrets,
	validateRelease
} from '../../../../scripts/production.js';
import { checkBundleBudget, workersFreeBundleBytes } from '../../../../scripts/worker-dry-run.js';
import { authOrigin } from '../auth/config.js';

const source = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const productionConfig = (source: unknown, settings: NodeJS.ProcessEnv, root: string) =>
	createProductionConfig(source, settings, root, new Date('2026-10-16T00:00:00Z'));
// Intended public origin and synthetic account ID for pure validation only. Never deployed.
const target = {
	CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
	COURSELY_PRODUCTION_ORIGIN: expectedProductionOrigin
};
const release = {
	GITHUB_EVENT_NAME: 'push',
	GITHUB_REF: 'refs/heads/main',
	GITHUB_REPOSITORY: 'Nekxio/Coursely',
	GITHUB_SHA: 'a'.repeat(40),
	COURSELY_CHECKED_SHA: 'a'.repeat(40),
	COURSELY_QUALITY_RESULT: 'success',
	COURSELY_PRODUCTION_ENABLED: 'true'
};

describe('production target and automatic release gates', () => {
	it('keeps the supplied HTTPS origin and passkey hostname coherent without bypassing the account gate', () => {
		const origin = authOrigin({
			ORIGIN: expectedProductionOrigin,
			BETTER_AUTH_SECRET: 'fictional-validation-only-secret-'.repeat(2)
		});
		expect(origin).toBe('https://mds.leohilaire-1f7.workers.dev');
		expect(new URL(origin).hostname).toBe('mds.leohilaire-1f7.workers.dev');
		expect(() => productionConfig(source, { COURSELY_PRODUCTION_ORIGIN: origin }, '/tmp')).toThrow(
			'CLOUDFLARE_ACCOUNT_ID'
		);
	});

	it('requires the exact HTTPS Worker origin and verified account without altering local configuration', () => {
		const before = structuredClone(source);
		const config = productionConfig(source, target, '/tmp/production-test');
		expect(source).toEqual(before);
		expect(config.name).toBe('mds');
		expect(new URL(config.vars.ORIGIN).hostname.split('.')[0]).toBe(productionWorkerName);
		expect(config.vars).toEqual({ ORIGIN: target.COURSELY_PRODUCTION_ORIGIN });
		expect(config.main).toBe('/tmp/production-test/.svelte-kit/cloudflare/_worker.js');
		expect(config.assets.directory).toBe('/tmp/production-test/.svelte-kit/cloudflare');
		expect(config).not.toHaveProperty('routes');
		expect(config).not.toHaveProperty('env');
		expect(config).not.toHaveProperty('limits');
		expect(config.preview_urls).toBe(false);
		expect(config.observability.redact_query_string).toBe(true);
		expect(config.secrets.required).toHaveLength(3);
	});

	it('uses mds for production independently of the preserved local Worker name', () => {
		expect(source.name).toBe('coursely');
		expect(productionConfig({ ...source, name: 'mds' }, target, '/tmp').name).toBe('mds');
	});

	it.each([undefined, '', '0'.repeat(32), 'not-an-account'])(
		'refuses a missing or placeholder account: %s',
		(account) => {
			expect(() =>
				productionConfig(source, { ...target, CLOUDFLARE_ACCOUNT_ID: account }, '/tmp')
			).toThrow('CLOUDFLARE_ACCOUNT_ID');
		}
	);

	it.each([
		undefined,
		'',
		'http://localhost:53962',
		'https://coursely.example.workers.dev',
		'https://coursely.demo.workers.dev',
		'https://coursely.synthetic-test-account.workers.dev',
		'https://coursely.leohilaire-1f7.workers.dev',
		'https://mds.leohilaire-1f7.workers.dev/',
		'https://mds.leohilaire-1f7.workers.dev?x=1',
		'https://coursely.synthetic-test-account.workers.dev/',
		'https://coursely.synthetic-test-account.workers.dev?x=1',
		'https://coursely.synthetic-test-account.workers.dev/#token',
		'https://coursely-production.synthetic-test-account.workers.dev',
		'https://coursely.example.org',
		'https://user:password@coursely.account.workers.dev'
	])('refuses an absent, unstable or mismatched production origin: %s', (origin) => {
		expect(() =>
			productionConfig(source, { ...target, COURSELY_PRODUCTION_ORIGIN: origin }, '/tmp')
		).toThrow('COURSELY_PRODUCTION_ORIGIN');
	});

	it('blocks new infrastructure rather than silently propagating it', () => {
		expect(() => productionConfig({ ...source, kv_namespaces: [] }, target, '/tmp')).toThrow(
			'revoir'
		);
	});

	it('allows an enabled main push checked successfully at the same commit without manual inputs', () => {
		expect(() => validateRelease(release, release.GITHUB_SHA)).not.toThrow();
	});

	it.each([
		{ GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/1/merge' },
		{ GITHUB_EVENT_NAME: 'workflow_dispatch' },
		{ GITHUB_EVENT_NAME: 'workflow_run' },
		{ GITHUB_REF: 'refs/heads/develop' },
		{ GITHUB_REF: 'refs/heads/feature/test' },
		{ GITHUB_REF: 'refs/tags/v1' },
		{ GITHUB_REPOSITORY: 'someone/fork' },
		{ COURSELY_CHECKED_SHA: 'b'.repeat(40) },
		{ GITHUB_SHA: '' },
		{ COURSELY_PRODUCTION_ENABLED: undefined },
		{ COURSELY_QUALITY_RESULT: 'failure' },
		{ COURSELY_QUALITY_RESULT: 'cancelled' },
		{ COURSELY_QUALITY_RESULT: 'skipped' }
	])('refuses a release outside the successful main push contract: %j', (override) => {
		expect(() => validateRelease({ ...release, ...override }, release.GITHUB_SHA)).toThrow();
	});

	it('refuses a checkout other than the commit tested by CI', () => {
		expect(() => validateRelease(release, 'b'.repeat(40))).toThrow('checkout');
	});

	it('requires another pricing review before the announced Observability tariff change', () => {
		expect(() => assertFreePricingWindow(new Date('2026-11-30T23:59:59Z'))).not.toThrow();
		expect(() => assertFreePricingWindow(new Date('2026-12-01T00:00:00Z'))).toThrow('tarification');
	});
});

describe('current main check before production secrets', () => {
	const settings = { ...release, GITHUB_TOKEN: 'fictional-actions-token' };
	const reference = (sha: string) => ({ ref: 'refs/heads/main', object: { sha } });

	it('permits the current main commit using only a fixed read-only GitHub endpoint', async () => {
		const request = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json(reference(release.GITHUB_SHA)));
		await expect(checkCurrentMain(settings, request)).resolves.toBe(true);
		expect(request).toHaveBeenCalledWith(
			'https://api.github.com/repos/Nekxio/Coursely/git/ref/heads/main',
			expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) })
		);
	});

	it('skips an old queued commit or rerun after main advances', async () => {
		const request = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json(reference('b'.repeat(40))));
		await expect(checkCurrentMain(settings, request)).resolves.toBe(false);
	});

	it.each([
		{},
		{ ref: 'refs/heads/develop', object: { sha: release.GITHUB_SHA } },
		reference('invalid-sha')
	])('fails closed for an invalid GitHub reference: %j', async (body) => {
		const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
		await expect(checkCurrentMain(settings, request)).rejects.toThrow('déploiement bloqué');
	});

	it('fails closed without echoing response bodies or transport errors', async () => {
		for (const request of [
			vi
				.fn<typeof fetch>()
				.mockResolvedValue(new Response('fictional-sensitive-response', { status: 403 })),
			vi.fn<typeof fetch>().mockRejectedValue(new Error('fictional-actions-token')),
			vi.fn<typeof fetch>().mockResolvedValue(new Response('fictional-invalid-json'))
		]) {
			await expect(checkCurrentMain(settings, request)).rejects.toThrow('déploiement bloqué');
		}
	});

	it('does not send the job token for an unexpected repository or missing context', async () => {
		const request = vi.fn<typeof fetch>();
		for (const override of [
			{ GITHUB_REPOSITORY: 'someone/fork' },
			{ GITHUB_TOKEN: '' },
			{ GITHUB_SHA: '' }
		]) {
			await expect(checkCurrentMain({ ...settings, ...override }, request)).rejects.toThrow(
				'contexte'
			);
		}
		expect(request).not.toHaveBeenCalled();
	});
});

describe('secret validation and Workers Free packaging budget', () => {
	it('rejects missing credentials without disclosing rejected values', () => {
		expect(() => productionSecrets({})).toThrow('BETTER_AUTH_SECRET');
		const settings = {
			BETTER_AUTH_SECRET: 'fictional-test-secret-'.repeat(3),
			TURSO_AUTH_TOKEN: 'fictional-test-token',
			TURSO_DATABASE_URL: 'libsql://dedicated-production-test.turso.io'
		};
		expect(productionSecrets(settings)).toEqual(settings);
		for (const url of [
			'file:/tmp/demo.db',
			'https://your-coursely-database.turso.io',
			'libsql://user:password@db.turso.io',
			'https://db.turso.io?token=do-not-log-this'
		]) {
			expect(() => productionSecrets({ ...settings, TURSO_DATABASE_URL: url })).toThrow(
				'TURSO_DATABASE_URL'
			);
			try {
				productionSecrets({ ...settings, TURSO_DATABASE_URL: url });
			} catch (cause) {
				expect(String(cause)).not.toContain('do-not-log-this');
				expect(String(cause)).not.toContain('fictional-test-token');
			}
		}
	});

	it('uses the current uncompressed limit and fails closed on absent/oversized bundles', () => {
		expect(() => checkBundleBudget(workersFreeBundleBytes)).not.toThrow();
		for (const size of [0, -1, NaN, workersFreeBundleBytes + 1]) {
			expect(() => checkBundleBudget(size)).toThrow('64 Mio');
		}
	});
});
