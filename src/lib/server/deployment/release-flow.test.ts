import { describe, expect, it, vi } from 'vitest';
import { releasePlan, releasePullRequest, synchronizeRelease, tagRelease } from '../../../../scripts/release-flow.js';
import {
	checkCurrentPreview,
	previewConfig,
	previewSecrets,
	validatePreview,
	verifyPreview
} from '../../../../scripts/preview-deployment.js';
import { readFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';

const source = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const sha = 'a'.repeat(40);
const releaseSha = 'b'.repeat(40);
const plan = { version: '1.0.0', nextDevelopmentVersion: '2.0.0-SNAPSHOT' };
const pull = {
	merged_at: '2026-11-15T12:00:00Z',
	merge_commit_sha: sha,
	base: { ref: 'main' },
	head: { ref: 'release/1.0.0', sha: releaseSha, repo: { full_name: 'Nekxio/Campus' } }
};

describe('explicit Gitflow versions and release provenance', () => {
	it('accepts an explicitly selected next version without inventing an increment', () => {
		expect(releasePlan(plan, '1.0.0')).toEqual(plan);
		expect(releasePlan({ ...plan, nextDevelopmentVersion: '1.0.1-SNAPSHOT' }, '1.0.0').nextDevelopmentVersion).toBe(
			'1.0.1-SNAPSHOT'
		);
	});
	it.each(['1.0.0-SNAPSHOT', '0.9.9-SNAPSHOT', '1.0.1', '01.0.1-SNAPSHOT'])(
		'rejects invalid next development version %s',
		(nextDevelopmentVersion) => {
			expect(() => releasePlan({ ...plan, nextDevelopmentVersion }, '1.0.0')).toThrow();
		}
	);
	it('requires the package version, release branch and real merge parents to agree', () => {
		expect(releasePullRequest([pull], sha, ['c'.repeat(40), releaseSha], '1.0.0')).toEqual(pull);
		for (const invalid of [
			{ ...pull, merged_at: null },
			{ ...pull, merge_commit_sha: releaseSha },
			{ ...pull, head: { ...pull.head, ref: 'feature/test' } },
			{ ...pull, head: { ...pull.head, repo: { full_name: 'Nekxio/Coursely' } } },
			{ ...pull, head: { ...pull.head, repo: { full_name: 'someone/fork' } } }
		]) {
			expect(() => releasePullRequest([invalid], sha, ['c'.repeat(40), releaseSha], '1.0.0')).toThrow();
		}
		expect(() => releasePullRequest([pull], sha, [releaseSha], '1.0.0')).toThrow();
		expect(() => releasePullRequest([pull], sha, ['c'.repeat(40), releaseSha], '1.0.0-SNAPSHOT')).toThrow();
	});
});

describe('isolated preview target', () => {
	it('keeps the quiz namespace local to a different Worker and validates the exact origin', () => {
		const config = previewConfig(
			source,
			{
				CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
				CAMPUS_PREVIEW_ORIGIN: 'https://campus-preview.leohilaire-1f7.workers.dev'
			},
			'/tmp'
		);
		expect(config.name).toBe('campus-preview');
		expect(config.vars.ORIGIN).toBe('https://campus-preview.leohilaire-1f7.workers.dev');
		expect(config.durable_objects.bindings[0]).not.toHaveProperty('script_name');
		expect(() =>
			previewConfig(
				source,
				{
					CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
					CAMPUS_PREVIEW_ORIGIN: 'https://campus-mds.leohilaire-1f7.workers.dev'
				},
				'/tmp'
			)
		).toThrow('CAMPUS_PREVIEW_ORIGIN');
	});
	it('never accepts production database credentials for preview', () => {
		const settings = {
			CAMPUS_PREVIEW_AUTH_SECRET: 'fictional-preview-secret-'.repeat(3),
			CAMPUS_PREVIEW_TURSO_TOKEN: 'fictional-token',
			CAMPUS_PREVIEW_TURSO_URL: 'libsql://campus-dev-nekxio.aws-eu-west-1.turso.io'
		};
		expect(previewSecrets(settings).TURSO_DATABASE_URL).toBe(settings.CAMPUS_PREVIEW_TURSO_URL);
		expect(() =>
			previewSecrets({
				...settings,
				CAMPUS_PREVIEW_TURSO_URL: 'libsql://campus-prod-mds-nekxio.aws-eu-west-1.turso.io'
			})
		).toThrow();
	});
	it('only deploys checked develop or release commits, with an explicit enable flag', () => {
		const settings = {
			GITHUB_EVENT_NAME: 'push',
			GITHUB_REF_PROTECTED: 'true',
			GITHUB_REF: 'refs/heads/develop',
			GITHUB_REPOSITORY: 'Nekxio/Campus',
			GITHUB_SHA: sha,
			COURSELY_CHECKED_SHA: sha,
			COURSELY_QUALITY_RESULT: 'success',
			CAMPUS_PREVIEW_ENABLED: 'true'
		};
		expect(() => validatePreview(settings, sha)).not.toThrow();
		expect(() => validatePreview({ ...settings, GITHUB_REF: 'refs/heads/release/1.0.0' }, sha)).not.toThrow();
		for (const version of ['1.0.0', '2.3.4']) {
			const release = { ...settings, GITHUB_REF: `refs/heads/release/${version}`, GITHUB_REF_PROTECTED: 'false' };
			expect(() => validatePreview(release, sha)).not.toThrow();
			for (const override of [
				{ GITHUB_EVENT_NAME: 'pull_request' },
				{ GITHUB_EVENT_NAME: 'workflow_dispatch' },
				{ GITHUB_REPOSITORY: 'someone/fork' },
				{ COURSELY_CHECKED_SHA: releaseSha },
				{ CAMPUS_PREVIEW_ENABLED: 'false' }
			])
				expect(() => validatePreview({ ...release, ...override }, sha)).toThrow();
		}
		for (const override of [
			{ GITHUB_REF_PROTECTED: 'false' },
			{ GITHUB_REPOSITORY: 'someone/fork' },
			{ GITHUB_REPOSITORY: 'Nekxio/Coursely' },
			{ GITHUB_REF: 'refs/heads/main' },
			{ GITHUB_EVENT_NAME: 'pull_request' },
			{ GITHUB_REF: 'refs/heads/feature/test' },
			{ CAMPUS_PREVIEW_ENABLED: 'false' },
			{ COURSELY_CHECKED_SHA: releaseSha }
		]) {
			expect(() => validatePreview({ ...settings, ...override }, sha)).toThrow();
		}
	});
});

describe('current preview check before deployment', () => {
	const settings = {
		GITHUB_REPOSITORY: 'Nekxio/Campus',
		GITHUB_REF: 'refs/heads/develop',
		GITHUB_SHA: sha,
		GITHUB_TOKEN: 'fictional-actions-token'
	};

	it.each(['develop', 'release/1.0.0'])('checks the fixed Campus endpoint for %s without redirects', async (branch) => {
		const reference = { ref: `refs/heads/${branch}`, object: { sha } };
		const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(reference));
		await expect(checkCurrentPreview({ ...settings, GITHUB_REF: reference.ref }, request)).resolves.toBe(true);
		expect(request).toHaveBeenCalledWith(
			`https://api.github.com/repos/Nekxio/Campus/git/ref/heads/${branch}`,
			expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) })
		);
	});

	it('skips an old preview commit after the branch advances', async () => {
		const request = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json({ ref: settings.GITHUB_REF, object: { sha: releaseSha } }));
		await expect(checkCurrentPreview(settings, request)).resolves.toBe(false);
	});

	it.each(['someone/fork', 'Nekxio/Coursely'])(
		'rejects repository %s before sending the job token',
		async (repository) => {
			const request = vi.fn<typeof fetch>();
			await expect(checkCurrentPreview({ ...settings, GITHUB_REPOSITORY: repository }, request)).rejects.toThrow(
				'Invalid preview reference'
			);
			expect(request).not.toHaveBeenCalled();
		}
	);
});

