<script lang="ts">
	import { tick } from 'svelte';
	import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import PencilLineIcon from '@lucide/svelte/icons/pencil-line';
	import SearchIcon from '@lucide/svelte/icons/search';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import type { PublicationSnapshot } from '#lib/domain/publication.js';
	import type { Resource } from '#lib/domain/contracts.js';
	import { formatLessonDate } from '#lib/teaching/calendar.js';
	import {
		buildCourseSupports,
		courseSupportFilters,
		pageCourseSupports,
		type CourseSupportScope,
		type CourseSupportSelection
	} from './course-presentation.js';

	let {
		snapshot,
		courseLinks,
		idPrefix,
		selection = $bindable(),
		onOpen
	}: {
		snapshot: PublicationSnapshot;
		courseLinks: Resource[];
		idPrefix: string;
		selection: CourseSupportSelection;
		onOpen: (id: string) => void;
	} = $props();
	const supports = $derived(buildCourseSupports(courseLinks, snapshot.studentContent.exercises, snapshot.lessonNotes));
	const filters = $derived(courseSupportFilters(supports));
	const typeOptions = [
		{ value: 'documents', label: 'Documents' },
		{ value: 'workshops', label: 'Ateliers' }
	] as const;
	const filterGroups = $derived(
		[
			{ label: 'Type', options: filters.hasTypes ? typeOptions : [] },
			{
				label: 'Semestre',
				options: filters.semesters.map((semester) => ({
					value: semester,
					label: semester === 'S1' ? 'Semestre 1' : 'Semestre 2'
				}))
			},
			{
				label: 'Séance',
				options: filters.lessons.map((lesson) => ({
					value: `lesson:${lesson.id}` as const,
					label: `${lesson.label} · ${formatLessonDate(lesson.startsAt)}`
				}))
			}
		].filter((group) => group.options.length > 0)
	);
	const options = $derived(filterGroups.flatMap((group) => [...group.options]));
	const showScope = $derived(supports.length > 1 && options.length > 0);
	const showSearch = $derived(supports.length > 1 || Boolean(selection.query));
	const activeScope = $derived(
		showScope && options.some((option) => option.value === selection.scope) ? selection.scope : 'all'
	);
	const selectedLessonLabel = $derived(
		activeScope.startsWith('lesson:') ? options.find((option) => option.value === activeScope)?.label : undefined
	);
	const results = $derived(pageCourseSupports(supports, { ...selection, scope: activeScope }));
	const visibleRange = $derived(results.first === results.last ? results.first : `${results.first}–${results.last}`);
	const listId = $derived(`${idPrefix}-support-list`);
	let searchInput = $state<HTMLInputElement | null>(null);

	const firstSupportAction = () => document.getElementById(listId)?.querySelector<HTMLElement>('a, button');
	const applyFilters = (query: string, scope: CourseSupportScope) => {
		selection = { query, scope, page: 1 };
	};
	const chooseScope = (value: string) => {
		const option = options.find((option) => option.value === value);
		applyFilters(selection.query, option?.value ?? 'all');
	};
	const clearFilters = async () => {
		applyFilters('', 'all');
		await tick();
		(searchInput ?? firstSupportAction())?.focus();
	};
	const changePage = async (page: number) => {
		selection = { ...selection, page };
		await tick();
		firstSupportAction()?.focus();
	};
	const rowClass =
		'min-h-12 w-full justify-start gap-3 rounded-none px-3 text-left text-base leading-5 focus-visible:ring-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';
</script>

