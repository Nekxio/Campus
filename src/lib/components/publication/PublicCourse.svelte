<script lang="ts">
	import { formatTeachingDate, formatTeachingTime } from '#lib/teaching/calendar.js';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CheckIcon from '@lucide/svelte/icons/check';
	import TargetIcon from '@lucide/svelte/icons/target';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import LinkIcon from '@lucide/svelte/icons/link';
	import NotebookPenIcon from '@lucide/svelte/icons/notebook-pen';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';
	import { tick } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { Button } from '#lib/components/ui/button/index.js';
	import { selectRailDeadline } from '#lib/components/publication/course-presentation.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import PublicHeader from '#lib/components/publication/PublicHeader.svelte';
	import LegalFooter from '#lib/components/legal/LegalFooter.svelte';
	import ModuleCourseContent from '#lib/components/publication/ModuleCourseContent.svelte';
	import QuizCourseRooms from '#lib/components/quizzes/QuizCourseRooms.svelte';
	import { publicationSections, type PublicModuleData } from '#lib/domain/publication.js';
	let {
		data,
		preview = false,
		navigation = 'tabs',
		activeSection = $bindable()
	}: {
		data: PublicModuleData;
		preview?: boolean;
		navigation?: 'tabs' | 'external';
		activeSection?: string;
	} = $props();
	const publicSections = [
		publicationSections[0],
		{ id: 'quiz', label: 'Quiz' } as const,
		...publicationSections.slice(1)
	];
	const courseSections = $derived(
		data.snapshot.objectives.length
			? [
					{ id: 'objectives', label: 'Objectifs du module' } as const,
					...(preview ? publicationSections : publicSections)
				]
			: preview
				? publicationSections
				: publicSections
	);
	const wideReader = new MediaQuery('(min-width: 64rem)');
	const sectionIcons = {
		objectives: TargetIcon,
		supports: BookOpenIcon,
		quiz: CircleHelpIcon,
		consignes: ListChecksIcon,
		remise: CalendarDaysIcon,
		ressources: LinkIcon,
		suivi: NotebookPenIcon
	};
	const compactReader = $derived(!preview && !wideReader.current);
	let hasNavigated = $state(false);
	let sectionsOpen = $state(false);
	let sectionFocus: string | null = null;
	const renderedAt = Date.now();
	const idPrefix = $derived(`${preview ? 'review' : 'cours'}-${data.contextId}`);
	const externalNavigation = $derived(preview && navigation === 'external');
	const selectedSection = $derived(courseSections.find((section) => section.id === activeSection) ?? courseSections[0]);
	const railDeadline = $derived(selectRailDeadline(data.snapshot.deadlines, renderedAt));
	const upcomingDeadline = $derived(railDeadline !== null && Date.parse(railDeadline.dueAt) >= renderedAt);
	const focusSection = async (id: string) => {
		await tick();
		const section = document.getElementById(`${idPrefix}-${id}`);
		if (!section) return;
		section.focus({ preventScroll: true });
		const scrollRoot = section.closest<HTMLElement>('[data-course-scroll]');
		if (scrollRoot && scrollRoot.scrollHeight > scrollRoot.clientHeight) {
			scrollRoot.scrollIntoView({ block: 'nearest', behavior: 'instant' });
			scrollRoot.scrollTo({
				top:
					scrollRoot.scrollTop +
					section.getBoundingClientRect().top -
					scrollRoot.getBoundingClientRect().top -
					scrollRoot.clientTop -
					24,
				behavior: 'instant'
			});
		} else {
			section.scrollIntoView({ block: 'start', behavior: 'instant' });
		}
	};
	const changeSection = (id: string) => {
		if (id !== selectedSection.id) hasNavigated = true;
		activeSection = id;
	};
	const showSubmission = async () => {
		changeSection('remise');
		await focusSection('remise');
	};
	const selectSection = (id: string) => {
		changeSection(id);
		sectionFocus = id;
		sectionsOpen = false;
	};
	const closeSectionsFocus = (event: Event) => {
		const id = sectionFocus;
		sectionFocus = null;
		if (!id) return;
		event.preventDefault();
		void focusSection(id);
	};
	const openSectionsFocus = (event: Event) => {
		event.preventDefault();
		document.getElementById(`${idPrefix}-sections`)?.querySelector<HTMLElement>('[aria-current]')?.focus();
	};
	const closeWideSections = () => {
		if (sectionsOpen && window.matchMedia('(min-width: 64rem)').matches) {
			sectionFocus = selectedSection.id;
			sectionsOpen = false;
		}
	};