const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
const qualityJob = workflow.split('  quality:')[1].split('\n  deploy:')[0];
const previewJob = workflow.split('  deploy-preview:')[1].split('\n  gitflow:')[0];

describe('preview HTTPS verification', () => {
	const origin = 'https://campus-preview.leohilaire-1f7.workers.dev';
	const healthyResponse = (input: string | URL | Request) => {
		const path = new URL(String(input)).pathname;
		return new Response(null, {
			status: path === '/connexion' ? 200 : path === '/' ? 303 : path === '/api/session' ? 401 : 404,
			headers: { 'cache-control': 'no-store', ...(path === '/' ? { location: '/connexion' } : {}) }
		});
	};

	it('recovers from a transient timeout and identifies every checked route', async () => {
		const request = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new DOMException('Sensitive transport detail', 'TimeoutError'))
			.mockImplementation(async (input) => healthyResponse(input));
		const pause = vi.fn().mockResolvedValue(undefined);
		const report = vi.fn();
		await expect(verifyPreview(origin, { request, pause, report })).resolves.toBeUndefined();
		expect(request).toHaveBeenCalledTimes(6);
		expect(pause).toHaveBeenCalledOnce();
		expect(
			request.mock.calls.every(([, init]) => init?.redirect === 'manual' && init.signal instanceof AbortSignal)
		).toBe(true);
		const messages = report.mock.calls.flat().join('\n');
		expect(messages).toContain('/connexion');
		expect(messages).toContain('/api/session');
		expect(messages).toContain('/modules/');
		expect(messages).toContain('/classes/');
		expect(messages).not.toContain('Sensitive transport detail');
	});

	it.each([502, 503, 504])('retries temporary HTTP %s responses within a fixed budget', async (status) => {
		const request = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status }));
		const pause = vi.fn().mockResolvedValue(undefined);
		const report = vi.fn();
		await expect(verifyPreview(origin, { request, pause, report })).rejects.toThrow('/connexion');
		expect(request).toHaveBeenCalledTimes(3);
		expect(pause).toHaveBeenCalledTimes(2);
		expect(report.mock.calls.flat().join('\n')).toContain(`HTTP ${status}`);
	});

	it('fails after repeated transport errors without leaking their details', async () => {
		const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Sensitive transport detail'));
		const report = vi.fn();
		await expect(verifyPreview(origin, { request, pause: async () => {}, report })).rejects.toThrow('3 attempts');
		expect(request).toHaveBeenCalledTimes(3);
		expect(report.mock.calls.flat().join('\n')).not.toContain('Sensitive transport detail');
	});

	it.each(['status', 'cache', 'redirect'])('never retries a broken %s contract', async (failure) => {
		const request = vi.fn<typeof fetch>().mockImplementation(async (input) => {
			if (new URL(String(input)).pathname !== '/') return healthyResponse(input);
			return new Response(null, {
				status: failure === 'status' ? 200 : 303,
				headers: {
					'cache-control': failure === 'cache' ? 'public' : 'no-store',
					location: failure === 'redirect' ? '/enseignant' : '/connexion'
				}
			});
		});
		const pause = vi.fn().mockResolvedValue(undefined);
		await expect(verifyPreview(origin, { request, pause, report: () => {} })).rejects.toThrow();
		expect(request).toHaveBeenCalledTimes(2);
		expect(pause).not.toHaveBeenCalled();
	});

	it('refuses any other origin before making a request', async () => {
		const request = vi.fn<typeof fetch>();
		await expect(verifyPreview('https://example.test', { request, report: () => {} })).rejects.toThrow(
			'preview origin'
		);
		expect(request).not.toHaveBeenCalled();
	});

	it('runs the bounded verifier after deployment in CI', () => {
		expect(previewJob).toContain('run: pnpm exec tsx scripts/preview-deployment.ts verify');
	});
});

