import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { ProductionEnvironment } from './production.js';

const stableVersion = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const planSchema = z.strictObject({ version: stableVersion, nextDevelopmentVersion: z.string() });
export type ReleasePlan = z.infer<typeof planSchema>;
const compareVersions = (left: string, right: string) => {
	const a = left.split('.').map(BigInt);
	const b = right.split('.').map(BigInt);
	for (let index = 0; index < 3; index++) {
		if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
	}
	return 0;
};
export const releasePlan = (value: unknown, packageVersion: string): ReleasePlan => {
	const plan = planSchema.parse(value);
	const next = stableVersion.parse(plan.nextDevelopmentVersion.replace(/-SNAPSHOT$/, ''));
	if (
		plan.version !== packageVersion ||
		!plan.nextDevelopmentVersion.endsWith('-SNAPSHOT') ||
		compareVersions(next, plan.version) <= 0
	)
		throw new Error('Select an explicit later development version and a matching stable release version.');
	return plan;
};

const pullSchema = z.object({
	merged_at: z.string().nullable(),
	merge_commit_sha: z.string().nullable(),
	base: z.object({ ref: z.string() }),
	head: z.object({ ref: z.string(), sha: shaSchema, repo: z.object({ full_name: z.string() }).nullable() })
});
export const releasePullRequest = (value: unknown, mainSha: string, parents: string[], version: string) => {
	stableVersion.parse(version);
	shaSchema.parse(mainSha);
	const matches = z
		.array(pullSchema)
		.parse(value)
		.filter(
			(pull) =>
				pull.merged_at &&
				pull.merge_commit_sha === mainSha &&
				pull.base.ref === 'main' &&
				pull.head.ref === `release/${version}` &&
				pull.head.repo?.full_name.toLowerCase() === 'nekxio/campus' &&
				parents.length === 2 &&
				parents[1] === pull.head.sha
		);
	if (matches.length !== 1)
		throw new Error('Production requires a real merge commit from its matching release branch.');
	return matches[0];
};

