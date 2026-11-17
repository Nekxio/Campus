<script lang="ts">
	import PageHead from '#lib/components/shared/PageHead.svelte';
	import { formatTeachingDate } from '#lib/teaching/calendar.js';
	import { onMount } from 'svelte';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import LibraryIcon from '@lucide/svelte/icons/library';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import PublicHeader from '#lib/components/publication/PublicHeader.svelte';
	import LegalFooter from '#lib/components/legal/LegalFooter.svelte';
	import WorkSurface from '#lib/components/shared/WorkSurface.svelte';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import type { PublicClassData } from '#lib/domain/publication.js';
	let { data }: { data: PublicClassData } = $props();
	let query = $state('');
	let mounted = $state(false);
	let searchInput = $state<HTMLInputElement | null>(null);
	onMount(() => {
		mounted = true;
	});
	const visibleModules = $derived(
		data.modules.filter((module) => module.title.toLocaleLowerCase('fr').includes(query.trim().toLocaleLowerCase('fr')))
	);
	const resetSearch = () => {
		query = '';
		searchInput?.focus();
	};
</script>

<PageHead
	title={data.className}
	description="Retrouver les supports, les consignes et les échéances des modules publiés de la classe."
	publicContent
/>
<div class="public-reading-shell min-h-screen">
	<PublicHeader mainId="modules" />
	<main id="modules" tabindex="-1" class="class-directory">
		<header class="directory-introduction">
			<div>
				<h1 class="page-title">{data.className}</h1>
				<p class="directory-year">Année {data.academicYear}</p>
			</div>
			<p class="directory-description reading-text">
				Retrouvez les supports, les consignes et les échéances de vos modules.
			</p>
		</header>
		<WorkSurface aria-labelledby="published-modules" class="directory-content">
			<div class="directory-section-heading">
				<h2 id="published-modules" class="section-title"><LibraryIcon aria-hidden="true" />Modules</h2>
				<Badge variant="secondary">{data.modules.length} publié{data.modules.length > 1 ? 's' : ''}</Badge>
			</div>
			{#if data.modules.length > 0}
				<Field.FieldGroup class="directory-search"
					><Field.Field
						><Field.FieldLabel for="course-search">Rechercher un cours</Field.FieldLabel><Input
							id="course-search"
							disabled={!mounted}
							type="search"
							placeholder="Nom du module…"
							aria-describedby="course-search-results"
							bind:ref={searchInput}
							bind:value={query}
						/>
						<p id="course-search-results" role="status" aria-label="Résultats de la recherche" class="sr-only">
							{visibleModules.length} cours affiché{visibleModules.length > 1 ? 's' : ''} sur {data.modules.length}
						</p></Field.Field
					></Field.FieldGroup
				>
				{#if visibleModules.length === 0}<Empty.Root
						><Empty.Header
							><Empty.Title role="heading" aria-level={3}>Aucun cours trouvé</Empty.Title><Empty.Description
								>Essayez un autre nom de module.</Empty.Description
							></Empty.Header
						><Empty.Content
							><Button variant="outline" onclick={resetSearch}>Afficher tous les cours</Button></Empty.Content
						></Empty.Root
					>{/if}
				{#if visibleModules.length > 0}<div class="module-directory">
						{#each visibleModules as module (module.contextId)}<article class="directory-module">
								<div class="module-copy">
									<h3 class="item-title"><BookOpenIcon aria-hidden="true" /><span>{module.title}</span></h3>
									{#if module.description.trim()}<p class="module-description reading-text">
											{module.description}
										</p>{/if}
									<p class="module-publication metadata">
										Publié le <time datetime={module.publishedAt}>{formatTeachingDate(module.publishedAt)}</time>
									</p>
								</div>
								<Button variant="outline" href={module.publicPath} aria-label={`Ouvrir le cours ${module.title}`}
									>Ouvrir le cours<ArrowRightIcon data-icon="inline-end" aria-hidden="true" /></Button
								>
							</article>{/each}
					</div>{/if}{:else}<Empty.Root
					><Empty.Header
						><Empty.Title>Aucun module publié pour le moment</Empty.Title><Empty.Description
							>Les modules apparaîtront ici lorsque leur contenu sera publié.</Empty.Description
						></Empty.Header
					></Empty.Root
				>{/if}
		</WorkSurface>
	</main>
	<LegalFooter />
</div>

<style>
	.class-directory {
		width: min(100%, 80rem);
		margin-inline: auto;
		padding: 2.5rem max(1.25rem, env(safe-area-inset-right, 0px)) calc(4rem + env(safe-area-inset-bottom, 0px))
			max(1.25rem, env(safe-area-inset-left, 0px));
		overflow-wrap: anywhere;
	}
	.directory-introduction {
		display: grid;
		gap: 1.25rem;
		margin-bottom: var(--space-sections);
	}
	.directory-year {
		margin-top: 0.5rem;
		color: var(--muted-foreground);
		font-size: 0.875rem;
	}
	.directory-description {
		color: var(--muted-foreground);
		text-wrap: pretty;
	}
	.directory-section-heading {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}
	.module-directory {
		border-top: 1px solid var(--border);
	}
	.directory-module {
		display: flex;
		min-width: 0;
		flex-direction: column;
		align-items: flex-start;
		gap: 1.25rem;
		padding-block: 1.5rem;
	}
	.directory-module + .directory-module {
		border-top: 1px solid var(--border);
	}
	.module-copy {
		min-width: 0;
	}
	.module-description {
		margin-top: var(--space-label);
		color: var(--muted-foreground);
		white-space: pre-wrap;
		text-wrap: pretty;
	}
	.module-publication {
		margin-top: 0.75rem;
		color: var(--muted-foreground);
	}
	.directory-section-heading h2,
	.module-copy h3 {
		display: flex;
		align-items: start;
		gap: 0.75rem;
	}
	.directory-section-heading :global(svg) {
		color: var(--primary);
		width: var(--icon-size);
		height: var(--icon-size);
		margin-block-start: 0.25rem;
		flex-shrink: 0;
	}
	.module-copy h3 :global(svg) {
		color: var(--primary);
		width: var(--icon-size);
		height: var(--icon-size);
		margin-block-start: 0.25rem;
		flex-shrink: 0;
	}
	:global([dir='rtl']) .directory-module :global(a svg) {
		scale: -1 1;
	}
	@media (prefers-reduced-motion: no-preference) {
		.directory-module :global(a svg) {
			transition: translate var(--motion-fast) var(--ease-work);
		}
		.directory-module :global(a:focus-visible svg) {
			translate: 3px;
		}
		@media (hover: hover) {
			.directory-module :global(a:hover svg) {
				translate: 3px;
			}
		}
		:global([dir='rtl']) .directory-module :global(a:focus-visible svg) {
			translate: -3px;
		}
		@media (hover: hover) {
			:global([dir='rtl']) .directory-module :global(a:hover svg) {
				translate: -3px;
			}
		}
	}
	.class-directory :global(.directory-search) {
		margin-bottom: 1.25rem;
		max-width: 35rem;
	}
	@media (min-width: 56rem) {
		.class-directory .directory-introduction {
			display: flex;
			flex-direction: row;
			align-items: end;
			justify-content: space-between;
			gap: 2rem;
		}
		.directory-description {
			max-width: 32rem;
		}
		.directory-module {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			gap: 1.5rem;
		}
		.directory-module :global(a) {
			flex-shrink: 0;
		}
	}
	@media (max-width: 30rem) {
		.module-directory {
			padding-inline: 0;
		}
		.directory-module :global(a) {
			width: 100%;
		}
	}
</style>
