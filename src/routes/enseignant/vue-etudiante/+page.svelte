<script lang="ts">
	import { resolve } from '$app/paths';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
</script>

<svelte:head><title>Vue étudiante · Coursely</title></svelte:head>

<div class="flex min-w-0 flex-col gap-6">
	<div class="flex flex-col gap-2">
		<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">Vue étudiante</h1>
		<p class="max-w-prose text-sm leading-relaxed text-muted-foreground">
			Choisissez une classe pour consulter ses pages publiées dans un nouvel onglet.
		</p>
	</div>
	{#if data.publishedClasses.length}
		<ul class="flex flex-col divide-y border-y" aria-label="Classes avec des pages publiées">
			{#each data.publishedClasses as item (item.publicPath)}
				<li>
					<a
						href={resolve('/classes/[classId]', { classId: item.publicId })}
						target="_blank"
						rel="noopener noreferrer"
						class="flex min-h-11 items-center justify-between gap-4 rounded-lg px-3 py-4 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
					>
						<span class="flex min-w-0 flex-col gap-1">
							<span class="font-medium wrap-anywhere">{item.className} · {item.academicYear}</span>
							<span class="text-sm text-muted-foreground">
								{item.moduleCount} module{item.moduleCount > 1 ? 's' : ''} publié{item.moduleCount >
								1
									? 's'
									: ''}
							</span>
						</span>
						<ExternalLinkIcon class="size-4 shrink-0" aria-hidden="true" />
						<span class="sr-only">Ouvrir la page de classe · nouvel onglet</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<Empty.Root>
			<Empty.Header>
				<Empty.Title>Aucune page publiée</Empty.Title>
				<Empty.Description
					>Publiez un module pour retrouver ici la page de sa classe.</Empty.Description
				>
			</Empty.Header>
			<Empty.Content
				><Button href={resolve('/')} variant="outline">Voir mes modules</Button></Empty.Content
			>
		</Empty.Root>
	{/if}
</div>
