<script lang="ts">
	import TeacherAccess from '#lib/components/auth/TeacherAccess.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Activer mon espace enseignant — Coursely</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<TeacherAccess
	mode="activation"
	authReady={data.authReady}
	serviceUnavailable={data.serviceUnavailable}
/>
