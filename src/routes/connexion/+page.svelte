<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import TeacherAccess from '#lib/components/auth/TeacherAccess.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<PageHead title="Accès enseignant" description="Ouvrir l’espace enseignant de Campus avec une clé d’accès." />
<svelte:head><meta name="robots" content="noindex, nofollow" /></svelte:head>

<TeacherAccess mode="sign-in" authReady={data.authReady} serviceUnavailable={data.serviceUnavailable} />
