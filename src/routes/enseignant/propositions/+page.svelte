<script lang="ts">
	import type { PageProps } from './$types';
	import ProposalReview from '#lib/components/grading/ProposalReview.svelte';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Propositions de correction · Coursely</title></svelte:head>
<ProposalReview data={data.review} />
