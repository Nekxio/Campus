<script lang="ts">
	import type { PageProps } from './$types';
	import RubricEditor from '#lib/components/grading/RubricEditor.svelte';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Barème · {data.rubric.module.title} · Coursely</title></svelte:head>
{#key data.rubric.module.id}<RubricEditor data={data.rubric} />{/key}
