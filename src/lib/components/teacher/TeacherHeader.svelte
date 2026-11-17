<script lang="ts">
	import type { Snippet } from 'svelte';
	import { navigating } from '$app/state';
	import { cn } from '#lib/utils.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import ThemeSwitcher from './ThemeSwitcher.svelte';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';

	let {
		title = 'Mon espace',
		demo = false,
		parentLink,
		class: className,
		context,
		actions
	}: {
		title?: string;
		demo?: boolean;
		parentLink?: { href: string; label: string };
		class?: string;
		context?: Snippet;
		actions?: Snippet;
	} = $props();
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

<header class={cn('teacher-header flex min-h-16 shrink-0 items-center border-b bg-card', className)}>
	<div class="header-controls flex w-full min-w-0 items-center gap-1 px-4 lg:gap-2 lg:px-6">
		{@render navigationToggle()}
		<Separator orientation="vertical" class="mx-2 data-vertical:h-4 data-vertical:self-auto" />
		{#if parentLink}<Button
				href={parentLink.href}
				variant="ghost"
				size="icon"
				class="header-parent shrink-0 sm:h-auto sm:w-auto sm:gap-2 sm:px-3"
				><ArrowLeftIcon data-icon="inline-start" aria-hidden="true" /><span class="sr-only sm:not-sr-only"
					>{parentLink.label}</span
				></Button
			><Separator orientation="vertical" class="mx-1 hidden sm:block data-vertical:h-4 data-vertical:self-auto" />{/if}
		<div class="flex min-w-0 flex-1 items-center gap-2">
			{#if context}
				<div class="min-w-0 py-2">{@render context()}</div>
			{:else}
				<span class="min-w-0 text-sm font-medium wrap-anywhere">{title}</span>
			{/if}
			<div class="flex size-4 shrink-0 items-center justify-center">
				{#if navigating.to}<span role="status" class="flex text-muted-foreground"
						><Spinner /><span class="sr-only">Chargement de la page…</span></span
					>{/if}
			</div>
		</div>
		{@render actions?.()}
		{#if demo}<Badge variant="outline" class="shrink-0">Données fictives</Badge>{/if}
		<ThemeSwitcher />
	</div>
</header>

{#snippet navigationToggle()}
	<Sidebar.Trigger
		id={context ? 'context-sidebar-toggle' : 'sidebar-toggle'}
		class="-ms-1 size-11"
		aria-label={toggleLabel}
		aria-expanded={expanded}
	/>
{/snippet}

<style>
	.teacher-header {
		position: sticky;
		top: 0;
		z-index: 20;
	}
	@media (max-width: 767px) {
		.teacher-header {
			min-height: calc(3.25rem + env(safe-area-inset-top, 0px));
			padding-top: env(safe-area-inset-top, 0px);
		}
		.header-controls :global(.header-parent) {
			max-width: 40%;
			white-space: normal;
			text-align: left;
		}
		.header-controls {
			/* Include the trigger's negative inline margin in the safe-area clearance. */
			padding-left: max(1rem, calc(env(safe-area-inset-left, 0px) + 0.25rem));
			padding-right: max(1rem, env(safe-area-inset-right, 0px));
		}
	}
</style>
