<script lang="ts" module>
	import { type VariantProps, tv } from 'tailwind-variants/lite';
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

	export const buttonVariants = tv({
		base: "focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive rounded-control min-h-11 min-w-0 max-w-full border border-transparent bg-clip-padding py-2 text-sm font-medium focus-visible:ring-3 aria-invalid:ring-3 active:not-aria-[haspopup]:translate-y-px [&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 items-center justify-center wrap-break-word whitespace-normal transition-[background-color,border-color,color,box-shadow,transform] duration-(--motion-fast) ease-(--ease-work) outline-none select-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
				outline:
					'border-border bg-card text-foreground hover:bg-muted aria-expanded:bg-muted aria-expanded:text-foreground',
				secondary:
					'border-border bg-card text-foreground hover:bg-muted aria-expanded:bg-muted aria-expanded:text-foreground',
				ghost: 'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground',
				destructive:
					'bg-destructive-action text-destructive-action-foreground hover:bg-destructive-action/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
				'destructive-outline':
					'border-destructive bg-background text-destructive hover:bg-destructive/10 hover:text-destructive aria-expanded:bg-destructive/10 aria-expanded:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
				'destructive-ghost': 'text-destructive hover:bg-destructive/10 hover:text-destructive',
				link: 'text-primary underline-offset-4 hover:underline'
			},
			size: {
				default: 'h-auto gap-2 px-3 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
				xs: "h-auto gap-1 px-3 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4",
				sm: 'h-auto gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
				lg: 'h-auto gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
				icon: 'size-11',
				'icon-xs': "size-11 [&_svg:not([class*='size-'])]:size-4",
				'icon-sm': 'size-11',
				'icon-lg': 'size-11'
			}
		},
		defaultVariants: {
			variant: 'default',
			size: 'default'
		}
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
	export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
		};
</script>

<script lang="ts">
	let {
		class: className,
		variant = 'default',
		size = 'default',
		ref = $bindable(null),
		href = undefined,
		type = 'button',
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();
</script>

{#if href}
	<!-- The caller resolves internal routes; this primitive also accepts external URLs and anchors. -->
	<!-- eslint-disable svelte/no-navigation-without-resolve -->
	<a
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		href={disabled ? undefined : href}
		aria-disabled={disabled}
		role={disabled ? 'link' : undefined}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
