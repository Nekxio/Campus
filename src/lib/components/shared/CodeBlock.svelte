<script lang="ts">
	import type { Snippet } from 'svelte';
	let { label, language, children }: { label: string; language?: string; children: Snippet } = $props();
</script>

<div class="code-block">
	{#if language}<div class="code-language">{language}</div>{/if}
	<!-- Scrollable source text must be reachable without a pointer. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<pre tabindex="0" role="region" aria-label={label}><code>{@render children()}</code></pre>
</div>

<style>
	.code-block {
		min-width: 0;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: var(--radius-control);
		background: var(--background);
	}
	.code-language {
		border-bottom: 1px solid var(--border);
		padding: 0.5rem 1rem;
		color: var(--muted-foreground);
		font-size: 0.75rem;
		font-weight: 500;
	}
	pre {
		max-width: 100%;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		padding: 1rem;
		font-family: var(--font-mono);
		font-size: 0.875rem;
		line-height: 1.7;
	}
	pre:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}
</style>
