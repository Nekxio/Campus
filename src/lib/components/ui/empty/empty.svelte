<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		variant = 'plain',
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		variant?: 'plain' | 'surface';
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="empty"
	data-variant={variant}
	class={cn(
		'flex w-full min-w-0 flex-col items-start gap-content text-start',
		variant === 'surface' && 'work-surface p-(--surface-padding)',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
