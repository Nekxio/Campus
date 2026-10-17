<script lang="ts">
	import PublicCourse from '#lib/components/publication/PublicCourse.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<svelte:head
	><title>{data.snapshot.title} · {data.snapshot.className} · Coursely</title><meta
		name="description"
		content={data.snapshot.description.slice(0, 160)}
	/></svelte:head
>
<PublicCourse {data} />
