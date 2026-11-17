<script lang="ts">
	import * as FormPrimitive from 'formsnap';
	import { cn, type WithoutChild } from '#lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'label',
		...restProps
	}: WithoutChild<FormPrimitive.LegendProps> & {
		variant?: 'label' | 'panel' | 'item';
	} = $props();
	const variantClasses = {
		label: 'text-sm leading-none font-medium',
		panel: 'panel-title',
		item: 'item-title'
	};
</script>

<FormPrimitive.Legend
	bind:ref
	class={cn(variantClasses[variant], 'data-[fs-error]:text-destructive', className)}
	{...restProps}
/>
