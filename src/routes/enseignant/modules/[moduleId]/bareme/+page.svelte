<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import type { PageProps } from './$types';
	import RubricEditor from '#lib/components/grading/RubricEditor.svelte';
	let { data }: PageProps = $props();
</script>

<PageHead
	title="Barème · {data.rubric.module.title}"
	description="Définir les évaluations, les critères et les règles de calcul du module."
/>
{#key data.rubric.module.id}<RubricEditor data={data.rubric} />{/key}
