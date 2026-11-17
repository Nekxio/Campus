<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import type { PageProps } from './$types';
	import QuizDraftWorkspace from '#lib/components/quizzes/QuizDraftWorkspace.svelte';
	let { data }: PageProps = $props();
</script>

<PageHead title="Quiz · {data.module.title}" description="Préparer les quiz du module et ouvrir leurs salles." />
{#key data.module.id}<QuizDraftWorkspace {data} />{/key}
