<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import PublicHeader from '#lib/components/publication/PublicHeader.svelte';
	import LegalFooter from '#lib/components/legal/LegalFooter.svelte';
	import QuizStudent from '#lib/components/quizzes/QuizStudent.svelte';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<PageHead
	title="Quiz · {data.courseTitle}"
	description="Rejoindre le quiz, répondre aux questions et remettre ses réponses."
/>
<svelte:head><meta name="robots" content="noindex, nofollow" /></svelte:head>
<PublicHeader className={data.className} academicYear={data.academicYear} mainId="quiz" />
<main id="quiz" tabindex="-1" class="quiz-page mx-auto min-h-svh max-w-[77.5rem]">
	<QuizStudent contextId={data.contextId} runId={data.runId} />
</main>
<LegalFooter />

<style>
	.quiz-page {
		padding: 1.5rem max(1.25rem, env(safe-area-inset-right, 0px)) 2rem max(1.25rem, env(safe-area-inset-left, 0px));
	}
	@media (min-width: 48rem) {
		.quiz-page {
			padding-top: 2rem;
		}
	}
</style>