const gitCommitSchema = z.object({
	sha: shaSchema,
	tree: z.object({ sha: shaSchema }),
	parents: z.array(z.object({ sha: shaSchema })),
	message: z.string()
});
const refSchema = z.object({ object: z.object({ sha: shaSchema }) });
const fileSchema = z.object({ content: z.string(), encoding: z.literal('base64') });
const packageSchema = z.record(z.string(), z.unknown()).refine((pkg) => typeof pkg.version === 'string');
const githubClient = (settings: ProductionEnvironment, request: typeof fetch) => {
	if (settings.GITHUB_REPOSITORY?.toLowerCase() !== 'nekxio/campus' || !settings.GITHUB_TOKEN)
		throw new Error('Missing trusted GitHub context.');
	return async (path: string, method = 'GET', body?: unknown, missing = false): Promise<unknown> => {
		let response: Response;
		try {
			response = await request(`https://api.github.com${path === '/graphql' ? path : '/repos/Nekxio/Campus' + path}`, {
				method,
				headers: {
					Authorization: `Bearer ${settings.GITHUB_TOKEN}`,
					Accept: 'application/vnd.github+json',
					// Release provenance requires merge_commit_sha, removed in the 2026-03-10 API.
					'X-GitHub-Api-Version': '2022-11-28',
					'Content-Type': 'application/json'
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				redirect: 'error',
				signal: AbortSignal.timeout(15000)
			});
		} catch {
			throw new Error('GitHub request failed; retry the same release operation.');
		}
		if (missing && response.status === 404) return undefined;
		if (!response.ok)
			throw new Error(
				`GitHub operation refused (${response.status}); resolve conflicts or concurrency before retrying.`
			);
		if (response.status === 204) return undefined;
		return response.json();
	};
};

type Release = { mainSha: string; releaseSha: string; plan: ReleasePlan };
const packageAt = async (api: ReturnType<typeof githubClient>, sha: string) => {
	const file = fileSchema.parse(await api(`/contents/package.json?ref=${sha}`));
	return packageSchema.parse(JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')));
};

export const inspectRelease = async (settings: ProductionEnvironment, request = fetch): Promise<Release> => {
	const mainSha = shaSchema.parse(settings.GITHUB_SHA);
	if (settings.GITHUB_EVENT_NAME !== 'push' || settings.GITHUB_REF !== 'refs/heads/main')
		throw new Error('Only checked main pushes can finish a release.');
	const api = githubClient(settings, request);
	const commit = gitCommitSchema.parse(await api(`/git/commits/${mainSha}`));
	const pkg = await packageAt(api, mainSha);
	const pull = releasePullRequest(
		await api(`/commits/${mainSha}/pulls?per_page=100`),
		mainSha,
		commit.parents.map((parent) => parent.sha),
		z.string().parse(pkg.version)
	);
	const file = fileSchema.parse(await api(`/contents/.github/release-plan.json?ref=${mainSha}`));
	const plan = releasePlan(
		JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')),
		z.string().parse(pkg.version)
	);
	return { mainSha, releaseSha: pull.head.sha, plan };
};

export const tagRelease = async (settings: ProductionEnvironment, release: Release, request = fetch) => {
	const api = githubClient(settings, request);
	const ref = `tags/v${release.plan.version}`;
	const existing = await api(`/git/ref/${ref}`, 'GET', undefined, true);
	if (existing !== undefined) {
		if (refSchema.parse(existing).object.sha !== release.mainSha)
			throw new Error('Release tag already points elsewhere; it will not be moved.');
	} else await api('/git/refs', 'POST', { ref: `refs/${ref}`, sha: release.mainSha });
};

export const synchronizeRelease = async (settings: ProductionEnvironment, release: Release, request = fetch) => {
	shaSchema.parse(release.mainSha);
	shaSchema.parse(release.releaseSha);
	releasePlan(release.plan, release.plan.version);
	const api = githubClient(settings, request);
	const receiptRef = `heads/automation/gitflow-result/${release.mainSha}`;
	const receipt = await api(`/git/ref/${receiptRef}`, 'GET', undefined, true);
	let resultSha: string;
	if (receipt !== undefined) {
		resultSha = refSchema.parse(receipt).object.sha;
		const commit = gitCommitSchema.parse(await api(`/git/commits/${resultSha}`));
		if (
			commit.message !== `📷 ${release.plan.nextDevelopmentVersion}` ||
			commit.parents.length !== 2 ||
			commit.parents[1].sha !== release.releaseSha ||
			(await packageAt(api, resultSha)).version !== release.plan.nextDevelopmentVersion
		)
			throw new Error('The existing release receipt differs from this operation.');
	} else {
		const baseRef = `heads/automation/gitflow-base/${release.mainSha}`;
		let base = await api(`/git/ref/${baseRef}`, 'GET', undefined, true);
		if (base === undefined) {
			const current = refSchema.parse(await api('/git/ref/heads/develop')).object.sha;
			base = await api('/git/refs', 'POST', { ref: `refs/${baseRef}`, sha: current });
		}
		const baseSha = refSchema.parse(base).object.sha;
		const staging = `automation/gitflow-merge/${release.mainSha}`;
		if ((await api(`/git/ref/heads/${staging}`, 'GET', undefined, true)) === undefined)
			await api('/git/refs', 'POST', { ref: `refs/heads/${staging}`, sha: baseSha });
		await api('/merges', 'POST', {
			base: staging,
			head: release.releaseSha,
			commit_message: 'Merge release for Gitflow validation'
		});
		const stagedSha = refSchema.parse(await api(`/git/ref/heads/${staging}`)).object.sha;
		const staged = gitCommitSchema.parse(await api(`/git/commits/${stagedSha}`));
		const pkg = await packageAt(api, stagedSha);
		pkg.version = release.plan.nextDevelopmentVersion;
		const tree = z.object({ sha: shaSchema }).parse(
			await api('/git/trees', 'POST', {
				base_tree: staged.tree.sha,
				tree: [{ path: 'package.json', mode: '100644', type: 'blob', content: JSON.stringify(pkg, null, '\t') + '\n' }]
			})
		);
		const commit = gitCommitSchema.parse(
			await api('/git/commits', 'POST', {
				message: `📷 ${release.plan.nextDevelopmentVersion}`,
				tree: tree.sha,
				parents: [baseSha, release.releaseSha]
			})
		);
		resultSha = commit.sha;
		const repo = z.object({ node_id: z.string() }).parse(await api(''));
		const result = z
			.object({
				errors: z.array(z.unknown()).optional(),
				data: z
					.object({ updateRefs: z.object({ clientMutationId: z.string().nullable() }).nullable() })
					.nullable()
					.optional()
			})
			.parse(
				await api('/graphql', 'POST', {
					query: 'mutation($input: UpdateRefsInput!) { updateRefs(input: $input) { clientMutationId } }',
					variables: {
						input: {
							repositoryId: repo.node_id,
							clientMutationId: release.mainSha,
							refUpdates: [
								{ name: 'refs/heads/develop', beforeOid: baseSha, afterOid: resultSha, force: false },
								{ name: `refs/${receiptRef}`, beforeOid: '0'.repeat(40), afterOid: resultSha, force: false }
							]
						}
					}
				})
			);
		if (result.errors?.length || !result.data?.updateRefs)
			throw new Error('Develop changed or synchronization was refused; no automatic conflict resolution.');
	}
	await api('/actions/workflows/ci.yml/dispatches', 'POST', { ref: 'develop', inputs: { expected_sha: resultSha } });
	return resultSha;
};

const main = async () => {
	const command = process.argv[2];
	if (command === 'prepare') {
		const version = stableVersion.parse(process.argv[3]);
		const next = process.argv[4];
		const plan = releasePlan(
			{ version, nextDevelopmentVersion: next?.endsWith('-SNAPSHOT') ? next : `${next}-SNAPSHOT` },
			version
		);
		const pkg = packageSchema.parse(JSON.parse(await readFile('package.json', 'utf8')));
		pkg.version = version;
		await writeFile('package.json', JSON.stringify(pkg, null, '\t') + '\n');
		await writeFile('.github/release-plan.json', JSON.stringify(plan, null, '\t') + '\n');
	} else if (command === 'check-plan') {
		const pkg = z.object({ version: z.string() }).parse(JSON.parse(await readFile('package.json', 'utf8')));
		const plan = releasePlan(
			JSON.parse(await readFile('.github/release-plan.json', 'utf8')),
			z.string().parse(pkg.version)
		);
		if (process.env.CAMPUS_RELEASE_BRANCH !== `release/${plan.version}`)
			throw new Error('The release branch must match its package version.');
	} else if (['inspect', 'tag', 'sync'].includes(command ?? '')) {
		const release = await inspectRelease(process.env);
		if (command === 'tag') await tagRelease(process.env, release);
		if (command === 'sync') await synchronizeRelease(process.env, release);
	} else
		throw new Error(
			'Usage: tsx scripts/release-flow.ts prepare <release-version> <next-development-version> | inspect | tag | sync'
		);
};

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	main().catch((cause: unknown) => {
		console.error(cause instanceof Error ? cause.message : 'Release operation failed.');
		process.exitCode = 1;
	});
}
