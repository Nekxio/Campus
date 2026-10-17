<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements';

	type InputType = Exclude<HTMLInputTypeAttribute, 'file'>;

	type Props = WithElementRef<
		Omit<HTMLInputAttributes, 'type'> &
			({ type: 'file'; files?: FileList } | { type?: InputType; files?: undefined })
	> & { density?: 'default' | 'compact' };

	let {
		ref = $bindable(null),
		value = $bindable(),
		type,
		files = $bindable(),
		class: className,
		density = 'default',
		'data-slot': dataSlot = 'input',
		...restProps
	}: Props = $props();
</script>

{#if type === 'file'}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		data-density={density}
		class={cn(
			'h-10 min-h-10 w-full min-w-0 rounded-lg border border-transparent bg-input/50 px-3 py-1 text-base text-foreground transition-[color,box-shadow,background-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-[density=compact]:h-8 data-[density=compact]:min-h-8 data-[density=compact]:px-2 md:text-sm dark:aria-invalid:border-destructive/50',
			className
		)}
		type="file"
		bind:files
		bind:value
		{...restProps}
	/>
{:else}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		data-density={density}
		class={cn(
			'h-10 min-h-10 w-full min-w-0 rounded-lg border border-transparent bg-input/50 px-3 py-1 text-base text-foreground transition-[color,box-shadow,background-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-[density=compact]:h-8 data-[density=compact]:min-h-8 data-[density=compact]:px-2 md:text-sm dark:aria-invalid:border-destructive/50',
			className
		)}
		{type}
		bind:value
		{...restProps}
	/>
{/if}
