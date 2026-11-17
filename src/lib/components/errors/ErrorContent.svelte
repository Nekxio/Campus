<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import WorkSurface from '#lib/components/shared/WorkSurface.svelte';
	let {
		status,
		audience = 'general',
		classId
	}: {
		status: number;
		audience?: 'general' | 'public' | 'teacher';
		classId?: string | null;
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
			? teacher
				? 'Le lien est peut-être incomplet, ou cet élément n’est plus accessible. Vérifiez l’adresse ou revenez à votre accueil.'
				: 'Le lien est peut-être incomplet, ou la page n’est plus accessible. Vérifiez l’adresse reçue.'
			: unavailable
				? teacher
					? 'La page demandée n’a pas pu être chargée. Vous pouvez réessayer ou revenir à l’accueil.'
					: 'La page demandée n’a pas pu être chargée. Vous pouvez réessayer dans un instant.'
				: teacher
					? 'Vous ne pouvez pas ouvrir cette page. Revenez à l’accueil pour retrouver les pages disponibles.'
					: 'Vous ne pouvez pas ouvrir cette page avec ce lien.'
	);
</script>

<PageHead {title} {description} />
<svelte:head><meta name="robots" content="noindex, nofollow" /></svelte:head>

<WorkSurface element="div" class="error-content">
	<div class="error-heading">
		<h1 class="page-title">{title}</h1>
		<Badge variant="outline"
			>{missing ? 'Page introuvable' : unavailable ? 'Indisponibilité temporaire' : 'Accès indisponible'}</Badge
		>
	</div>
	<p class="error-description reading-text">{description}</p>
	<div class="error-recovery">
		<p class="mb-3 text-sm font-semibold">
			{audience === 'public' && missing ? 'Pour retrouver votre cours' : 'Pour reprendre'}
		</p>
		<div class="error-actions flex flex-wrap gap-3">
			{#if unavailable}
				<Button href={page.url.href} data-sveltekit-reload>Réessayer</Button>
			{/if}
			{#if audience === 'public' && classId}
				<Button variant="outline" href={resolve('/classes/[classId]', { classId })} data-sveltekit-reload>
					Voir les cours de la classe
				</Button>
			{:else if teacher}
				<Button variant="outline" href={resolve('/')}>Retour à mon accueil</Button>
			{:else if audience === 'public'}
				<p class="text-sm leading-relaxed text-muted-foreground">Demandez le lien du cours à votre enseignant.</p>
			{:else}
				<p class="text-sm leading-relaxed text-muted-foreground">Vérifiez l’adresse de la page.</p>
			{/if}
		</div>
	</div>
</WorkSurface>

<style>
	:global(.error-content) {
		max-width: 50rem;
		overflow-wrap: anywhere;
	}
	.error-heading {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1rem;
	}
	h1 {
		max-width: 24ch;
	}
	.error-description {
		max-width: 65ch;
		margin-top: 1.5rem;
		color: var(--muted-foreground);
	}
	.error-recovery {
		margin-top: 2rem;
		border-top: 1px solid var(--border);
		padding-top: 1.5rem;
	}
	@media (max-width: 25rem) {
		.error-actions {
			flex-direction: column;
			align-items: stretch;
		}
	}
	@media (min-width: 50rem) {
		:global(.error-content) {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 2rem;
			max-width: 65rem;
		}
		.error-heading {
			grid-row: span 2;
		}
		.error-description {
			margin-top: 0;
		}
		.error-recovery {
			margin-top: 0;
		}
	}
</style>
