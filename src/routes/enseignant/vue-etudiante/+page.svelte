<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import { resolve } from '$app/paths';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<PageHead title="Pages publiées" description="Retrouver les pages de cours publiées pour les étudiants." />

<div class="published-workspace page-sections">
	<header class="published-heading">
		<div class="flex min-w-0 flex-col gap-2">
			<h1 class="page-title">Pages publiées</h1>
			<p class="max-w-prose text-sm leading-relaxed text-muted-foreground">
				Retrouvez les liens des cours accessibles à vos étudiants.
			</p>
		</div>
		{#if data.publishedClasses.length}<Button href={resolve('/enseignant/modules')} variant="outline" class="self-start"
				>Choisir un module à publier</Button
			>{/if}
	</header>
	{#if data.publishedClasses.length}
		<ul class="published-classes data-list" aria-label="Classes avec des pages publiées">
			{#each data.publishedClasses as item (item.publicPath)}
				<li>
					<a
						href={resolve('/classes/[classId]', { classId: item.publicId })}
						target="_blank"
						rel="noopener noreferrer"
						class="published-class data-row focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
					>
						<span class="flex min-w-0 flex-col gap-1">
							<span class="class-name">{item.className}</span>
							<span class="text-sm text-muted-foreground">
								{item.moduleCount} module{item.moduleCount > 1 ? 's' : ''} publié{item.moduleCount > 1 ? 's' : ''}
							</span>
						</span>
						<ExternalLinkIcon class="size-4 shrink-0" aria-hidden="true" />
						<span class="sr-only">Ouvrir la page de classe · nouvel onglet</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<Empty.Root variant="surface">
			<Empty.Header>
				<Empty.Media variant="icon"><GlobeIcon aria-hidden="true" /></Empty.Media>
				<Empty.Title>Aucune page publiée</Empty.Title>
				<Empty.Description
					>Publiez un module pour rendre son cours accessible aux étudiants et retrouver son lien ici.</Empty.Description
				>
			</Empty.Header>
			<Empty.Content><Button href={resolve('/enseignant/modules')}>Choisir un module à publier</Button></Empty.Content>
		</Empty.Root>
	{/if}
</div>

<style>
	.published-workspace {
		min-width: 0;
	}
	.published-heading {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: start;
		gap: 1rem;
	}
	.published-classes {
		padding-inline: 0;
	}
	.published-classes li + li {
		border-top: 1px solid var(--border);
	}
	.published-class {
		display: flex;
		min-height: 2.75rem;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
		padding: 1.5rem 0.5rem;
		border-radius: var(--radius-control);
		transition: background-color var(--motion-fast) var(--ease-work);
	}
	.class-name {
		font-size: 1.25rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		overflow-wrap: anywhere;
	}
	.published-class:focus-visible {
		background: var(--accent);
	}
	.published-class:active {
		background: var(--muted);
	}
	@media (hover: hover) and (pointer: fine) {
		.published-class:hover {
			background: var(--muted);
		}
		.published-class:hover .class-name {
			color: var(--primary);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.published-class {
			transition: none;
		}
	}
</style>
