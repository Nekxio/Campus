<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import type { PageProps } from './$types';
	import DetailedCorrection from '#lib/components/grading/DetailedCorrection.svelte';
	let { data }: PageProps = $props();
</script>

<PageHead
	title="Correction détaillée · {data.rubric.module.title}"
	description="Saisir les points, vérifier les résultats et enregistrer la correction."
/>
<DetailedCorrection {data} />
