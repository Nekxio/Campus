<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import type { PageProps } from './$types';
	import ProposalReview from '#lib/components/grading/ProposalReview.svelte';
	let { data }: PageProps = $props();
</script>

<PageHead
	title="Propositions de correction"
	description="Comparer les propositions de correction aux points enregistrés avant de décider."
/>
<ProposalReview data={data.review} />
