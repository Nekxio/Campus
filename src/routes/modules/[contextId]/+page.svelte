<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import PublicCourse from '#lib/components/publication/PublicCourse.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<PageHead
	title="{data.snapshot.title} · {data.snapshot.className}"
	description={data.snapshot.description.slice(0, 160)}
	publicContent
/>
<PublicCourse {data} />
