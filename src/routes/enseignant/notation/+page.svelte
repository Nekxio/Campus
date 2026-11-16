<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import type { PageProps } from './$types';
	import GradeGrid from '#lib/components/grading/GradeGrid.svelte';
	let { data }: PageProps = $props();
</script>

<PageHead title="Grille de notes" description="Consulter les notes d’une classe et ouvrir une correction." />
<GradeGrid data={data.grid} />
