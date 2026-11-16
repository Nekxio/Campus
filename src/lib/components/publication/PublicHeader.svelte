<script lang="ts">
	import { resolve } from '$app/paths';
	import ThemeSwitcher from '#lib/components/teacher/ThemeSwitcher.svelte';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	let {
		className = null,
		academicYear = null,
		mainId = 'cours',
		showSkipLink = true,
		homeLink = false
	}: {
		className?: string | null;
		academicYear?: string | null;
		mainId?: string;
		showSkipLink?: boolean;
		homeLink?: boolean;
	} = $props();
</script>

{#if showSkipLink}<a
		href={`#${mainId}`}
		class="fixed top-3 left-3 z-50 -translate-y-24 rounded-control bg-background px-4 py-3 text-sm font-medium focus:translate-y-0 focus-visible:ring-3 focus-visible:ring-ring"
		>Aller au contenu</a
	>{/if}
<header class="public-header">
	<div class="header-inner">
		{#if homeLink}
			<a class="campus-wordmark" href={resolve('/')}>Campus</a>
		{:else}
			<span class="campus-wordmark">Campus</span>
		{/if}
		{#if className}
			<p class="public-context min-w-0 text-sm text-muted-foreground">
				<span>{className}</span>{#if academicYear}
					<span class="context-year">· {academicYear}</span>{/if}
			</p>
		{/if}
		<div class="ml-auto w-fit shrink-0">
			<Tooltip.Provider><ThemeSwitcher /></Tooltip.Provider>
		</div>
	</div>
</header>

<style>
	.public-header {
		background: var(--card);
		border-bottom: 1px solid var(--border);
		padding: calc(0.75rem + env(safe-area-inset-top, 0px)) max(1.25rem, env(safe-area-inset-right, 0px)) 0.75rem
			max(1.25rem, env(safe-area-inset-left, 0px));
	}
	.header-inner {
		display: flex;
		max-width: 77.5rem;
		margin-inline: auto;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem 1.5rem;
		min-height: 3rem;
	}
	.campus-wordmark:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 4px;
	}
	.public-context {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		overflow-wrap: anywhere;
	}
	.context-year {
		white-space: nowrap;
	}
	@media (min-width: 48rem) {
		.public-context {
			border-left: 1px solid var(--border);
			padding-left: 1.5rem;
		}
	}
	@media (max-width: 35rem) {
		.public-context {
			order: 3;
			flex-basis: 100%;
		}
	}
</style>
