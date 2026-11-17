<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLTableRowElement>> = $props();
</script>

<tr
	bind:this={ref}
	data-slot="table-row"
	class={cn(
		'border-b transition-colors has-aria-expanded:bg-muted data-[state=selected]:bg-accent data-[state=selected]:text-accent-foreground data-[state=selected]:hover:bg-accent [&_a[data-row-link]]:hover:no-underline [&:not(thead_*)]:hover:bg-muted',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</tr>
