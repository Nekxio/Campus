import { describe, expect, it, vi } from 'vitest';
import { releasePlan, releasePullRequest, synchronizeRelease, tagRelease } from '../../../../scripts/release-flow.js';
import {
	checkCurrentPreview,
	previewConfig,
	previewSecrets,
	validatePreview
} from '../../../../scripts/preview-deployment.js';
import { readFile } from 'node:fs/promises';

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
			GITHUB_REF: 'refs/heads/develop',
			GITHUB_REPOSITORY: 'Nekxio/Campus',
			GITHUB_SHA: sha,
			COURSELY_CHECKED_SHA: sha,
			COURSELY_QUALITY_RESULT: 'success',
			CAMPUS_PREVIEW_ENABLED: 'true'
		};
		expect(() => validatePreview(settings, sha)).not.toThrow();
		expect(() => validatePreview({ ...settings, GITHUB_REF: 'refs/heads/release/1.0.0' }, sha)).not.toThrow();
		for (const override of [
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