describe('preview workflow trust boundary', () => {
	const settings = {
		GITHUB_EVENT_NAME: 'workflow_dispatch',
		GITHUB_REF: 'refs/heads/develop',
		GITHUB_SHA: sha,
		EXPECTED_SHA: sha
	};
	const dispatchGuard = () => {
		const match = qualityJob.match(/- name: Validate dispatch commit\n[\s\S]*? {8}run: \|\n((?: {10}.*\n|\n)+)/);
		expect(match, 'dispatch guard must execute before checkout').not.toBeNull();
		expect(qualityJob.indexOf('Validate dispatch commit')).toBeLessThan(qualityJob.indexOf('Check out source'));
		return match![1].replace(/^ {10}/gm, '');
	};
	it.each([releaseSha, 'main', sha.slice(0, 7), sha + '\n', '$(exit 0)'])(
		'rejects mismatched or symbolic dispatch SHA %s before checkout',
		(expected) => {
			const result = spawnSync('/bin/bash', ['-e', '-c', dispatchGuard()], {
				env: { ...settings, EXPECTED_SHA: expected },
				encoding: 'utf8'
			});
			expect(result.status).toBe(1);
		}
	);
	it('allows the exact dispatched commit and ordinary checks without a requested SHA', () => {
		for (const override of [
			{},
			{ EXPECTED_SHA: '' },
			{ GITHUB_EVENT_NAME: 'push', EXPECTED_SHA: '' },
			{ GITHUB_EVENT_NAME: 'pull_request', EXPECTED_SHA: '' }
		]) {
			const result = spawnSync('/bin/bash', ['-e', '-c', dispatchGuard()], {
				env: { ...settings, ...override },
				encoding: 'utf8'
			});
			expect(result.status, result.stderr).toBe(0);
		}
		expect(
			spawnSync('/bin/bash', ['-e', '-c', dispatchGuard()], {
				env: { ...settings, GITHUB_REF: 'refs/heads/feat/unreviewed' }
			}).status
		).toBe(1);
	});
	it('pins both checkouts to the event SHA and gates secrets independently of repository scripts', () => {
		for (const job of [qualityJob, previewJob]) {
			const checkout = job.match(/uses: actions\/checkout@[^\n]*\n {8}with:\n {10}ref: ([^\n]+)/);
			expect(checkout?.[1]).toBe('${{ github.sha }}');
		}
		const condition = previewJob.match(/^ {4}if: (.+)$/m)![1];
		const github = {
			repository: 'Nekxio/Campus',
			event_name: 'workflow_dispatch',
			ref: 'refs/heads/develop',
			sha,
			ref_protected: true
		};
		const permits = (overrides = {}, commit = sha, expected = sha) =>
			runInNewContext(condition, {
				github: { ...github, ...overrides },
				needs: { quality: { result: 'success', outputs: { commit } } },
				vars: { CAMPUS_PREVIEW_ENABLED: 'true' },
				inputs: { expected_sha: expected },
				startsWith: (value: string, prefix: string) => value.startsWith(prefix)
			});
		expect(permits()).toBe(true);
		expect(permits({}, releaseSha)).toBe(false);
		expect(permits({}, sha, releaseSha)).toBe(false);
		for (const override of [
			{ ref_protected: false },
			{ event_name: 'pull_request' },
			{ repository: 'someone/fork' },
			{ ref: 'refs/heads/feat/unreviewed' }
		])
			expect(permits(override)).toBe(false);
		for (const ref of ['refs/heads/develop', 'refs/heads/release/1.0.0'])
			expect(permits({ event_name: 'push', ref }, sha, '')).toBe(true);
		for (const version of ['1.0.0', '2.3.4']) {
			const release = { event_name: 'push', ref: `refs/heads/release/${version}`, ref_protected: false };
			expect(permits(release)).toBe(true);
			expect(permits(release, releaseSha)).toBe(false);
			expect(permits({ ...release, repository: 'someone/fork' })).toBe(false);
			expect(permits({ ...release, event_name: 'pull_request' })).toBe(false);
			expect(permits({ ...release, event_name: 'workflow_dispatch' })).toBe(false);
		}
		expect(previewJob).toContain('secrets.CAMPUS_PREVIEW_CLOUDFLARE_API_TOKEN');
		expect(previewJob).not.toContain('secrets.CLOUDFLARE_API_TOKEN');
	});
	it('accepts the checked dispatch SHA in the CLI but never substitutes it for a different event SHA', () => {
		const checkout = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
		for (const eventSha of [checkout, sha]) {
			const result = spawnSync(process.execPath, ['--import=tsx', 'scripts/preview-deployment.ts', 'validate'], {
				env: {
					...settings,
					GITHUB_SHA: eventSha,
					GITHUB_REF_PROTECTED: 'true',
					GITHUB_REPOSITORY: 'Nekxio/Campus',
					COURSELY_CHECKED_SHA: checkout,
					COURSELY_QUALITY_RESULT: 'success',
					CAMPUS_PREVIEW_ENABLED: 'true'
				},
				encoding: 'utf8'
			});
			expect(result.status).toBe(eventSha === checkout ? 0 : 1);
			if (eventSha !== checkout) expect(result.stderr).toContain('Preview command failed');
		}
	});
});

