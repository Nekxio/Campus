<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '#lib/utils.js';

	let {
		ref = $bindable(null),
		element = 'section',
		padding = true,
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLElement>> & {
		element?: 'section' | 'div';
		padding?: boolean;
	} = $props();
</script>

<svelte:element
	this={element}
	bind:this={ref}
	data-slot="work-surface"
	data-padded={padding}
	class={cn('work-surface', className)}
	{...restProps}
>
	{@render children?.()}
</svelte:element>
