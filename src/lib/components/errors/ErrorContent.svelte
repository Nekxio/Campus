<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
	let {
		status,
		audience = 'general',
		classId
	}: {
		status: number;
		audience?: 'general' | 'public' | 'teacher';
		classId?: string;
	} = $props();
	const missing = $derived(status === 404);
	const unavailable = $derived(status >= 500);
	const teacher = $derived(audience === 'teacher');
	const title = $derived(
		missing
			? teacher
				? 'Cet élément est introuvable'
				: 'Cette page est introuvable'
			: unavailable
				? teacher
					? 'Cet espace ne répond pas pour le moment'
					: 'Cette page ne répond pas pour le moment'
				: 'Cette page n’est pas accessible'
	);
	const description = $derived(
		missing
			? audience === 'public'
				? 'Le lien est peut-être incomplet, ou la page n’est plus accessible. Vérifiez l’adresse reçue. Si elle est correcte, demandez un nouveau lien à votre intervenant.'
				: 'Le lien est peut-être incomplet, ou cet élément n’est plus accessible. Vérifiez l’adresse ou revenez à votre accueil.'
			: unavailable
				? 'La page demandée n’a pas pu être chargée. Vous pouvez réessayer ou revenir à l’accueil.'
				: 'Vous ne pouvez pas ouvrir cette page. Revenez à l’accueil pour retrouver les pages disponibles.'
	);
</script>

<svelte:head>
	<title>{title} · Coursely</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="error-content">
	<span
		class="inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground"
	>
		{missing
			? 'Page introuvable'
			: unavailable
				? 'Indisponibilité temporaire'
				: 'Accès indisponible'}
	</span>
	<h1 class="mt-6 text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
		{title}
	</h1>
	<p class="mt-5 leading-relaxed text-muted-foreground">{description}</p>
	<div class="mt-10 border-t pt-7">
		<p class="mb-3 text-sm font-semibold">
			{audience === 'public' && missing ? 'Pour retrouver votre cours' : 'Pour reprendre'}
		</p>
		<div class="error-actions flex flex-wrap gap-3">
			{#if unavailable}
				<Button href={page.url.href} data-sveltekit-reload>Réessayer</Button>
			{/if}
			{#if audience === 'public' && classId}
				<Button variant="outline" href={resolve('/classes/[classId]', { classId })}>
					Retour à la classe
				</Button>
			{:else}
				<Button variant="outline" href={resolve('/')}>
					{teacher ? 'Retour à mon accueil' : 'Retour à l’accueil'}
				</Button>
			{/if}
		</div>
	</div>
</div>

<style>
	.error-content {
		max-width: 41rem;
		overflow-wrap: anywhere;
	}
	@media (max-width: 25rem) {
		.error-actions {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