const githubFixture = () => {
	const baseSha = 'c'.repeat(40);
	const stagedSha = 'd'.repeat(40);
	const resultSha = 'e'.repeat(40);
	const treeSha = 'f'.repeat(40);
	const state = {
		conflict: false,
		race: false,
		receipt: false,
		dispatchFails: false,
		published: false,
		lostResponse: false
	};
	const settings = { GITHUB_TOKEN: 'fictional', GITHUB_REPOSITORY: 'Nekxio/Campus' };
	const release = { mainSha: sha, releaseSha, plan };
	const pkg = {
		name: 'campus',
		private: true,
		version: '1.0.0',
		scripts: { test: 'unchanged' },
		packageManager: 'pnpm@12.11.2'
	};
	const bodies: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
	const request = vi.fn<typeof fetch>(async (url, options) => {
		const path = String(url)
			.replace('https://api.github.com/repos/Nekxio/Campus', '')
			.replace('https://api.github.com', '');
		const method = options?.method ?? 'GET';
		const body = options?.body ? JSON.parse(String(options.body)) : {};
		bodies.push({ path, method, body });
		const json = (data: unknown) => Response.json(data);
		const ref = (value: string) => json({ object: { sha: value } });
		if (path.includes('/git/ref/heads/automation/gitflow-result/'))
			return state.receipt ? ref(resultSha) : new Response(null, { status: 404 });
		if (path.includes('/git/ref/heads/automation/gitflow-base/')) return ref(baseSha);
		if (path.includes('/git/ref/heads/automation/gitflow-merge/')) return ref(stagedSha);
		if (path === '/merges') return new Response(null, { status: state.conflict ? 409 : 204 });
		if (path.startsWith('/git/commits/') || path === '/git/commits')
			return json({
				sha: path === '/git/commits' || path.endsWith(resultSha) ? resultSha : stagedSha,
				tree: { sha: treeSha },
				parents: [{ sha: baseSha }, { sha: releaseSha }],
				message: `📷 ${plan.nextDevelopmentVersion}`
			});
		if (path.startsWith('/contents/package.json'))
			return json({
				encoding: 'base64',
				content: Buffer.from(
					JSON.stringify({ ...pkg, version: path.endsWith(resultSha) ? plan.nextDevelopmentVersion : pkg.version })
				).toString('base64')
			});
		if (path === '/git/trees') return json({ sha: treeSha });
		if (path === '') return json({ node_id: 'fictional-repository-id' });
		if (path === '/graphql') {
			if (state.race) return json({ errors: [{ message: 'develop advanced' }], data: { updateRefs: null } });
			state.receipt = true;
			state.published = true;
			if (state.lostResponse) throw new Error('fictional transport loss');
			return json({ data: { updateRefs: { clientMutationId: sha } } });
		}
		if (path.endsWith('/dispatches'))
			return state.dispatchFails ? new Response(null, { status: 503 }) : json({ workflow_run_id: 123 });
		throw new Error(`Unexpected fictional endpoint: ${path}`);
	});
	return { state, settings, release, request, bodies, pkg, baseSha, resultSha, treeSha };
};

