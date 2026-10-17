<script lang="ts">
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<div class="application-access">
	<header><span>Coursely</span></header>
	<main id="application-access-content" tabindex="-1">{@render children()}</main>
	<footer>Espace enseignant</footer>
</div>

<style>
	.application-access {
		display: flex;
		min-height: 100svh;
		flex-direction: column;
	}
	header {
		padding: calc(2.25rem + env(safe-area-inset-top, 0px)) 1.25rem 2.25rem;
		text-align: center;
	}
	header span {
		font-size: 1.25rem;
		font-weight: 600;
		letter-spacing: -0.025em;
	}
	main {
		width: calc(100% - 2.5rem);
		max-width: 30rem;
		margin: 3rem auto;
	}
	footer {
		margin-top: auto;
		padding: 1.25rem 1.25rem calc(1.75rem + env(safe-area-inset-bottom, 0px));
		color: var(--muted-foreground);
		text-align: center;
		font-size: 0.75rem;
	}
	@media (max-width: 600px), (max-height: 760px) {
		header {
			padding-top: calc(1.5rem + env(safe-area-inset-top, 0px));
			padding-bottom: 1.25rem;
		}
		main {
			margin-top: 1.75rem;
			margin-bottom: 2.25rem;
		}
	}
</style>
