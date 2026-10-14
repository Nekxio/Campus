<script lang="ts">
	import type { PageProps } from './$types';
	import AnnualWorkspace from '#lib/components/annual/AnnualWorkspace.svelte';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Fin d’année · Coursely</title></svelte:head>
<AnnualWorkspace {data} />