<div class="flex min-w-0 flex-col gap-4">
	{#if showSearch}
		<div
			class={[
				'grid gap-3',
				{
					'sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]': showScope && !filters.lessons.length,
					'sm:grid-cols-[minmax(0,1fr)_minmax(0,min(50%,24rem))]': showScope && filters.lessons.length
				}
			]}
		>
			<Field.Field class="min-w-0">
				<Field.Label for={`${idPrefix}-support-search`}>Rechercher un support</Field.Label>
				<div class="relative">
					<SearchIcon
						class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
					<Input
						id={`${idPrefix}-support-search`}
						type="search"
						placeholder="Titre, code ou séance…"
						class="min-h-11 border-border pl-9 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
						bind:ref={searchInput}
						value={selection.query}
						oninput={(event) => applyFilters(event.currentTarget.value, activeScope)}
					/>
				</div>
			</Field.Field>
			{#if showScope}
				<Field.Field class="min-w-0">
					<Field.Label for={`${idPrefix}-support-scope`}>Afficher</Field.Label>
					<NativeSelect.Root
						id={`${idPrefix}-support-scope`}
						class="w-full [&>select]:min-h-11 [&>select]:border-border [&>select]:text-ellipsis [&>select]:focus-visible:outline-2 [&>select]:focus-visible:-outline-offset-2 [&>select]:focus-visible:outline-ring"
						value={activeScope}
						title={selectedLessonLabel}
						onchange={(event) => chooseScope(event.currentTarget.value)}
					>
						<NativeSelect.Option value="all">Tous les supports</NativeSelect.Option>
						{#each filterGroups as group (group.label)}
							<optgroup label={group.label}>
								{#each group.options as option (option.value)}
									<NativeSelect.Option value={option.value}>{option.label}</NativeSelect.Option>
								{/each}
							</optgroup>
						{/each}
					</NativeSelect.Root>
				</Field.Field>
			{/if}
		</div>
	{/if}

	{#if results.total}
		<ul id={listId} aria-label="Supports disponibles" class="min-w-0 divide-y divide-border border-y border-border">
			{#each results.items as support (`${support.kind}:${support.id}`)}
				<li class="min-w-0">
					{#if support.kind === 'document'}
						<Button variant="ghost" class={rowClass} href={support.url} target="_blank" rel="noopener noreferrer">
							<FileTextIcon class="size-4 text-primary" aria-hidden="true" />
							<span class="min-w-0 flex-1 wrap-anywhere text-primary">{support.title}</span>
							<ArrowUpRightIcon class="size-4 text-primary" aria-hidden="true" />
							<span class="sr-only">· lien externe, nouvel onglet</span>
						</Button>
					{:else}
						{@const rowId = `${idPrefix}-exercise-${support.id}`}
						<Button
							id={rowId}
							variant="ghost"
							class={rowClass}
							aria-labelledby={`${rowId}-title`}
							aria-describedby={support.lesson ? `${rowId}-lesson` : undefined}
							onclick={() => onOpen(support.id)}
						>
							<PencilLineIcon class="size-4 text-practice-foreground" aria-hidden="true" />
							<span class="min-w-0 flex-1 wrap-anywhere">
								<span id={`${rowId}-title`}>{support.title}</span>
								{#if support.lesson}
									<span id={`${rowId}-lesson`} class="mt-1 block text-sm font-normal text-muted-foreground">
										{support.lesson.label} ·
										<time datetime={support.lesson.startsAt}>{formatLessonDate(support.lesson.startsAt)}</time>
									</span>
								{/if}
							</span>
							<ChevronRightIcon class="size-4 text-muted-foreground" aria-hidden="true" />
						</Button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if showSearch}
		<div class="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
			<p role="status" aria-label="Résultats des supports" class="text-sm text-muted-foreground tabular-nums">
				{#if results.total === 0}
					Aucun support trouvé.
				{:else if results.total === 1}
					1 support
				{:else}
					{visibleRange} sur {results.total}
				{/if}
			</p>
			{#if results.total === 0}
				<Button variant="outline" size="sm" onclick={clearFilters}>Effacer les filtres</Button>
			{:else if results.pageCount > 1}
				<nav aria-label="Pages des supports" class="ml-auto flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						aria-controls={listId}
						disabled={results.page === 1}
						onclick={() => changePage(results.page - 1)}
					>
						<ChevronLeftIcon data-icon="inline-start" aria-hidden="true" /> Précédent
					</Button>
					<Button
						variant="outline"
						size="sm"
						aria-controls={listId}
						disabled={results.page === results.pageCount}
						onclick={() => changePage(results.page + 1)}
					>
						Suivant <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
					</Button>
				</nav>
			{/if}
		</div>
	{/if}
</div>
