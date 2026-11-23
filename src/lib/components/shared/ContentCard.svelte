<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { LucideIcon } from '@lucide/svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';

	type Action =
		| { kind: 'link'; href: string; external?: boolean; onclick?: never; actions?: never }
		| { kind: 'button'; onclick: () => void; href?: never; external?: never; actions?: never }
		| { kind: 'static'; actions?: Snippet; href?: never; external?: never; onclick?: never };
	let {
		title,
		id,
		marker,
		icon: Icon,
		tone = 'neutral',
		metadata,
		status,
		heading = 'h3',
		muted = false,
		...action
	}: {
		title: string;
		id?: string;
		marker?: string;
		icon?: LucideIcon;
		tone?: 'neutral' | 'learning' | 'practice';
		metadata?: Snippet;
		status?: Snippet;
		heading?: 'h2' | 'h3' | 'h4' | 'h5';
		muted?: boolean;
	} & Action = $props();
</script>

{#snippet label()}
	{#if Icon}<span class="content-symbol"><Icon aria-hidden="true" /></span>{/if}
	{#if marker}<span class="content-marker">{marker}</span>{/if}<span class="min-w-0">{title}</span>
{/snippet}

<Card.Root
	class="relative h-full overflow-visible"
	data-content-card
	data-tone={tone}
	data-muted={muted}
	data-interactive={action.kind !== 'static'}
>
	<Card.Header class="min-w-0">
		<Card.Title>
			<svelte:element this={heading} class="content-title">
				{#if action.kind === 'link'}
					<!-- The caller supplies an existing validated destination. -->
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<a
						{id}
						href={action.href}
						target={action.external ? '_blank' : undefined}
						rel={action.external ? 'noopener noreferrer' : undefined}
						class="content-link"
					>
						{@render label()}{#if action.external}<ArrowUpRightIcon class="external-symbol" aria-hidden="true" /><span
								class="sr-only"
							>
								· lien externe, nouvel onglet</span
							>{/if}
					</a>
				{:else if action.kind === 'button'}
					<button {id} type="button" onclick={action.onclick} class="content-link">{@render label()}</button>
				{:else}<span class="content-label">{@render label()}</span>{/if}
			</svelte:element>
		</Card.Title>
		{#if metadata}<Card.Description>{@render metadata()}</Card.Description>{/if}
	</Card.Header>
	{#if action.kind === 'static'}
		{#if status || action.actions}<Card.Footer class="mt-auto flex-wrap justify-between gap-3">
				{#if status}{@render status()}{/if}
				{@render action.actions?.()}
			</Card.Footer>{/if}
	{/if}
</Card.Root>

<style>
	:global([data-content-card]) {
		--content-tint: var(--muted);
		--content-ink: var(--primary);
		--content-description: var(--muted-foreground);
		background: var(--content-tint);
	}
	:global([data-content-card][data-tone='learning']) {
		--content-tint: var(--accent);
		--content-description: var(--accent-foreground);
	}
	:global([data-content-card][data-tone='practice']) {
		--content-tint: var(--practice);
		--content-ink: var(--practice-foreground);
		--content-description: var(--practice-foreground);
	}
	:global([data-content-card][data-muted='true']) {
		--content-tint: var(--muted);
		--content-description: var(--muted-foreground);
	}
	:global([data-content-card] [data-slot='card-description']) {
		color: var(--content-description);
	}
	.content-label,
	.content-link {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}
	.content-title {
		overflow-wrap: anywhere;
	}
	:global([data-content-card] .external-symbol) {
		width: var(--icon-size);
		height: var(--icon-size);
		flex-shrink: 0;
		margin-top: 0.25rem;
		margin-inline-start: auto;
		color: var(--content-ink);
	}
	.content-marker,
	.content-symbol {
		flex-shrink: 0;
		color: var(--content-ink);
	}
	.content-symbol {
		padding-top: 0.25rem;
	}
	.content-symbol :global(svg) {
		width: var(--icon-size);
		height: var(--icon-size);
	}
	.content-marker {
		font-variant-numeric: tabular-nums;
	}
	.content-link {
		width: 100%;
		min-width: 0;
		text-align: start;
		cursor: pointer;
	}
	.content-link::after {
		position: absolute;
		inset: 0;
		border-radius: var(--radius-container);
		content: '';
	}
	.content-link:focus-visible {
		outline: none;
	}
	.content-link:focus-visible::after {
		outline: 2px solid var(--ring);
		outline-offset: 3px;
	}
	:global([data-content-card][data-interactive='true']) {
		transition: background-color var(--motion-fast) var(--ease-work);
	}
	:global([data-content-card][data-interactive='true']:has(:focus-visible)) {
		background: color-mix(in oklch, var(--content-tint), var(--content-ink) 8%);
	}
	@media (hover: hover) {
		:global([data-content-card][data-interactive='true']:hover) {
			background: color-mix(in oklch, var(--content-tint), var(--content-ink) 8%);
		}
	}
	:global([data-content-card][data-interactive='true']:has(.content-link:active)) {
		background: color-mix(in oklch, var(--content-tint), var(--content-ink) 10%);
	}
	@media (prefers-reduced-motion: reduce) {
		:global([data-content-card]) {
			transition: none;
		}
	}
</style>
