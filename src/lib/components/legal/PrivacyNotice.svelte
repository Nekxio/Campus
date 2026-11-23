<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<p class="privacy-notice">
	{@render children()}
	<a href={resolve('/confidentialite')} target="_blank" rel="noopener noreferrer"
		>Protection des données<span class="sr-only"> (nouvel onglet)</span></a
	>.
</p>

<style>
	.privacy-notice {
		max-inline-size: var(--legal-reading-measure);
		margin-block: 1rem;
		color: var(--muted-foreground);
		font-size: 0.875rem;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	a {
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	a:hover {
		color: var(--foreground);
	}
	a:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 3px;
	}
</style>
