<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import type { PageProps } from './$types';
	import AnnualWorkspace from '#lib/components/annual/AnnualWorkspace.svelte';
	let { data }: PageProps = $props();
</script>

<PageHead
	title="Fin d’année"
	description="Consulter les années, archiver le travail et préparer la clôture annuelle."
/>
<AnnualWorkspace {data} />