describe('release synchronization', () => {
	it.each(['someone/fork', 'Nekxio/Coursely'])(
		'rejects release operations from %s before sending the job token',
		async (repository) => {
			const fixture = githubFixture();
			const settings = { ...fixture.settings, GITHUB_REPOSITORY: repository };
			await expect(synchronizeRelease(settings, fixture.release, fixture.request)).rejects.toThrow(
				'trusted GitHub context'
			);
			await expect(tagRelease(settings, fixture.release, fixture.request)).rejects.toThrow('trusted GitHub context');
			expect(fixture.request).not.toHaveBeenCalled();
		}
	);
	it('publishes a real merge with the exact message and version, preserving the rest of the package', async () => {
		const fixture = githubFixture();
		await expect(synchronizeRelease(fixture.settings, fixture.release, fixture.request)).resolves.toBe(
			fixture.resultSha
		);
		const tree = fixture.bodies.find((entry) => entry.path === '/git/trees')!.body;
		expect(tree.base_tree).toBe(fixture.treeSha);
		const entries = tree.tree as Array<{ path: string; content: string }>;
		expect(entries).toHaveLength(1);
		expect(entries[0].path).toBe('package.json');
		expect(JSON.parse(entries[0].content)).toEqual({ ...fixture.pkg, version: plan.nextDevelopmentVersion });
		expect(fixture.bodies.find((entry) => entry.path === '/git/commits')!.body).toEqual({
			message: '📷 2.0.0-SNAPSHOT',
			tree: fixture.treeSha,
			parents: [fixture.baseSha, releaseSha]
		});
		const update = fixture.bodies.find((entry) => entry.path === '/graphql')!.body as {
			variables: { input: { refUpdates: unknown[] } };
		};
		expect(update.variables.input.refUpdates).toEqual([
			{ name: 'refs/heads/develop', beforeOid: fixture.baseSha, afterOid: fixture.resultSha, force: false },
			{
				name: `refs/heads/automation/gitflow-result/${sha}`,
				beforeOid: '0'.repeat(40),
				afterOid: fixture.resultSha,
				force: false
			}
		]);
		expect(fixture.bodies.at(-1)?.body).toEqual({ ref: 'develop', inputs: { expected_sha: fixture.resultSha } });
	});
	it('stops on actual merge conflicts before publishing develop, a receipt or a dispatch', async () => {
		const fixture = githubFixture();
		fixture.state.conflict = true;
		await expect(synchronizeRelease(fixture.settings, fixture.release, fixture.request)).rejects.toThrow('409');
		expect(fixture.bodies.some((entry) => entry.path === '/graphql' || entry.path.endsWith('/dispatches'))).toBe(false);
		expect(fixture.state.published).toBe(false);
	});
	it('rejects a concurrently advanced develop without dispatching or changing its base', async () => {
		const fixture = githubFixture();
		fixture.state.race = true;
		await expect(synchronizeRelease(fixture.settings, fixture.release, fixture.request)).rejects.toThrow(
			'Develop changed'
		);
		expect(fixture.state.published).toBe(false);
		expect(fixture.bodies.some((entry) => entry.path.endsWith('/dispatches'))).toBe(false);
	});
	it.each(['lostResponse', 'dispatchFails'] as const)(
		'recovers %s using the receipt without merging twice',
		async (failure) => {
			const fixture = githubFixture();
			fixture.state[failure] = true;
			await expect(synchronizeRelease(fixture.settings, fixture.release, fixture.request)).rejects.toThrow();
			expect(fixture.state.published).toBe(true);
			fixture.state[failure] = false;
			const calls = fixture.bodies.length;
			await expect(synchronizeRelease(fixture.settings, fixture.release, fixture.request)).resolves.toBe(
				fixture.resultSha
			);
			expect(
				fixture.bodies
					.slice(calls)
					.filter((entry) => entry.method !== 'GET')
					.map((entry) => entry.path)
			).toEqual(['/actions/workflows/ci.yml/dispatches']);
		}
	);
	it('rejects a retry with a different next version before making any mutation', async () => {
		const fixture = githubFixture();
		fixture.state.receipt = true;
		await expect(
			synchronizeRelease(
				fixture.settings,
				{ ...fixture.release, plan: { ...plan, nextDevelopmentVersion: '3.0.0-SNAPSHOT' } },
				fixture.request
			)
		).rejects.toThrow('receipt differs');
		expect(fixture.bodies.every((entry) => entry.method === 'GET')).toBe(true);
	});
	it('never moves an existing release tag that points elsewhere', async () => {
		const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ object: { sha: releaseSha } }));
		await expect(
			tagRelease(
				{ GITHUB_TOKEN: 'fictional', GITHUB_REPOSITORY: 'Nekxio/Campus' },
				{ mainSha: sha, releaseSha, plan },
				request
			)
		).rejects.toThrow('will not be moved');
		expect(request).toHaveBeenCalledTimes(1);
	});
});
