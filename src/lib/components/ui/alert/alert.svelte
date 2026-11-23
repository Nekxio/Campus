<script lang="ts" module>
	import { type VariantProps, tv } from 'tailwind-variants/lite';

	export const alertVariants = tv({
		base: "grid gap-1 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-3 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4 group/alert relative w-full",
		variants: {
			variant: {
				default: 'text-card-foreground',
				destructive: 'text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current'
			},
			appearance: {
				panel: 'rounded-2xl border bg-card px-4 py-3',
				inline: ''
			}
		},
		defaultVariants: {
			variant: 'default',
			appearance: 'panel'
		}
	});

	export type AlertVariant = VariantProps<typeof alertVariants>['variant'];
</script>

<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		variant = 'default',
		appearance = 'panel',
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		variant?: AlertVariant;
		appearance?: VariantProps<typeof alertVariants>['appearance'];
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="alert"
	role="alert"
	class={cn(alertVariants({ variant, appearance }), className)}
	{...restProps}
>
	{@render children?.()}
</div>
