<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import ActionNotice from '#lib/components/ActionNotice.svelte';
	import CalendarConnection from '#lib/components/calendar/CalendarConnection.svelte';
	import WorkSurface from '#lib/components/shared/WorkSurface.svelte';
	import { tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import ApplicationGrant from '#lib/components/auth/ApplicationGrant.svelte';
	import AgentConnectionCommands from '#lib/components/auth/AgentConnectionCommands.svelte';
	import { page } from '$app/state';
	import { revokeConsentSchema } from '#lib/domain/remote-mcp.js';
	import { defaults, type SuperValidated } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import type { RevokeConsent } from '#lib/domain/remote-mcp.js';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let removed = $state<string[]>([]);
	let message = $state('');
	const nativeSuccess = $derived(
		form && 'receipt' in form && form.receipt && 'revoked' in form.receipt
			? 'L’accès de l’application a été révoqué.'
			: ''
	);
	const reviewedForm = (id: string): SuperValidated<RevokeConsent> | undefined => {
		const checked = revokeConsentSchema.safeParse(form?.form?.data);
		if (!checked.success || checked.data.id !== id || !form?.form) return undefined;
		return {
			...defaults(checked.data, zod4Client(revokeConsentSchema)),
			id: form.form.id,
			posted: form.form.posted,
			valid: form.form.valid
		};
	};
	const applications = $derived(data.applications.filter((a) => !removed.includes(a.id)));
	const revoked = async (id: string, name: string) => {
		removed = [...removed, id];
		message = 'L’accès de ' + name + ' a été révoqué.';
		await tick();
		document.getElementById('applications-heading')?.focus();
	};
</script>

<ActionNotice message={message || nativeSuccess} />
{#if nativeSuccess}<p role="status" class="mb-6 rounded-lg bg-muted p-4 text-sm">{nativeSuccess}</p>{/if}

<PageHead title="Applications connectées" description="Consulter les applications autorisées et gérer leurs accès." />
<div class="page-sections">
	<header>
		<h2 id="applications-heading" tabindex="-1" class="section-title">Applications connectées</h2>
		<p class="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
			Gérez le calendrier de votre école et les droits accordés à vos applications.
		</p>
	</header>
	<WorkSurface element="div">
		<CalendarConnection initial={data.calendar} />
	</WorkSurface>
	<WorkSurface aria-labelledby="authorized-applications-heading" class="flex min-w-0 flex-col gap-6">
		<div class="flex min-w-0 flex-col gap-3">
			<h2 id="authorized-applications-heading" class="panel-title">Applications autorisées</h2>
			<AgentConnectionCommands mcpUrl={`${page.url.origin}/mcp`} />
		</div>
		{#each applications as application (application.id + ':' + application.reviewedVersion + ':' + (reviewedForm(application.id)?.data.reviewedVersion ?? ''))}<ApplicationGrant
				{application}
				initialForm={reviewedForm(application.id)}
				initialIssue={reviewedForm(application.id) && form && 'message' in form ? form.message : ''}
				initialStale={!!reviewedForm(application.id) && page.status === 409}
				onRefresh={async () => {
					await invalidateAll();
					form = null;
				}}
				onRevoked={(name) => revoked(application.id, name)}
			/>{:else}<Empty.Root class="rounded-container bg-muted p-(--space-content)"
				><Empty.Header
					><Empty.Title role="heading" aria-level={3}>Aucune application autorisée</Empty.Title><Empty.Description
						>Connectez Codex ou Claude pour retrouver les droits accordés ici.</Empty.Description
					></Empty.Header
				></Empty.Root
			>{/each}
		<aside class="applications-guidance">
			<h3>Vos autorisations</h3>
			<p class="text-sm leading-relaxed text-muted-foreground">
				Ces autorisations concernent les applications externes. Votre clé d’accès reste le moyen de vous connecter à
				Campus.
			</p>
			<p>Une révocation retire les droits de l’application. Elle conserve vos modules, vos notes et votre session.</p>
		</aside>
	</WorkSurface>
</div>

<style>
	.applications-guidance {
		display: flex;
		flex-direction: column;
		gap: var(--space-label);
	}
	.applications-guidance h3 {
		font-size: 1rem;
		font-weight: 600;
	}
	.applications-guidance p {
		color: var(--muted-foreground);
		font-size: 0.875rem;
		line-height: 1.65;
	}
</style>
