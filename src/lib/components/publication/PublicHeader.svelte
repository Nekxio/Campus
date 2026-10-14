<script lang="ts">
	import ThemeSwitcher from '#lib/components/teacher/ThemeSwitcher.svelte';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	let {
		className = null,
		academicYear = null,
		mainId = 'cours'
	}: { className?: string | null; academicYear?: string | null; mainId?: string } = $props();
</script>

<a
	href={`#${mainId}`}
	class="fixed top-3 left-3 -translate-y-24 rounded-xl bg-background px-4 py-3 text-sm font-medium focus:translate-y-0 focus-visible:ring-3 focus-visible:ring-ring"
	>Aller au contenu</a
>
<header class="public-header border-b bg-sidebar">
	<div class="header-inner mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3">
		<span class="text-xl font-semibold tracking-tight">Coursely</span>
		{#if className}
			<p class="public-context min-w-0 text-sm text-muted-foreground">
				{className}{#if academicYear}
					· {academicYear}{/if}
			</p>
		{/if}
		<div class="ml-auto w-36 shrink-0">
			<Tooltip.Provider><ThemeSwitcher /></Tooltip.Provider>
		</div>
	</div>
</header>

<style>
	.public-header {
		padding: calc(0.625rem + env(safe-area-inset-top, 0px))
			max(1.25rem, env(safe-area-inset-right, 0px)) 0.625rem
			max(1.25rem, env(safe-area-inset-left, 0px));
	}
	.header-inner {
		min-height: 3.25rem;
	}
	.public-context {
		overflow-wrap: anywhere;
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
