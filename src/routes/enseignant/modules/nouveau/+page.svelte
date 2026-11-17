<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import type { PageProps } from './$types';
	import ModuleEditor from '#lib/components/teaching/ModuleEditor.svelte';
	let { data }: PageProps = $props();
</script>

<PageHead title="Créer un module" description="Créer un module et préparer son contenu pédagogique." />
<ModuleEditor {data} />