</script>

<svelte:window onresize={closeWideSections} />

{#snippet sectionContent(sectionId: (typeof publicSections)[number]['id'] | 'objectives')}
	{#if sectionId === 'objectives'}
		<section class="objectives-view" id={`${idPrefix}-objectives`} tabindex="-1">
			<h2><TargetIcon aria-hidden="true" />Objectifs du module</h2>

			<ul class="objective-rows">
				{#each data.snapshot.objectives as objective, index (`${index}-${objective}`)}<li>
						<CheckIcon aria-hidden="true" /><span>{objective}</span>
					</li>{/each}
			</ul>
		</section>
	{:else if sectionId === 'quiz'}
		<QuizCourseRooms
			contextId={data.contextId}
			lessons={data.snapshot.lessonNotes}
			{idPrefix}
			active={selectedSection.id === 'quiz'}
		/>
	{:else}
		<ModuleCourseContent snapshot={data.snapshot} {idPrefix} onlySection={sectionId} showObjectives={false} />
	{/if}
{/snippet}

{#snippet courseLayout()}
	<div class="course-columns">
		<div class="course-panels min-w-0" data-navigated={hasNavigated}>
			{#if externalNavigation || compactReader}
				{@render sectionContent(selectedSection.id)}
			{:else}
				{#each courseSections as section (section.id)}
					<Tabs.Content
						value={section.id}
						class="min-w-0 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
					>
						{@render sectionContent(section.id)}
					</Tabs.Content>
				{/each}
			{/if}
		</div>
	</div>
{/snippet}

{#snippet content()}
	<svelte:element
		this={preview ? 'section' : 'main'}
		id={idPrefix}
		tabindex="-1"
		class={['public-course mx-auto', { preview }]}
	>
		{#if data.classPath && !preview}
			<Button href={data.classPath} variant="link" class="mb-4 min-h-11 px-0"
				><ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />Retour à la classe</Button
			>
		{/if}
		<header class="course-introduction">
			<div class="course-heading">
				<svelte:element
					this={preview ? 'h2' : 'h1'}
					class={['course-title', preview ? 'font-semibold tracking-tight' : 'page-title']}
					>{data.snapshot.title}</svelte:element
				>
				{#if preview}
					<p class="text-sm text-muted-foreground">
						{data.snapshot.className} · {data.snapshot.academicYear}
					</p>
				{/if}
				{#if data.snapshot.description.trim()}<p class="course-description whitespace-pre-wrap text-muted-foreground">
						{data.snapshot.description}
					</p>{/if}
			</div>
		</header>
		{#if railDeadline && selectedSection.id !== 'remise'}
			<section class="deadline-reminder" aria-label={upcomingDeadline ? 'Prochaine échéance' : 'Dernière échéance'}>
				<div class="deadline-copy">
					<p class="deadline-date">
						<CalendarDaysIcon aria-hidden="true" />
						<time datetime={railDeadline.dueAt}>
							{formatTeachingDate(railDeadline.dueAt)}
							<span class="deadline-time">· {formatTeachingTime(railDeadline.dueAt)}</span>
						</time>
					</p>
					<p class="deadline-detail">
						{upcomingDeadline ? 'Prochaine échéance' : 'Dernière échéance'} · {railDeadline.label}{!upcomingDeadline
							? ' · échéance passée'
							: ''}
					</p>
				</div>
				<Tooltip.Provider>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									type="button"
									variant="ghost"
									class="min-h-11 min-w-11"
									onclick={showSubmission}
									aria-label="Voir les modalités de remise"
								>
									<FileTextIcon aria-hidden="true" />
									<span class="deadline-touch-label">Modalités de remise</span>
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content role="tooltip" sideOffset={8}>Voir les modalités de remise</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>
			</section>
		{/if}
		{#if externalNavigation}
			{@render courseLayout()}
		{:else}
			{#if !preview}
				<div class="compact-course-navigation">
					<Sheet.Root bind:open={sectionsOpen}>
						<Sheet.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="outline"
									class="w-full justify-between gap-3 text-left"
									aria-label={`Changer de rubrique : ${selectedSection.label}`}
								>
									{@const Icon = sectionIcons[selectedSection.id]}
									<span class="section-label"><Icon aria-hidden="true" />{selectedSection.label}</span>
									<ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
								</Button>
							{/snippet}
						</Sheet.Trigger>
						<Sheet.Content
							side="bottom"
							class="course-sections-sheet max-h-[85dvh] min-h-0 gap-0 overflow-y-auto overscroll-contain motion-reduce:animate-none motion-reduce:transition-none"
							onOpenAutoFocus={openSectionsFocus}
							onCloseAutoFocus={closeSectionsFocus}
						>
							<Sheet.Header class="pr-16">
								<Sheet.Title>Contenu du cours</Sheet.Title>
								<Sheet.Description class="sr-only">Choisissez une rubrique à consulter.</Sheet.Description>
							</Sheet.Header>
							<nav id={`${idPrefix}-sections`} aria-label="Rubriques du cours" class="flex flex-col gap-1 px-4 pb-6">
								{#each courseSections as section (section.id)}
									{@const Icon = sectionIcons[section.id]}
									<Button
										variant={section.id === selectedSection.id ? 'secondary' : 'ghost'}
										class="min-h-12 w-full justify-between gap-3 text-left"
										aria-current={section.id === selectedSection.id ? 'location' : undefined}
										onclick={() => selectSection(section.id)}
									>
										<span class="section-label"><Icon aria-hidden="true" />{section.label}</span>
										{#if section.id === selectedSection.id}<CheckIcon data-icon="inline-end" aria-hidden="true" />{/if}
									</Button>
								{/each}
							</nav>
						</Sheet.Content>
					</Sheet.Root>
				</div>
			{/if}
			{#if compactReader}
				<div class="student-tabs min-w-0">{@render courseLayout()}</div>
			{:else}
				<Tabs.Root
					bind:value={() => selectedSection.id, changeSection}
					orientation={wideReader.current && !preview ? 'vertical' : 'horizontal'}
					class="student-tabs min-w-0 gap-0"
				>
					<Tabs.List class="course-tabs-list" aria-label="Contenu du module">
						{#each courseSections as section (section.id)}
							{@const Icon = sectionIcons[section.id]}
							<Tabs.Trigger value={section.id} class="min-h-11 whitespace-normal"
								><Icon data-icon="inline-start" aria-hidden="true" />{section.label}</Tabs.Trigger
							>
						{/each}
					</Tabs.List>
					{@render courseLayout()}
				</Tabs.Root>
			{/if}
		{/if}
	</svelte:element>
{/snippet}

{#if preview}
	{@render content()}
{:else}
	<div class="public-reading-shell min-h-screen">
		<PublicHeader mainId={idPrefix} />
		{@render content()}
		<LegalFooter />
	</div>
{/if}

<style>
	.public-course {
		container: course / inline-size;
		width: min(100%, 80rem);
		padding: 1.5rem max(1.25rem, env(safe-area-inset-right, 0px)) calc(4rem + env(safe-area-inset-bottom, 0px))
			max(1.25rem, env(safe-area-inset-left, 0px));
		overflow-wrap: anywhere;
	}
	.course-introduction {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		margin-bottom: 1rem;
	}
	.course-heading {
		min-width: 0;
	}
	.course-title {
		max-width: 100%;
		font-size: clamp(2rem, 2.6vw, 2.5rem);
		line-height: 1.4;
		letter-spacing: -0.035em;
		text-wrap: balance;
	}
	.course-heading > p {
		margin-top: 1rem;
	}
	.course-description {
		max-width: var(--reading-measure);
		font-size: 1rem;
		line-height: 1.65;
		text-wrap: pretty;
	}
	.course-heading .course-description {
		margin-top: 0.5rem;
	}
	.deadline-reminder {
		display: flex;
		min-width: 0;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem 1.5rem;
		padding: 1rem 1.25rem;
		margin-bottom: 1rem;
		background: var(--deadline);
		color: var(--deadline-foreground);
		border-radius: var(--radius-lg);
	}
	.deadline-copy {
		min-width: 0;
	}
	.deadline-date {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.75rem;
		font-variant-numeric: tabular-nums;
		font-size: 1.125rem;
		font-weight: 600;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}
	.deadline-date time {
		flex: 1 1 10ch;
		min-width: 0;
	}
	.deadline-detail {
		margin-top: 0.5rem;
		font-size: 0.875rem;
		overflow-wrap: anywhere;
	}
	.deadline-time {
		white-space: nowrap;
	}
	.deadline-touch-label {
		display: none;
	}
	@media (hover: none), (max-width: 47.99rem) {
		.deadline-touch-label {
			display: inline;
		}
	}
	.course-columns {
		display: grid;
		min-width: 0;
		gap: 1.5rem;
		margin-top: 1.5rem;
	}
	.course-panels {
		min-width: 0;
		padding: 1rem;
		background: var(--card);
		border-radius: var(--radius-container);
	}
	:global(.course-sections-sheet) {
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}
	.public-course :global(.course-tabs-list) {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.25rem;
		width: 100%;
		min-width: 0;
		height: auto;
	}
	.public-course :global([data-slot='tabs-trigger']) {
		min-height: 2.75rem;
		min-width: 0;
		height: auto;
		padding: 0.75rem 0.75rem;
		line-height: 1.4;
		touch-action: manipulation;
	}
	.public-course :global([data-slot='tabs-trigger']:last-child) {
		grid-column: 1 / -1;
	}
	.preview {
		min-height: auto;
		padding: 0;
	}
	.preview .course-panels {
		padding: 0;
		border: 0;
		background: transparent;
	}
	@container course (min-width: 44rem) {
		.public-course :global(.course-tabs-list) {
			grid-template-columns: repeat(5, minmax(0, 1fr));
		}
		.public-course :global([data-slot='tabs-trigger']:last-child) {
			grid-column: auto;
		}
		.public-course:not(.preview) .course-panels {
			padding: 1.5rem;
		}
	}
	@media (min-width: 64rem) {
		.compact-course-navigation {
			display: none;
		}
		.public-course:not(.preview) :global(.student-tabs[data-slot='tabs']) {
			display: grid;
			grid-template-columns: 13rem minmax(0, 1fr);
			gap: 2rem;
			align-items: start;
		}
		.public-course:not(.preview) :global(.course-tabs-list) {
			position: sticky;
			top: 2rem;
			grid-template-columns: minmax(0, 1fr);
			align-items: stretch;
			border: 0;
			height: auto;
		}
		.public-course:not(.preview) :global(.course-tabs-list [data-slot='tabs-trigger']) {
			width: 100%;
			justify-content: start;
			text-align: start;
			padding: 1rem 1rem;
		}
		.public-course:not(.preview) .course-columns {
			margin-top: 0;
			grid-template-columns: minmax(0, 1fr);
			gap: 2rem;
		}
		.public-course:not(.preview) {
			padding-top: 2rem;
		}
	}
	@media (max-width: 30rem) {
		.deadline-reminder {
			align-items: flex-start;
		}
	}

	.objectives-view {
		font-size: 1rem;
		line-height: 1.65;
	}
	.objectives-view h2 {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		font-size: 1.25rem;
		line-height: 1.333;
		font-weight: 600;
		margin-bottom: 1.25rem;
	}
	.objective-rows li {
		display: flex;
		align-items: start;
		gap: 1rem;
		padding: 1.25rem 0;
		border-bottom: 1px solid var(--border);
	}
	.objective-rows li span {
		max-width: var(--reading-measure);
	}
	.objective-rows :global(svg) {
		color: var(--primary);
		width: var(--icon-size);
		margin-block-start: 0.25rem;
		flex-shrink: 0;
	}
	.objective-rows li:first-child {
		padding-top: 0;
	}
	.objective-rows li:last-child {
		padding-bottom: 0;
		border-bottom: 0;
	}

	.section-label {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
	}
	.deadline-date :global(svg) {
		width: var(--icon-size);
		height: var(--icon-size);
		margin-block-start: 0.25rem;
		flex-shrink: 0;
	}
	.objectives-view h2 :global(svg) {
		width: var(--icon-size);
		height: var(--icon-size);
		color: var(--primary);
		flex-shrink: 0;
		align-self: flex-start;
		margin-top: 0.25rem;
	}
	.course-panels :global([role='tabpanel']) {
		animation: none;
	}
	@media (prefers-reduced-motion: no-preference) {
		.course-panels[data-navigated='true'] :global(.course-section),
		.course-panels[data-navigated='true'] .objectives-view {
			transition: opacity var(--motion-fast) var(--ease-work);
			@starting-style {
				opacity: 0.65;
			}
		}
	}
</style>
