<script lang="ts">
	import ErrorContent from '#lib/components/errors/ErrorContent.svelte';
	import PublicHeader from './PublicHeader.svelte';
	let {
		status,
		audience = 'public',
		classId
	}: {
		status: number;
		audience?: 'general' | 'public';
		classId?: string;
	} = $props();
</script>

<PublicHeader mainId="page-indisponible" />
<main id="page-indisponible" tabindex="-1" class="unavailable mx-auto max-w-7xl">
	<ErrorContent {status} {audience} {classId} />
</main>

<style>
	.unavailable {
		min-height: calc(100svh - 5rem);
		padding: clamp(3.5rem, 11svh, 7rem) max(1.25rem, env(safe-area-inset-right, 0px))
			calc(4rem + env(safe-area-inset-bottom, 0px)) max(1.25rem, env(safe-area-inset-left, 0px));
		overflow-wrap: anywhere;
	}
</style>
