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
	data-slot="empty-content"
	class={cn('flex w-full max-w-prose min-w-0 flex-col items-start gap-3 text-sm', className)}
	{...restProps}
>
	{@render children?.()}
</div>
