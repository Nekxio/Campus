<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import type { PageProps } from './$types';
	import ModuleEditor from '#lib/components/teaching/ModuleEditor.svelte';
	let { data }: PageProps = $props();
</script>

<PageHead title={data.module.title} description="Préparer les informations, les contenus et le planning du module." />
<ModuleEditor {data} />
