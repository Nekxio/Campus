<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import type { PageProps } from './$types';
	import QuizTeacherRoom from '#lib/components/quizzes/QuizTeacherRoom.svelte';
	let { data }: PageProps = $props();
</script>

<PageHead
	title="{data.view.title} · Quiz en direct"
	description="Suivre les participations et piloter une salle de quiz."
/>
{#key data.run.id}<QuizTeacherRoom {data} />{/key}
