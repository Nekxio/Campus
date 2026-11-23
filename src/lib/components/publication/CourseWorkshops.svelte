<script lang="ts">
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import PencilLineIcon from '@lucide/svelte/icons/pencil-line';
	import ContentCard from '#lib/components/shared/ContentCard.svelte';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import type { PublicationSnapshot } from '#lib/domain/publication.js';
	import type { Resource } from '#lib/domain/contracts.js';
	import { formatLessonDate } from '#lib/teaching/calendar.js';
	import { groupCourseExercises, type SemesterFilter } from './course-presentation.js';

	let {
		snapshot,
		courseLinks,
		idPrefix,
		filter = $bindable('all'),
		onOpen
	}: {
		snapshot: PublicationSnapshot;
		courseLinks: Resource[];
		idPrefix: string;
		filter: SemesterFilter;
		onOpen: (id: string) => void;
	} = $props();
	const exercises = $derived(snapshot.studentContent.exercises);
	const semesters = ['S1', 'S2'] as const;
	const available = $derived(
		semesters.filter((semester) => exercises.some((exercise) => exercise.semester === semester))
	);
	const effectiveFilter = $derived(filter !== 'all' && !available.includes(filter) ? 'all' : filter);
	const groups = $derived(groupCourseExercises(exercises, snapshot.lessonNotes, effectiveFilter));
	const selectSemester = (value: string) => {
		if (value === 'all' || value === 'S1' || value === 'S2') filter = value;
	};
</script>

{#if courseLinks.length}
	<ul class="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Documents du cours">
		{#each courseLinks as link (link.id)}
			<li class="min-w-0">
				<ContentCard kind="link" title={link.label} href={link.url} icon={BookOpenIcon} tone="learning" external>
					{#snippet metadata()}Support de cours · nouvel onglet{/snippet}
				</ContentCard>
			</li>
		{/each}
	</ul>
{/if}
{#if exercises.length}
	<div class="flex min-w-0 flex-col gap-5">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h3 class="panel-title">Ateliers</h3>
			{#if available.length}
				<ToggleGroup.Root
					type="single"
					variant="outline"
					aria-label="Filtrer les ateliers par semestre"
					value={effectiveFilter}
					onValueChange={selectSemester}
				>
					<ToggleGroup.Item value="all" class="min-h-11">Tous</ToggleGroup.Item>
					{#each available as semester (semester)}
						<ToggleGroup.Item value={semester} class="min-h-11">{semester}</ToggleGroup.Item>
					{/each}
				</ToggleGroup.Root>
			{/if}
		</div>
		{#each groups as group, index (`${group.semester}-${group.lesson?.id ?? ''}`)}
			{#if available.length && (index === 0 || groups[index - 1].semester !== group.semester)}
				<h4 class="item-title">
					{group.semester === 'S1' ? 'Semestre 1' : group.semester === 'S2' ? 'Semestre 2' : 'Autres ateliers'}
				</h4>
			{/if}
			<div class={['workshop-group', { scheduled: group.lesson }]}>
				{#if group.lesson}
					<div>
						<p class="font-medium">{group.lesson.label}</p>
						<time class="text-sm text-muted-foreground" datetime={group.lesson.startsAt}
							>{formatLessonDate(group.lesson.startsAt)}</time
						>
					</div>
				{/if}
				<ul class="workshop-list">
					{#each group.exercises as exercise (exercise.id)}
						<li class="min-w-0">
							<ContentCard
								kind="button"
								id={`${idPrefix}-exercise-${exercise.id}`}
								title={exercise.title}
								heading={available.length ? 'h5' : 'h4'}
								icon={PencilLineIcon}
								tone="practice"
								onclick={() => onOpen(exercise.id)}
							/>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>
{/if}

<style>
	.workshop-group {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}
	.scheduled {
		border-block-start: 1px solid var(--border);
		padding-block-start: 1rem;
	}
	.workshop-list {
		display: grid;
		gap: 0.75rem;
		min-width: 0;
	}
	@media (min-width: 48rem) {
		.scheduled {
			grid-template-columns: minmax(11rem, 0.72fr) minmax(0, 1.28fr);
			column-gap: 1.5rem;
			align-items: start;
		}
		.workshop-group:not(.scheduled) .workshop-list {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
