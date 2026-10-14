<script lang="ts">
	import type { PageProps } from './$types';
	import GradeGrid from '#lib/components/grading/GradeGrid.svelte';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Grille de notes · Coursely</title></svelte:head>
<GradeGrid data={data.grid} />
