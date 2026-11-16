<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import type { PageProps } from './$types';
	import ModuleLibrary from '#lib/components/teacher/ModuleLibrary.svelte';
	let { data }: PageProps = $props();
</script>

<PageHead
	title="Mes modules"
	description="Retrouver les modules et ouvrir leur préparation, leur barème ou leur publication."
/>
<ModuleLibrary modules={data.modules} />
