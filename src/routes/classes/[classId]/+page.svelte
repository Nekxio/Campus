<script lang="ts">
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import PublicHeader from '#lib/components/publication/PublicHeader.svelte';
	import type { PublicClassData } from '#lib/domain/publication.js';
	let { data }: { data: PublicClassData } = $props();
	function date(value: string) {
		return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long' }).format(
			new Date(value)
		);
	}
</script>

<svelte:head><title>{data.className ?? 'Modules de classe'} · Coursely</title></svelte:head>
<PublicHeader className={data.className} academicYear={data.academicYear} mainId="modules" />
<main id="modules" tabindex="-1" class="class-directory mx-auto max-w-5xl">
	<h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">
		{data.className ?? 'Modules de classe'}
	</h1>
	{#if data.academicYear}<p class="mt-3 text-muted-foreground">Année {data.academicYear}</p>{/if}
	<p class="mt-5 max-w-[70ch] leading-relaxed text-muted-foreground">
		Retrouvez les supports, les consignes et les échéances de vos modules. Ouvrez un module pour
		consulter son contenu.
	</p>
	<section aria-labelledby="published-modules" class="mt-12">
		<h2 id="published-modules" class="mb-5 text-xl font-semibold tracking-tight">Modules</h2>
		{#if data.modules.length > 0}
			<div class="border-t">
				{#each data.modules as module (module.contextId)}
					<article
						class="flex min-w-0 flex-col items-start justify-between gap-5 border-b py-7 sm:flex-row sm:items-center sm:gap-10"
					>
						<div class="flex min-w-0 flex-col gap-2">
							<div class="flex min-w-0 flex-wrap items-center gap-3">
								<h3 class="text-xl font-semibold tracking-tight">{module.title}</h3>
								<Badge variant="outline">Publié</Badge>
							</div>
							{#if module.description.trim()}<p
									class="max-w-[66ch] leading-relaxed whitespace-pre-wrap text-muted-foreground"
								>
									{module.description}
								</p>{/if}
							<p class="text-xs text-muted-foreground">
								Publié le <time datetime={module.publishedAt}>{date(module.publishedAt)}</time>
							</p>
						</div>
						<Button
							variant="outline"
							href={module.publicPath}
							aria-label={`Ouvrir le cours ${module.title}`}
							class="shrink-0"
							>Ouvrir le cours<ArrowRightIcon data-icon="inline-end" aria-hidden="true" /></Button
						>
					</article>
				{/each}
			</div>
		{:else}
			<Empty.Root
				><Empty.Header
					><Empty.Title>Aucun module publié pour le moment</Empty.Title><Empty.Description
						>Les modules apparaîtront ici lorsque leur contenu sera publié. Vous pouvez revenir à
						cette adresse plus tard.</Empty.Description
					></Empty.Header
				></Empty.Root
			>
		{/if}
	</section>
	<p class="mt-7 text-sm text-muted-foreground">
		Les documents et les modalités de remise sont indiqués dans chaque module.
	</p>
</main>

<style>
	.class-directory {
		min-height: calc(100svh - 5rem);
		padding: 3rem max(1.25rem, env(safe-area-inset-right, 0px))
			calc(4rem + env(safe-area-inset-bottom, 0px)) max(1.25rem, env(safe-area-inset-left, 0px));
		overflow-wrap: anywhere;
	}
	@media (min-width: 48rem) {
		.class-directory {
			padding-top: 4.5rem;
		}
	}
</style>
