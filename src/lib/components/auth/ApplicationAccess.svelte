<script lang="ts">
	import type { Snippet } from 'svelte';
	import ThemeSwitcher from '#lib/components/teacher/ThemeSwitcher.svelte';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	let { children, support, compact = false }: { children: Snippet; support?: Snippet; compact?: boolean } = $props();
</script>

<div class={['application-access', compact && 'compact']}>
	<a href="#application-access-content" class="sr-only focus:not-sr-only">Aller au contenu</a>
	<header>
		<span class="panel-title">Campus</span><Tooltip.Provider><ThemeSwitcher /></Tooltip.Provider>
	</header>
	<main id="application-access-content" tabindex="-1" class={support && !compact ? 'with-support' : undefined}>
		<div class="access-content">{@render children()}</div>
		{#if support && !compact}<aside class="access-support">{@render support()}</aside>{/if}
	</main>
</div>

<style>
	.application-access {
		display: flex;
		min-height: 100svh;
		flex-direction: column;
		padding-inline: env(safe-area-inset-left, 0px) env(safe-area-inset-right, 0px);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: calc(1.25rem + env(safe-area-inset-top, 0px)) clamp(1.25rem, 5vw, 5rem) 1.25rem;
		border-bottom: 1px solid var(--border);
	}
	main {
		width: min(calc(100% - 2.5rem), 40rem);
		margin: clamp(2rem, 7svh, 5rem) auto;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.access-content {
		min-width: 0;
		padding: clamp(1.5rem, 4vw, 2.5rem);
		border-radius: var(--radius);
		background: var(--card);
	}
	.access-support {
		min-width: 0;
		padding-top: 1.5rem;
	}
	@media (min-width: 64rem) {
		main.with-support {
			display: grid;
			width: min(calc(100% - 5rem), 72rem);
			grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
			align-items: stretch;
			gap: 0;
		}
		.access-content {
			grid-column: 2;
			grid-row: 1;
			padding: 3rem;
		}
		main.with-support .access-content {
			border-radius: 0 var(--radius) var(--radius) 0;
		}
		.access-support {
			grid-column: 1;
			grid-row: 1;
			padding: 3rem;
			background: var(--accent);
			border-radius: var(--radius) 0 0 var(--radius);
			color: var(--accent-foreground);
		}
	}
	@media (max-width: 30rem) {
		.access-content {
			border: 0;
			padding: 0;
			background: transparent;
		}
	}
	.compact main {
		width: min(calc(100% - 2.5rem), 32rem);
	}
	.compact .access-content {
		padding: clamp(1.5rem, 5vw, 2rem);
		border: 0;
		border-radius: var(--radius);
		background: var(--card);
	}
</style>
