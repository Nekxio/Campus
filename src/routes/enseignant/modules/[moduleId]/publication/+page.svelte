<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import type { PublicationReviewData } from '#lib/domain/publication.js';
	import PublicationReview from '#lib/components/publication/PublicationReview.svelte';
	let { data }: { data: PublicationReviewData } = $props();
</script>

<PageHead
	title="Publication · {data.module.title}"
	description="Relire le contenu étudiant avant de le publier ou de retirer sa publication."
/>
{#key `${data.module.id}:${data.selected?.context.id ?? 'none'}`}<PublicationReview {data} />{/key}
