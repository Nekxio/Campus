<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import type { PageProps } from './$types';
	import TeacherHome from '#lib/components/teacher/TeacherHome.svelte';
	let { data }: PageProps = $props();
</script>

<PageHead
	title="Mon atelier"
	description="Préparer les cours, retrouver les prochaines séances et accéder aux corrections."
/>
<svelte:head><meta name="robots" content="noindex" /></svelte:head>

<TeacherHome userName={data.user.name} {data} />
