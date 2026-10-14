<script lang="ts">
	import type { PageProps } from './$types';
	import TeacherHome from '#lib/components/teacher/TeacherHome.svelte';
	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Mon accueil · Coursely</title>
	<meta name="robots" content="noindex" />
	<meta
		name="description"
		content="Préparer les modules, retrouver les supports et accéder à la notation dans Coursely."
	/>
</svelte:head>

<TeacherHome userName={data.user.name} {data} />
