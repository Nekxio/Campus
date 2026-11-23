<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import type { Snippet } from 'svelte';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import PublicHeader from '#lib/components/publication/PublicHeader.svelte';
	import LegalFooter from './LegalFooter.svelte';
	let {
		title,
		description,
		sections,
		children
	}: {
		title: string;
		description: string;
		sections: { id: string; title: string }[];
		children: Snippet;
	} = $props();
</script>

<PageHead {title} {description} publicContent />
<svelte:head><meta name="robots" content="noindex, nofollow" /></svelte:head>

<div class="legal-document">
	<PublicHeader mainId="legal-content" homeLink />
	<main id="legal-content" tabindex="-1">
		<header>
			<h1 class="page-title">{title}</h1>
			<p class="introduction">{description}</p>
			<p class="updated">Version du <time datetime="2026-11-12">12 novembre 2026</time></p>
		</header>
		<nav aria-label="Sommaire" class="legal-contents work-surface">
			<details class="group">
				<summary class="flex min-h-11 items-center justify-between gap-3 rounded-control">
					<span class="item-title">Sommaire</span>
					<ChevronDownIcon
						class="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
						aria-hidden="true"
					/>
				</summary>
				<ul>
					{#each sections as section (section.id)}<li>
							<a href={'#' + section.id}>{section.title}</a>
						</li>{/each}
				</ul>
			</details>
		</nav>
		<div
			class="legal-copy prose max-w-none prose-headings:font-semibold prose-code:before:content-none prose-code:after:content-none"
		>
			{@render children()}
		</div>
	</main>
	<LegalFooter class="mt-auto" />
</div>

<style>
	.legal-document {
		display: flex;
		flex-direction: column;
		min-height: 100svh;
	}
	main {
		width: min(calc(100% - 2.5rem), 70ch);
		margin: clamp(2rem, 5vw, 4rem) auto;
		overflow-wrap: anywhere;
	}
	header {
		margin-bottom: 2rem;
	}
	.introduction {
		margin-top: 1rem;
		color: var(--muted-foreground);
		line-height: 1.65;
	}
	.updated {
		margin-top: 1rem;
		color: var(--muted-foreground);
		font-size: 0.875rem;
	}
	.legal-contents {
		padding: 1.25rem;
	}
	.legal-contents summary {
		list-style: none;
	}
	.legal-contents summary::-webkit-details-marker {
		display: none;
	}
	.legal-contents ul {
		display: grid;
		gap: 0.25rem;
		margin-top: 0.75rem;
		padding-left: 1.25rem;
		color: var(--muted-foreground);
		list-style: disc;
	}
	.legal-contents a {
		display: block;
		width: fit-content;
		min-height: 2.75rem;
		padding-block: 0.75rem;
		color: inherit;
		font-weight: 400;
		line-height: 1.5;
		text-decoration: none;
	}
	.legal-contents a:hover {
		color: var(--card-foreground);
		text-decoration: underline;
	}
	main :global(a) {
		color: var(--primary);
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	main :global(a:hover) {
		color: var(--primary-hover);
	}
	main :global(a:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: 4px;
	}
	.legal-copy {
		--tw-prose-body: var(--foreground);
		--tw-prose-headings: var(--foreground);
		--tw-prose-links: var(--primary);
		--tw-prose-bold: var(--foreground);
		--tw-prose-bullets: var(--muted-foreground);
		--tw-prose-code: var(--foreground);
	}
	.legal-copy :global(section) {
		margin-top: 2.5rem;
		scroll-margin-top: 1.5rem;
	}
	.legal-copy :global(p) {
		max-inline-size: var(--legal-reading-measure);
	}
	.legal-copy :global(:is(dd, li)) {
		text-wrap: pretty;
	}
	.legal-copy :global(section + section) {
		padding-top: 2rem;
		border-top: 1px solid var(--border);
	}
	.legal-copy :global(.legal-note),
	.legal-copy :global(dl) {
		margin-top: 1rem;
	}
	.legal-copy :global(dt),
	.legal-copy :global(dd) {
		margin: 0;
		padding: 0;
	}
	.legal-copy :global(.legal-facts > div) {
		display: grid;
		gap: 0.25rem 1.5rem;
		padding-block: 1rem;
	}
	.legal-copy :global(.legal-facts > div + div) {
		border-top: 1px solid var(--border);
	}
	.legal-copy :global(.legal-facts dt) {
		color: var(--muted-foreground);
		font-size: var(--type-supporting);
		font-weight: 500;
		line-height: 1.7;
	}
	.legal-copy :global(.legal-facts dd > ul) {
		margin-top: 0;
	}
	.legal-copy :global(.processing-item) {
		margin-top: 2rem;
		padding-top: 2rem;
		border-top: 1px solid var(--border);
	}
	.legal-copy :global(.processing-item h3) {
		margin-block: 0 0.75rem;
	}
	.legal-copy :global(.processing-item .legal-facts) {
		margin-top: 0;
	}
	.legal-copy :global(.legal-note) {
		padding: 1.25rem;
		border-radius: var(--radius-container);
		background: var(--muted);
	}
	.legal-copy :global(.legal-aside) {
		color: var(--muted-foreground);
	}
	.legal-copy :global(.legal-contact strong) {
		display: block;
		margin-top: 0.5rem;
	}
	.legal-copy :global(.storage-list) {
		margin-block: 1.5rem;
	}
	.legal-copy :global(.storage-list > div) {
		display: grid;
		gap: 0.5rem 1.5rem;
		padding-block: 1.25rem;
		border-top: 1px solid var(--border);
	}
	.legal-copy :global(.storage-list dt) {
		font-weight: 600;
		line-height: 1.5;
	}
	.legal-copy :global(.storage-list code) {
		font-size: var(--type-supporting);
	}
	.legal-copy :global(.storage-duration) {
		color: var(--muted-foreground);
	}
	.legal-copy :global(.storage-duration strong) {
		font-weight: 500;
	}
	@media (min-width: 40rem) {
		.legal-copy :global(.legal-facts > div) {
			grid-template-columns: 8rem minmax(0, 1fr);
		}
		.legal-copy :global(.storage-list > div) {
			grid-template-columns: minmax(0, 1fr) 12rem;
		}
		.legal-copy :global(.storage-list dt),
		.legal-copy :global(.storage-purpose) {
			grid-column: 1;
		}
		.legal-copy :global(.storage-duration) {
			grid-column: 2;
			grid-row: 1 / 3;
		}
	}
</style>
