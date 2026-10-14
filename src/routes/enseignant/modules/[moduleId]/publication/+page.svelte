<script lang="ts">
	import type { PublicationReviewData } from '#lib/domain/publication.js';
	import PublicationReview from '#lib/components/publication/PublicationReview.svelte';
	let { data }: { data: PublicationReviewData } = $props();
</script>

<svelte:head><title>Publication · {data.module.title} · Coursely</title></svelte:head>
{#key `${data.module.id}:${data.selected?.context.id ?? 'none'}`}<PublicationReview {data} />{/key}
