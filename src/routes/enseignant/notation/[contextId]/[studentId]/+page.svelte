<script lang="ts">
	import type { PageProps } from './$types';
	import DetailedCorrection from '#lib/components/grading/DetailedCorrection.svelte';
	let { data }: PageProps = $props();
</script>

<svelte:head
	><title>Correction détaillée · {data.rubric.module.title} · Coursely</title></svelte:head
>
<DetailedCorrection {data} />
