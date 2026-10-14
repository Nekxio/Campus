<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import PublicHeader from './PublicHeader.svelte';
	let { status }: { status: number } = $props();
	const missing = $derived(status === 404);
</script>

<svelte:head
	><title>{missing ? 'Page indisponible' : 'Service temporairement indisponible'} · Coursely</title
	><meta name="robots" content="noindex" /></svelte:head
>
<PublicHeader mainId="page-indisponible" />
<main
	id="page-indisponible"
	tabindex="-1"
	class="unavailable mx-auto flex max-w-3xl flex-col gap-7"
>
	<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">
		{missing ? 'Cette page n’est pas disponible' : 'Le contenu est temporairement indisponible'}
	</h1>
	<Empty.Root>
		<Empty.Header
			><Empty.Title
				>{missing
					? 'Le lien ne donne plus accès à une page publique'
					: 'La page n’a pas pu être chargée'}</Empty.Title
			><Empty.Description
				>{missing
					? 'La page peut ne pas être publiée ou ne plus être accessible. Vérifiez le lien qui vous a été transmis.'
					: 'Réessayez dans un instant pour consulter le contenu.'}</Empty.Description
			></Empty.Header
		>
		<Empty.Content
			><Button variant="outline" onclick={() => window.location.reload()}>Réessayer</Button
			></Empty.Content
		>
	</Empty.Root>
</main>

<style>
	.unavailable {
		min-height: calc(100svh - 5rem);
		padding: 3rem max(1.25rem, env(safe-area-inset-right, 0px))
			calc(3rem + env(safe-area-inset-bottom, 0px)) max(1.25rem, env(safe-area-inset-left, 0px));
		overflow-wrap: anywhere;
	}
</style>
