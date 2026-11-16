<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '#lib/utils.js';

	let {
		title,
		description,
		level = 2,
		actions,
		id,
		class: className,
		...restProps
	}: Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> & {
		title: string;
		description?: string;
		level?: 2 | 3;
		actions?: Snippet;
	} = $props();
</script>

<header class={cn('section-header', className)} {...restProps}>
	<div class="min-w-0">
		<svelte:element this={level === 2 ? 'h2' : 'h3'} {id} class="section-title">
			{title}
		</svelte:element>
		{#if description}<p class="mt-2 max-w-prose supporting-text">{description}</p>{/if}
	</div>
	{#if actions}<div class="section-actions">{@render actions()}</div>{/if}
</header>
