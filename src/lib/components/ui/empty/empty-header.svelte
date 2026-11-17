<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="empty-header"
	class={cn('flex w-full max-w-prose min-w-0 flex-col items-start gap-label', className)}
	{...restProps}
>
	{@render children?.()}
</div>
