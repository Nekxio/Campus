<script lang="ts">
	import TeacherAccess from '#lib/components/auth/TeacherAccess.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Connexion — Coursely</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<TeacherAccess
	mode="sign-in"
	authReady={data.authReady}
	serviceUnavailable={data.serviceUnavailable}
/>
