<script lang="ts">
	import type { PageProps } from './$types';
	import ClassesWorkspace from '#lib/components/teaching/ClassesWorkspace.svelte';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Mes classes · Coursely</title></svelte:head>
<ClassesWorkspace {data} />
