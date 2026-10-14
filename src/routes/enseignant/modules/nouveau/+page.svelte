<script lang="ts">
	import type { PageProps } from './$types';
	import ModuleEditor from '#lib/components/teaching/ModuleEditor.svelte';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Créer un module · Coursely</title></svelte:head>
<ModuleEditor {data} />
