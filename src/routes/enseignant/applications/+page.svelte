<script lang="ts">
	import { tick } from 'svelte';
	import CircleCheckIcon from '@lucide/svelte/icons/circle-check';
	import ApplicationGrant from '#lib/components/auth/ApplicationGrant.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	let removed = $state<string[]>([]);
	let message = $state('');
	const applications = $derived(data.applications.filter((a) => !removed.includes(a.id)));
	async function revoked(id: string, name: string) {
		removed = [...removed, id];
		message = 'L’accès de ' + name + ' a été révoqué.';
		await tick();
		document.getElementById('applications-heading')?.focus();
	}
</script>

<svelte:head><title>Applications connectées · Coursely</title></svelte:head>
<h1
	id="applications-heading"
	tabindex="-1"
	class="mb-4 text-3xl font-semibold tracking-tight wrap-anywhere sm:text-4xl"
>
	Applications connectées
</h1>
<p class="mb-6 max-w-prose text-sm leading-normal text-muted-foreground sm:mb-8 sm:text-base">
	Consultez les droits accordés à vos applications et retirez leur accès quand vous le souhaitez.
</p>
{#if message}<p role="status" class="mb-6 flex items-start gap-2.5 text-sm leading-normal">
		<CircleCheckIcon class="mt-0.5 size-4 shrink-0" aria-hidden="true" />{message}
	</p>{/if}
<div class="space-y-5">
	{#each applications as application (application.id + application.reviewedVersion)}<ApplicationGrant
			{application}
			onRevoked={(name) => revoked(application.id, name)}
		/>{:else}<section class="max-w-4xl rounded-xl border px-5 py-6 sm:px-7 sm:py-9">
			<h2 class="mb-2.5 text-xl font-semibold tracking-tight wrap-anywhere">
				Aucune application autorisée
			</h2>
			<p class="max-w-prose text-sm leading-normal text-muted-foreground">
				Connectez une application depuis Codex pour retrouver ses droits ici.
			</p>
		</section>{/each}
</div>
<p class="mt-6 max-w-prose text-sm leading-normal text-muted-foreground">
	Ces autorisations concernent les applications externes. Votre clé d’accès reste le moyen de vous
	connecter à Coursely.
</p>
