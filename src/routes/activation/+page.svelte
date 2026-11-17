<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import TeacherAccess from '#lib/components/auth/TeacherAccess.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<PageHead
	title="Activer mon espace enseignant"
	description="Activer le compte enseignant de Campus avec une clé d’accès."
/>
<svelte:head><meta name="robots" content="noindex, nofollow" /></svelte:head>

<TeacherAccess mode="activation" authReady={data.authReady} serviceUnavailable={data.serviceUnavailable} />
