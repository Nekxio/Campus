<script lang="ts">
	import ApplicationAccess from '#lib/components/auth/ApplicationAccess.svelte';
	import ApplicationConsent from '#lib/components/auth/ApplicationConsent.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<svelte:head
	><title>Autoriser une application · Coursely</title><meta
		name="robots"
		content="noindex, nofollow"
	/></svelte:head
>
<ApplicationAccess>
	{#if data.application}{#key data.application.oauthQuery}<ApplicationConsent
				application={data.application}
				name={data.name}
			/>{/key}
	{:else}<h1 class="mb-4 text-3xl font-semibold tracking-tight wrap-anywhere sm:text-4xl">
			La demande est indisponible
		</h1>
		<p class="text-sm leading-normal text-muted-foreground">{data.issue}</p>{/if}
</ApplicationAccess>
