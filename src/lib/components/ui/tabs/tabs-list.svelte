<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants/lite';

	export const tabsListVariants = tv({
		base: 'rounded-control p-1 group-data-vertical/tabs:rounded-control data-[variant=line]:rounded-none group/tabs-list inline-flex w-fit items-center justify-center text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col',
		variants: {
			variant: {
				default: 'bg-muted',
				line: 'justify-start gap-1 border-b bg-transparent p-0 pb-1'
			}
		},
		defaultVariants: {
			variant: 'default'
		}
	});

	export type TabsListVariant = VariantProps<typeof tabsListVariants>['variant'];
</script>

<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn } from '#lib/utils.js';

	let {
		ref = $bindable(null),
		variant = 'default',
		class: className,
		...restProps
	}: TabsPrimitive.ListProps & {
		variant?: TabsListVariant;
	} = $props();
</script>

<TabsPrimitive.List
	bind:ref
	data-slot="tabs-list"
	data-variant={variant}
	class={cn(tabsListVariants({ variant }), className)}
	{...restProps}
/>
