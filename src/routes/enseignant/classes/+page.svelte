<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import type { PageProps } from './$types';
	import ClassesWorkspace from '#lib/components/teaching/ClassesWorkspace.svelte';
	let { data }: PageProps = $props();
</script>

<PageHead title="Mes classes" description="Gérer les listes de classe et retrouver leurs modules." />
<ClassesWorkspace {data} />
