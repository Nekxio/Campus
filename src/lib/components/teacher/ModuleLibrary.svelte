<script lang="ts">
	import { snapshot } from '$app/navigation';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import NotebookPenIcon from '@lucide/svelte/icons/notebook-pen';
	import BookIcon from '@lucide/svelte/icons/book-open';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import { filterModules, type ModuleLibraryFilter } from '#lib/teaching/module-library.js';
	import type { ModuleSummary } from '#lib/teaching/types.js';
	import { currentAcademicYear } from '#lib/domain/academic-year.js';

	let { modules }: { modules: ModuleSummary[] } = $props();
	let query = $state('');
	let filter = $state<ModuleLibraryFilter>('all');
	const visible = $derived(filterModules(modules, query, filter));
	snapshot({
		capture: () => ({ query, filter }),
		restore: (value) => {
			query = value.query;
			filter = value.filter;
		}
	});
	const clear = () => {
		query = '';
		filter = 'all';
	};
</script>

<section class="module-library" aria-labelledby="modules">
	<header class="library-heading">
		<div>
			<div class="flex flex-wrap items-center gap-3">
				<h1 id="modules" class="page-title" tabindex="-1">Mes modules</h1>
			</div>
			<p>Préparez vos cours, leurs évaluations et leur publication.</p>
		</div>
		{#if modules.length}<Button href="/enseignant/modules/nouveau"
				><PlusIcon data-icon="inline-start" />Créer un module</Button
			>{/if}
	</header>
	{#if modules.length}
		<Field.FieldGroup class="library-tools control-toolbar">
			<Field.Field
				><Field.FieldLabel for="module-search">Rechercher un module</Field.FieldLabel><Input
					id="module-search"
					type="search"
					placeholder="Nom ou classe…"
					bind:value={query}
				/></Field.Field
			>
			<Field.Field
				><Field.FieldLabel for="module-filter">Afficher</Field.FieldLabel><NativeSelect.Root
					id="module-filter"
					bind:value={filter}
				>
					<option value="all">Tous les modules</option><option value="review">À relire</option><option
						value="unassigned">Sans classe</option
					><option value="paused">Mis de côté</option>
				</NativeSelect.Root></Field.Field
			>
		</Field.FieldGroup>
		<p class="library-count tabular-nums" role="status">
			{visible.length} module{visible.length > 1 ? 's' : ''} affiché{visible.length > 1 ? 's' : ''}
		</p>
	{/if}
	{#if visible.length}
		<ul class="module-index data-list">
			{#each visible as module (module.id)}
				<li class="module-entry data-row">
					<div class="module-identity">
						<h2 class="module-name">{module.title}</h2>
						{#if module.description}<p class="module-description">{module.description}</p>{/if}
						<div class="module-meta">
							{#if module.needsReview}<Badge variant="outline">À relire</Badge>{/if}
							{#if module.paused}<Badge variant="secondary">Mis de côté · privé</Badge>{/if}
							{#each module.classes as item (item.id)}<span
									>{item.name}{#if item.academicYear !== currentAcademicYear()}
										· {item.academicYear}{/if}</span
								>{:else}<span>Sans classe associée</span>{/each}
							<span
								>{module.resourceCount} ressource{module.resourceCount > 1 ? 's' : ''} préparée{module.resourceCount > 1
									? 's'
									: ''}</span
							>
						</div>
					</div>
					<nav class="module-actions" aria-label={`Travailler sur ${module.title}`}>
						<Button variant="secondary" href={`/enseignant/modules/${module.id}?section=preparation`}
							><NotebookPenIcon data-icon="inline-start" />Préparer</Button
						>
						<Button variant="ghost" href={`/enseignant/modules/${module.id}/bareme?retour=module`}
							><ListChecksIcon data-icon="inline-start" />Barème</Button
						>
						<Button variant="ghost" href={`/enseignant/modules/${module.id}/publication`}
							><GlobeIcon data-icon="inline-start" />Publication</Button
						>
					</nav>
				</li>
			{/each}
		</ul>
	{:else}
		<Empty.Root variant="surface" class="mt-6"
			><Empty.Header
				><Empty.Media variant="icon"><BookIcon aria-hidden="true" /></Empty.Media><Empty.Title
					>{modules.length ? 'Aucun module trouvé' : 'Aucun module créé'}</Empty.Title
				><Empty.Description
					>{modules.length
						? 'Essayez un autre nom ou affichez tous les modules.'
						: 'Créez un premier brouillon. Il restera disponible d’une année à l’autre.'}</Empty.Description
				></Empty.Header
			><Empty.Content
				>{#if modules.length}<Button variant="outline" onclick={clear}>Réinitialiser la recherche</Button>{:else}<Button
						href="/enseignant/modules/nouveau">Créer un module</Button
					>{/if}</Empty.Content
			></Empty.Root
		>
	{/if}
</section>

<style>
	.module-library {
		min-width: 0;
	}
	.library-heading {
		display: flex;
		align-items: start;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 1rem;
	}
	.library-heading p {
		color: var(--muted-foreground);
		font-size: 0.875rem;
		margin-top: var(--space-label);
	}
	.module-library > :global([data-slot='empty']) {
		margin-block-start: var(--space-sections);
	}
	.module-library :global(.library-tools) {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 13rem;
		gap: 1rem;
		margin-top: var(--space-sections);
	}
	.library-count {
		font-size: 0.75rem;
		color: var(--muted-foreground);
		margin-block: 1rem 0.5rem;
	}
	.module-entry {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 1.5rem;
		padding: 1.5rem 0.5rem;
	}
	.module-entry + .module-entry {
		border-top: 1px solid var(--border);
	}
	.module-identity {
		min-width: 0;
	}
	.module-name {
		font-size: 1.25rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		overflow-wrap: anywhere;
	}
	.module-description {
		margin-top: 0.5rem;
		color: var(--muted-foreground);
		font-size: 0.875rem;
		display: -webkit-box;
		line-clamp: 2;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}
	.module-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		margin-top: 0.75rem;
		color: var(--muted-foreground);
		font-size: 0.75rem;
		overflow-wrap: anywhere;
	}
	.module-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		justify-self: end;
	}
	@media (max-width: 63.99rem) {
		.module-entry {
			grid-template-columns: 1fr;
			gap: 1rem;
		}
		.module-actions {
			justify-self: start;
		}
	}
	@media (max-width: 35rem) {
		.module-library :global(.library-tools) {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 47.99rem) {
		.module-actions {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			width: 100%;
		}
		.module-actions :global(a) {
			min-height: 2.75rem;
			flex-direction: column;
			gap: 0.25rem;
			padding: 0.5rem 0.25rem;
		}
	}
</style>
