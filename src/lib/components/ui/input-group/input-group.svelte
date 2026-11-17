<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...props
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="input-group"
	role="group"
	class={cn(
		'group/input-group relative flex min-h-11 w-full min-w-0 items-center rounded-control border border-(--control-border) bg-card transition-[color,box-shadow,background-color] outline-none in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0 has-data-[align=block-end]:rounded-control has-data-[align=block-start]:rounded-control has-[[data-slot][aria-invalid=true]]:border-destructive has-[textarea]:rounded-control has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>textarea]:h-auto has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-end]]:[&>input]:pr-2 has-[>[data-align=inline-start]]:[&>input]:pl-2',
		className
	)}
	{...props}
>
	{@render children?.()}
</div>

<style>
	div:has(:global([data-slot='input-group-control']:focus-visible)) {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	div:has(:global([aria-invalid='true']:focus-visible)) {
		outline-color: var(--destructive);
	}
	div :global([data-slot='input-group-control']:focus-visible) {
		outline: none;
	}
</style>
