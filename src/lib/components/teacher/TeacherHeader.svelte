<script lang="ts">
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';

	let {
		title = 'Mon espace',
		demo = false,
		parentLink
	}: { title?: string; demo?: boolean; parentLink?: { href: string; label: string } } = $props();
	const sidebar = Sidebar.useSidebar();
	const expanded = $derived(sidebar.isMobile ? sidebar.openMobile : sidebar.open);
	const toggleLabel = $derived(
		sidebar.isMobile
			? expanded
				? 'Fermer la navigation'
				: 'Ouvrir la navigation'
			: expanded
				? 'Masquer la navigation'
				: 'Afficher la navigation'
	);
</script>

<header class="teacher-header flex h-12 shrink-0 items-center border-b bg-background">
	<div class="header-controls flex w-full min-w-0 items-center gap-1 px-4 lg:gap-2 lg:px-6">
		<Sidebar.Trigger
			id="sidebar-toggle"
			class="-ms-1 size-11"
			aria-label={toggleLabel}
			aria-expanded={expanded}
		/>
		<Separator orientation="vertical" class="mx-2 data-vertical:h-4 data-vertical:self-auto" />
		{#if parentLink}<Button href={parentLink.href} variant="ghost" class="min-h-11 shrink-0"
				><ArrowLeftIcon data-icon="inline-start" />{parentLink.label}</Button
			><Separator
				orientation="vertical"
				class="mx-1 data-vertical:h-4 data-vertical:self-auto"
			/>{/if}
		<span class="min-w-0 text-sm font-medium wrap-anywhere">{title}</span>
		{#if demo}<Badge variant="outline" class="ms-auto shrink-0">Données fictives</Badge>{/if}
	</div>
</header>

<style>
	@media (max-width: 767px) {
		.teacher-header {
			position: sticky;
			top: 0;
			z-index: 20;
			height: calc(3rem + env(safe-area-inset-top, 0px));
			padding-top: env(safe-area-inset-top, 0px);
		}
		.header-controls {
			/* Include the trigger's negative inline margin in the safe-area clearance. */
			padding-left: max(1rem, calc(env(safe-area-inset-left, 0px) + 0.25rem));
			padding-right: max(1rem, env(safe-area-inset-right, 0px));
		}
	}
</style>
