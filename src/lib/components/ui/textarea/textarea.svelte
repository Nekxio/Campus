<script lang="ts">
	import { cn, type WithElementRef, type WithoutChildren } from '#lib/utils.js';
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		'data-slot': dataSlot = 'textarea',
		...restProps
	}: WithoutChildren<WithElementRef<HTMLTextareaAttributes>> = $props();
</script>

<textarea
	bind:this={ref}
	data-slot={dataSlot}
	class={cn(
		'flex field-sizing-content min-h-16 w-full resize-none rounded-control border border-transparent bg-card px-3 py-3 text-base transition-[color,box-shadow,background-color] outline-none placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm',
		className
	)}
	bind:value
	{...restProps}></textarea>
