<script lang="ts">
	import { resolve } from '$app/paths';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { complementaryResources, type PublicationSelection } from '#lib/domain/publication.js';

	let {
		moduleId,
		selection: selected,
		returnSection,
		busy
	}: {
		moduleId: string;
		selection: PublicationSelection;
		returnSection: string | null;
		busy: boolean;
	} = $props();

	const preview = $derived(selected.draft ?? selected.published);
	const preparation = $derived.by(() => {
		if (!preview) return [];
		const resource = (kind: string) => preview.resources.some((item) => item.kind === kind);
		return [
			{
				id: 'supports',
				label: 'Supports du cours',
				present: resource('course') || preview.studentContent.exercises.length > 0,
				section: 'resources',
				subject: 'les supports du cours'
			},
			{
				id: 'consignes',
				label: 'Consignes',
				present:
					!!(preview.studentContent.instructions.trim() || preview.studentContent.projectInstructions.trim()) ||
					resource('instructions'),
				section: 'resources',
				subject: 'les consignes'
			},
			{
				id: 'bareme',
				label: 'Barème',
				present:
					preview.rubric.some((assessment) => assessment.groups.some((group) => group.lines.length > 0)) ||
					resource('rubric'),
				section: 'rubric',
				subject: 'le barème'
			},
			{
				id: 'echeances',
				label: 'Échéances et remise',
				present: preview.deadlines.length > 0,
				section: 'deadlines',
				subject: 'les échéances'
			},
			{
				id: 'seances',
				label: 'Séances',
				present:
					!!(preview.recap.trim() || preview.toDo.trim()) ||
					preview.lessonNotes.some((note) => note.recap.trim() || note.toDo.trim()),
				section: 'planning',
				subject: 'les séances'
			},
			{
				id: 'ressources',
				label: 'Ressources complémentaires',
				present: complementaryResources(preview).length > 0,
				section: 'resources',
				subject: 'les ressources complémentaires'
			}
		] as const;
	});
	const preparationQuery = (section: 'resources' | 'planning' | 'rubric' | 'deadlines') => {
		const rubric = section === 'rubric' || section === 'deadlines';
		const query = new URLSearchParams({
			contexte: selected.context.id,
			annee: selected.context.academicYear,
			...(selected.context.classId ? { classe: selected.context.classId } : {}),
			section: rubric ? (returnSection ?? 'resources') : section,
			...(rubric ? { retour: 'module' } : {})
		});
		return `${query}${section === 'deadlines' ? '#echeances-' + selected.context.id : ''}`;
	};
</script>

{#snippet preparationList(items: (typeof preparation)[number][])}
	<ul class="grid min-w-0 divide-y border-y sm:grid-cols-2 sm:divide-y-0">
		{#each items as item (item.id)}
			{@const missingResources = !item.present && item.id === 'ressources'}
			{@const action = item.present ? 'Modifier' : missingResources ? 'Ajouter' : 'Compléter'}
			{@const subject = missingResources ? 'des ressources complémentaires' : item.subject}
			<li class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2 sm:pr-4">
				<span class="min-w-0 text-sm font-medium">{item.label}</span>
				<Badge variant="secondary">{item.present ? 'Présent' : missingResources ? 'Aucune' : 'Absent'}</Badge>
				{#if !selected.context.archived}
					<a
						href={busy
							? undefined
							: resolve(
									`${item.section === 'rubric' || item.section === 'deadlines' ? '/enseignant/modules/[moduleId]/bareme' : '/enseignant/modules/[moduleId]'}?${preparationQuery(item.section)}`,
									{ moduleId }
								)}
						aria-disabled={busy || undefined}
						role={busy ? 'link' : undefined}
						tabindex={busy ? -1 : undefined}
						class="inline-flex min-h-11 items-center rounded-control text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-disabled:pointer-events-none aria-disabled:opacity-50"
						aria-label={`${action} ${subject}`}>{action}</a
					>
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

{#if preview}
	<details class="preparation-review min-w-0">
		<summary class="preparation-toggle">
			<span id="publication-preparation-heading" class="font-semibold">Vérifier la préparation</span>
			<span class="text-sm text-muted-foreground tabular-nums"
				>{preparation.filter((item) => item.present).length} / {preparation.length} contenus présents</span
			>
			<ChevronDownIcon class="size-4 shrink-0" aria-hidden="true" />
		</summary>
		<div class="flex min-w-0 flex-col gap-2 pt-3">
			<p class="max-w-prose text-xs text-muted-foreground">
				Contenus visibles par les étudiants dans cet aperçu. Les éléments absents n’empêchent pas la publication.
			</p>
			{#if preparation.some((item) => !item.present)}
				<h2 class="mt-2 text-sm font-medium">Contenus absents de l’aperçu</h2>
				{@render preparationList(preparation.filter((item) => !item.present))}
			{:else}
				<p class="text-sm">Tous les contenus de cet aperçu sont présents.</p>
			{/if}
			{#if preparation.some((item) => item.present)}
				<details class="group mt-2">
					<summary class="flex min-h-11 cursor-pointer items-center gap-2 rounded-control text-sm font-medium">
						<ChevronDownIcon
							class="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
							aria-hidden="true"
						/>
						Contenus présents ({preparation.filter((item) => item.present).length})
					</summary>
					{@render preparationList(preparation.filter((item) => item.present))}
				</details>
			{/if}
		</div>
	</details>
{/if}

<style>
	.preparation-review {
		padding: 0.75rem 1.25rem;
		border-radius: var(--radius);
		background: var(--card);
	}
	.preparation-toggle {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		min-height: 2.75rem;
		cursor: pointer;
	}
	.preparation-toggle > :first-child {
		flex: 1;
	}
	.preparation-toggle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 4px;
		border-radius: var(--radius);
	}
	.preparation-review[open] > summary :global(svg) {
		transform: rotate(180deg);
	}
	@media (max-width: 39.99rem) {
		.preparation-review {
			padding-inline: 1rem;
		}
	}
</style>
