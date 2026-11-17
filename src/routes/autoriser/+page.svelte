<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import ApplicationAccess from '#lib/components/auth/ApplicationAccess.svelte';
	import ApplicationConsent from '#lib/components/auth/ApplicationConsent.svelte';
	import { page } from '$app/state';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
</script>

<PageHead
	title="Autoriser une application"
	description="Choisir les données et les actions accessibles à une application connectée."
/>
<svelte:head><meta name="robots" content="noindex, nofollow" /></svelte:head>
<ApplicationAccess>
	{#if data.application}{#key data.application.oauthQuery}<ApplicationConsent
				application={data.application}
				name={data.name}
				initialForm={form?.form}
				initialIssue={form && 'message' in form ? form.message : ''}
				initialStatus={page.status}
			/>{/key}
	{:else}<h1 class="mb-4 page-title">La demande est indisponible</h1>
		<p class="text-sm leading-normal text-muted-foreground">{data.issue}</p>{/if}
</ApplicationAccess>
