<script lang="ts">
	import ErrorContent from '#lib/components/errors/ErrorContent.svelte';
	import LegalFooter from '#lib/components/legal/LegalFooter.svelte';
	import PublicHeader from './PublicHeader.svelte';
	let {
		status,
		audience = 'public',
		classId
	}: {
		status: number;
		audience?: 'general' | 'public' | 'teacher';
		classId?: string | null;
	} = $props();
</script>

<PublicHeader mainId="page-indisponible" />
<main id="page-indisponible" tabindex="-1" class="unavailable">
	<ErrorContent {status} {audience} {classId} />
</main>
{#if audience !== 'teacher'}
	<LegalFooter />
{/if}

<style>
	.unavailable {
		width: min(100%, 80rem);
		margin-inline: auto;
		min-height: calc(100svh - 5rem);
		padding: clamp(2rem, 7svh, 5rem) max(1.25rem, env(safe-area-inset-right, 0px))
			calc(4rem + env(safe-area-inset-bottom, 0px)) max(1.25rem, env(safe-area-inset-left, 0px));
		overflow-wrap: anywhere;
	}
</style>
