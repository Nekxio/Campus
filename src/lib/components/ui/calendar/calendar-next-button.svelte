<script lang="ts">
	import { Calendar as CalendarPrimitive } from 'bits-ui';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { buttonVariants, type ButtonVariant } from '#lib/components/ui/button/index.js';
	import { cn } from '#lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		child: customChild,
		'aria-label': label = 'Mois suivant',
		variant = 'ghost',
		...restProps
	}: CalendarPrimitive.NextButtonProps & {
		variant?: ButtonVariant;
	} = $props();
</script>

{#snippet Fallback()}
	<ChevronRightIcon class={cn('cn-rtl-flip size-4', className)} />
{/snippet}

<CalendarPrimitive.NextButton
	bind:ref
	class={cn(
		buttonVariants({ variant }),
		'size-11 bg-transparent p-0 select-none disabled:opacity-50',
		'rtl:rotate-180',
		className
	)}
	{...restProps}
>
	{#snippet child({ props })}
		{#if customChild}
			{@render customChild({ props: { ...props, 'aria-label': label } })}
		{:else}
			<button {...props} aria-label={label}>
				{#if children}
					{@render children()}
				{:else}
					{@render Fallback()}
				{/if}
			</button>
		{/if}
	{/snippet}
</CalendarPrimitive.NextButton>
