<script lang="ts">
	import CourseMarkdown from './CourseMarkdown.svelte';
	import { formatLessonDate, formatTeachingDate } from '#lib/teaching/calendar.js';
	import { tick } from 'svelte';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import CourseAssignments from './CourseAssignments.svelte';
	import CourseWorkshops from './CourseWorkshops.svelte';
	import { publicRubricTotals, type CourseSupportSelection } from './course-presentation.js';
	import WorkSurface from '#lib/components/shared/WorkSurface.svelte';
	import ContentCard from '#lib/components/shared/ContentCard.svelte';
	import CodeBlock from '#lib/components/shared/CodeBlock.svelte';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import LinkIcon from '@lucide/svelte/icons/link';
	import NotebookPenIcon from '@lucide/svelte/icons/notebook-pen';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ListChecksIcon from '@lucide/svelte/icons/list-checks';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import { cn } from '#lib/utils.js';
	import { complementaryResources, type PublicationSnapshot } from '#lib/domain/publication.js';
	import type { Resource } from '#lib/domain/contracts.js';
	let {
		snapshot,
		idPrefix,
		compact = false,
		onlySection = null,
		onSectionChange,
		showObjectives = true
	}: {
		snapshot: PublicationSnapshot;
		idPrefix: string;
		compact?: boolean;
		onlySection?: 'supports' | 'consignes' | 'remise' | 'ressources' | 'suivi' | null;
		onSectionChange?: (sectionId: string) => void;
		showObjectives?: boolean;
	} = $props();
	let selectedLesson = $state<{ kind: 'lesson'; id: string } | { kind: 'general' } | null>(null);
	let selectedExerciseId = $state<string | null>(null);
	let supportSelection = $state<CourseSupportSelection>({ query: '', scope: 'all', page: 1 });
	let exerciseTab = $state('instructions');
	let correctionConfirmationOpen = $state(false);
	const selectExerciseTab = (value: string) => {
		if (value === 'solution' && exerciseTab !== 'solution') correctionConfirmationOpen = true;
		else exerciseTab = value;
	};
	const selectedExercise = $derived(
		snapshot.studentContent.exercises.find((exercise) => exercise.id === selectedExerciseId)
	);
	const hasCorrection = $derived(Boolean(selectedExercise?.solution.trim() || selectedExercise?.code.trim()));
	const openExercise = async (exerciseId: string) => {
		exerciseTab = 'instructions';
		correctionConfirmationOpen = false;
		selectedExerciseId = exerciseId;
		await tick();
		document.getElementById(`${idPrefix}-exercise-title`)?.focus();
	};
	const closeExercise = async () => {
		const exerciseId = selectedExerciseId;
		selectedExerciseId = null;
		await tick();
		const returnTarget =
			document.getElementById(`${idPrefix}-exercise-${exerciseId}`) ?? document.getElementById(`${idPrefix}-supports`);
		returnTarget?.focus();
	};
	const objectiveEntries = $derived.by(() => {
		const occurrences: Record<string, number> = Object.create(null);
		return snapshot.objectives.map((label) => {
			const occurrence = occurrences[label] ?? 0;
			occurrences[label] = occurrence + 1;
			return { label, key: `${label}:${occurrence}` };
		});
	});
	const dossiers = $derived(snapshot.studentContent.dossiers ?? []);
	const dossierAssessmentIds = $derived(new Set(dossiers.map((dossier) => dossier.assessmentId)));
	const dossierResourceIds = $derived(new Set(dossiers.flatMap((dossier) => dossier.resourceIds)));
	const standaloneRubrics = $derived(
		snapshot.rubric.filter((rubric) => !rubric.assessmentId || !dossierAssessmentIds.has(rubric.assessmentId))
	);
	const exerciseLinks = $derived(
		snapshot.resources.filter((resource) => selectedExercise?.resourceIds?.includes(resource.id))
	);
	const courseLinks = $derived(snapshot.resources.filter((link) => link.kind === 'course'));
	const assignmentLinks = $derived(
		snapshot.resources.filter(
			(link) => !dossierResourceIds.has(link.id) && (link.kind === 'instructions' || link.kind === 'rubric')
		)
	);
	const complementaryLinks = $derived(complementaryResources(snapshot));
	const hasWrittenInstructions = $derived(
		Boolean(snapshot.studentContent.instructions.trim() || snapshot.studentContent.projectInstructions.trim())
	);
	const hasInlineInstructions = $derived(hasWrittenInstructions || snapshot.rubric.length > 0);
	const notes = $derived(snapshot.lessonNotes.filter((note) => note.recap.trim() || note.toDo.trim()));
	const hasNotes = $derived(notes.length > 0 || !!snapshot.recap.trim() || !!snapshot.toDo.trim());
	const selectedLessonNote = $derived.by(() => {
		const selection = selectedLesson;
		return selection?.kind === 'lesson' ? notes.find((note) => note.id === selection.id) : undefined;
	});
	const openLesson = async (selection: { kind: 'lesson'; id: string } | { kind: 'general' }) => {
		selectedLesson = selection;
		await tick();
		document.getElementById(`${idPrefix}-lesson-detail-title`)?.focus();
	};
	const closeLesson = async () => {
		const selection = selectedLesson;
		selectedLesson = null;
		await tick();
		const target = selection?.kind === 'lesson' ? selection.id : 'general';
		document.getElementById(`${idPrefix}-lesson-card-${target}`)?.focus();
	};

	function isPdf(link: Resource) {
		return /\.pdf$/i.test(new URL(link.url).pathname);
	}
	function resourceAction(link: Resource) {
		if (link.kind === 'instructions') return 'Lire la consigne';
		if (link.kind === 'rubric') return 'Lire le barème';
		return isPdf(link) ? 'Ouvrir le PDF' : 'Ouvrir le support';
	}
	function trackSections(element: HTMLElement) {
		// Follow the rendered document's scroll, without changing its reviewed snapshot.
		const prefix = `${idPrefix}-`;
		const notify = onSectionChange;
		const sectionIds = ['supports', 'consignes', 'remise', 'ressources', ...(hasNotes ? ['suivi'] : [])];
		const sections = sectionIds
			.map((id) => document.getElementById(`${prefix}${id}`))
			.filter((section): section is HTMLElement => !!section && element.contains(section));
		const scrollRoot = element.closest<HTMLElement>('[data-course-scroll]');
		function updateCurrent() {
			const internalScroll = scrollRoot && scrollRoot.scrollHeight > scrollRoot.clientHeight;
			const top = internalScroll ? scrollRoot.getBoundingClientRect().top + 24 : 80;
			let current: HTMLElement | undefined = sections[0];
			for (const section of sections) {
				if (section.getBoundingClientRect().top <= top) current = section;
			}
			const atEnd = internalScroll
				? scrollRoot.scrollTop > 0 && scrollRoot.scrollTop + scrollRoot.clientHeight >= scrollRoot.scrollHeight - 1
				: window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
			if (atEnd) current = sections.at(-1);
			if (current) notify?.(current.id.slice(prefix.length));
		}
		function updateFromHash() {
			const current = sections.find((section) => `#${section.id}` === window.location.hash);
			if (current) notify?.(current.id.slice(prefix.length));
		}
		scrollRoot?.addEventListener('scroll', updateCurrent, { passive: true });
		window.addEventListener('scroll', updateCurrent, { passive: true });
		window.addEventListener('resize', updateCurrent);
		window.addEventListener('hashchange', updateFromHash);
		updateCurrent();
		updateFromHash();
		return () => {
			scrollRoot?.removeEventListener('scroll', updateCurrent);
			window.removeEventListener('scroll', updateCurrent);
			window.removeEventListener('resize', updateCurrent);
			window.removeEventListener('hashchange', updateFromHash);
		};
	}
</script>

{#snippet resourceLinks(links: Resource[], trailingSeparator = true, showSeparators = true)}
	{#if onlySection && showSeparators}<Separator />{/if}
	<ul class="resource-list">
		{#each links as link (link.id)}
			<li class="resource-row">
				{#if compact || link.kind === 'resource'}
					<!-- The public projection supplies validated external HTTPS links. -->
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<a
						href={link.url}
						target="_blank"
						rel="noreferrer"
						class="inline-resource focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
					>
						{#if link.kind === 'resource'}<ExternalLinkIcon
								class="size-4 shrink-0"
								aria-hidden="true"
							/>{:else}<FileTextIcon class="size-4 shrink-0" aria-hidden="true" />{/if}
						<span>{link.label}</span><span class="sr-only"> · lien externe, nouvel onglet</span>
					</a>
				{:else}
					<div class="resource-label">
						<span>{link.label}</span>{#if isPdf(link)}<span class="text-xs font-normal text-muted-foreground">PDF</span
							>{/if}
					</div>
					{#if onlySection}
						<Button href={link.url} target="_blank" rel="noreferrer" variant="outline" class="min-h-11">
							{resourceAction(link)}<ExternalLinkIcon data-icon="inline-end" aria-hidden="true" /><span class="sr-only">
								· {link.label} · lien externe, nouvel onglet</span
							>
						</Button>
					{:else}
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							href={link.url}
							target="_blank"
							rel="noreferrer"
							class="resource-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
						>
							{resourceAction(link)}<ExternalLinkIcon class="size-4 shrink-0" aria-hidden="true" /><span
								class="sr-only"
							>
								· {link.label} · lien externe, nouvel onglet</span
							>
						</a>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
	{#if onlySection && showSeparators && trailingSeparator}<Separator />{/if}
{/snippet}

{#snippet noteText(label: string, text: string)}
	<p class="note-copy whitespace-pre-wrap text-muted-foreground">
		<strong class="font-medium text-foreground">{label}<span aria-hidden="true"> :</span></strong>
		{text}
	</p>
{/snippet}

{#snippet instructionText(text: string, title: string, showTitle = true)}
	<div class="instruction-block">
		{#if showTitle}<svelte:element this={compact ? 'h4' : 'h3'} class="item-title">{title}</svelte:element>{/if}
		<div class="instruction-copy">
			<CourseMarkdown {text} headingLevel={(compact ? 4 : 3) + (showTitle ? 1 : 0)} />
		</div>
	</div>
{/snippet}

{#snippet rubricSection(assessment: PublicationSnapshot['rubric'][number], inDossier = false)}
	{@const { points } = publicRubricTotals(assessment)}
	<section class="rubric-section" aria-label={`Grille vierge · ${assessment.title}`}>
		<details class="rubric-disclosure">
			<summary>
				<svelte:element this={inDossier ? 'h4' : 'h3'} class="rubric-summary-title"
					>{inDossier ? 'Barème du dossier' : `${assessment.title} · grille vierge`}</svelte:element
				>
				<span class="rubric-maximum">Max. {points} point{points > 1 ? 's' : ''}</span>
				<ChevronDownIcon class="rubric-chevron size-4 shrink-0" aria-hidden="true" />
			</summary>
			<div class="rubric-groups">
				{#each assessment.groups as group, groupIndex (groupIndex)}
					<div class="rubric-group">
						<svelte:element this={inDossier ? 'h5' : 'h4'} class="font-medium">{group.title}</svelte:element>
						<ul class="flex flex-col gap-3">
							{#each group.lines as line, lineIndex (lineIndex)}<li class="flex flex-col gap-1">
									<p class="rubric-line-heading">
										<span>{line.label}</span><span class="rubric-maximum"
											>Max. {line.maxPoints} point{line.maxPoints > 1 ? 's' : ''}</span
										>
									</p>
									{#if line.description}<p class="text-sm whitespace-pre-wrap text-muted-foreground">
											{line.description}
										</p>{/if}
								</li>{/each}
						</ul>
					</div>
				{/each}
			</div>
		</details>
	</section>
{/snippet}

{#snippet moduleObjectives()}
	<div class="course-objectives">
		<svelte:element this={compact || onlySection ? 'h3' : 'h2'} class="objectives-title font-semibold"
			>Objectifs du module</svelte:element
		>
		<ul class="objective-list text-muted-foreground">
			{#each objectiveEntries as objective (objective.key)}<li>{objective.label}</li>{/each}
		</ul>
	</div>
{/snippet}

<div
	class={cn('course-document', compact && 'compact', onlySection && 'section-panel')}
	{@attach !onlySection && onSectionChange && trackSections}
>
	{#if !onlySection}
		<header class="course-introduction">
			<svelte:element this={compact ? 'h2' : 'h1'} class="course-title font-semibold tracking-tight"
				>{snapshot.title}</svelte:element
			>
			{#if compact}<p class="course-meta text-muted-foreground">
					{snapshot.className} · {snapshot.academicYear}
				</p>{/if}
			{#if snapshot.description.trim()}<p class="course-description whitespace-pre-wrap text-muted-foreground">
					{snapshot.description}
				</p>{/if}
			{#if snapshot.objectives.length > 0}{@render moduleObjectives()}{/if}
		</header>
	{/if}
	{#if !onlySection || onlySection === 'supports'}
		<section
			id={`${idPrefix}-supports`}
			aria-labelledby={`${idPrefix}-supports-title`}
			tabindex="-1"
			class="course-section"
		>
			<svelte:element
				this={compact ? 'h3' : 'h2'}
				id={`${idPrefix}-supports-title`}
				class={selectedExercise ? 'sr-only' : 'course-section-heading section-title'}
				><BookOpenIcon aria-hidden="true" />Supports du cours</svelte:element
			>
			<div class="section-body">
				{#if selectedExercise}
					<Button type="button" variant="ghost" class="w-fit px-0" onclick={closeExercise}>
						<ArrowLeftIcon data-icon="inline-start" aria-hidden="true" /> Retour aux supports
					</Button>
					<WorkSurface element="div" padding={false} class="course-detail">
						<h3
							id={`${idPrefix}-exercise-title`}
							tabindex="-1"
							class="panel-title focus-visible:outline-2 focus-visible:outline-ring"
						>
							{selectedExercise.title}
						</h3>
						<p class="mt-2 text-sm text-muted-foreground">Exercice non noté</p>
						{#if hasCorrection}
							<Tabs.Root bind:value={() => exerciseTab, selectExerciseTab} activationMode="manual" class="mt-6">
								<Tabs.List aria-label="Contenu de l’exercice" variant="line" class="w-full gap-6">
									<Tabs.Trigger value="instructions" class="flex-none px-0 data-active:font-semibold"
										>Énoncé</Tabs.Trigger
									>
									<Tabs.Trigger value="solution" class="flex-none px-0 data-active:font-semibold">Corrigé</Tabs.Trigger>
								</Tabs.List>
								<Tabs.Content value="instructions" class="pt-3 text-base leading-relaxed">
									<CourseMarkdown text={selectedExercise.instructions} />
								</Tabs.Content>
								<Tabs.Content value="solution" class="pt-3 text-base leading-relaxed">
									{#if selectedExercise.solution.trim()}<CourseMarkdown text={selectedExercise.solution} />{/if}
									{#if selectedExercise.code.trim()}
										<div class={{ 'mt-4': Boolean(selectedExercise.solution.trim()) }}>
											<CodeBlock
												label={`Code de l’exercice · ${selectedExercise.title}`}
												language="Code complémentaire"
												value={selectedExercise.code}
											>
												{selectedExercise.code}
											</CodeBlock>
										</div>
									{/if}
								</Tabs.Content>
							</Tabs.Root>
						{:else}
							<div class="mt-6"><CourseMarkdown text={selectedExercise.instructions} /></div>
						{/if}
						{#if exerciseLinks.length}
							<section class="mt-6 flex flex-col gap-2" aria-label="Ressources de l’atelier">
								<h4 class="item-title">Ressources de l’atelier</h4>
								{@render resourceLinks(exerciseLinks, false, false)}
							</section>
						{/if}
					</WorkSurface>
				{:else if courseLinks.length || snapshot.studentContent.exercises.length}
					<CourseWorkshops
						{snapshot}
						{courseLinks}
						{idPrefix}
						bind:selection={supportSelection}
						onOpen={openExercise}
					/>
				{:else}
					<p class="empty-copy">Aucun support de cours n’est indiqué pour le moment.</p>
				{/if}
			</div>
			{#if onlySection && showObjectives && snapshot.objectives.length > 0}<div class="reading-objectives">
					{@render moduleObjectives()}
				</div>{/if}
		</section>
	{/if}
	{#if !onlySection || onlySection === 'consignes'}
		<section
			id={`${idPrefix}-consignes`}
			aria-labelledby={`${idPrefix}-consignes-title`}
			tabindex="-1"
			class="course-section"
		>
			<svelte:element
				this={compact ? 'h3' : 'h2'}
				id={`${idPrefix}-consignes-title`}
				class="course-section-heading section-title"
				><ListChecksIcon aria-hidden="true" />Consignes et barèmes</svelte:element
			>
			<div class="section-body">
				<CourseAssignments {snapshot} {idPrefix} {rubricSection} {resourceLinks}>
					{#if assignmentLinks.length > 0}{@render resourceLinks(
							assignmentLinks,
							hasWrittenInstructions || snapshot.rubric.length === 0
						)}{:else if !hasInlineInstructions}<p class="empty-copy">
							Aucune consigne ni aucun barème n’est indiqué pour le moment.
						</p>{/if}
					{#if snapshot.studentContent.instructions.trim()}{@render instructionText(
							snapshot.studentContent.instructions,
							'Consignes du module',
							Boolean(snapshot.studentContent.projectInstructions.trim())
						)}{/if}
					{#if snapshot.studentContent.projectInstructions.trim()}{@render instructionText(
							snapshot.studentContent.projectInstructions,
							'Consignes du projet'
						)}{/if}
					{#each standaloneRubrics as assessment, index (assessment.assessmentId ?? index)}
						{@render rubricSection(assessment)}
					{/each}
				</CourseAssignments>
			</div>
		</section>
	{/if}
	{#if !onlySection || onlySection === 'remise'}
		<section
			id={`${idPrefix}-remise`}
			aria-labelledby={`${idPrefix}-remise-title`}
			tabindex="-1"
			class="course-section rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
		>
			<svelte:element
				this={compact ? 'h3' : 'h2'}
				id={`${idPrefix}-remise-title`}
				class="course-section-heading section-title"
				><CalendarDaysIcon aria-hidden="true" />Échéances et remise</svelte:element
			>
			<div class="section-body deadlines">
				{#each snapshot.deadlines as deadline (deadline)}
					<div class="deadline">
						<div class="deadline-meta">
							<p class="font-medium">{deadline.label}</p>
							<p class="tabular-nums">
								<time datetime={deadline.dueAt}>{formatLessonDate(deadline.dueAt)}</time>
							</p>
						</div>
						{#if deadline.submissionInstructions.trim()}<p class="whitespace-pre-wrap text-muted-foreground">
								{deadline.submissionInstructions}
							</p>{:else}<p class="empty-copy">Les modalités de remise ne sont pas précisées.</p>{/if}
					</div>
				{:else}<p class="empty-copy">Aucune échéance ni modalité de remise n’est indiquée pour le moment.</p>{/each}
			</div>
		</section>
	{/if}
	{#if !onlySection || onlySection === 'ressources'}
		<section
			id={`${idPrefix}-ressources`}
			aria-labelledby={`${idPrefix}-ressources-title`}
			tabindex="-1"
			class="course-section complementary-resources"
		>
			<svelte:element
				this={compact ? 'h3' : 'h2'}
				id={`${idPrefix}-ressources-title`}
				class="course-section-heading section-title"
				><LinkIcon aria-hidden="true" />Ressources complémentaires</svelte:element
			>
			<div class="section-body">
				{#if complementaryLinks.length > 0}
					{@render resourceLinks(complementaryLinks, false, false)}
				{:else}
					<p class="empty-copy">Aucune ressource complémentaire n’est indiquée pour le moment.</p>
				{/if}
			</div>
		</section>
	{/if}
	{#if (!onlySection && hasNotes) || onlySection === 'suivi'}
		<section id={`${idPrefix}-suivi`} aria-labelledby={`${idPrefix}-suivi-title`} tabindex="-1" class="course-section">
			<svelte:element
				this={compact ? 'h3' : 'h2'}
				id={`${idPrefix}-suivi-title`}
				class={selectedLesson && (selectedLessonNote || selectedLesson.kind === 'general')
					? 'sr-only'
					: 'course-section-heading section-title'}
				><NotebookPenIcon aria-hidden="true" />Vu en cours / à faire</svelte:element
			>
			<div class="section-body">
				{#if selectedLesson && (selectedLessonNote || selectedLesson.kind === 'general')}
					<Button type="button" variant="ghost" class="w-fit px-0" onclick={closeLesson}
						><ArrowLeftIcon data-icon="inline-start" aria-hidden="true" /> Retour aux séances</Button
					>
					<WorkSurface element="div" padding={false} class="course-detail flex flex-col gap-3">
						<svelte:element
							this={compact ? 'h4' : 'h3'}
							id={`${idPrefix}-lesson-detail-title`}
							tabindex="-1"
							class="lesson-detail-title panel-title"
							>{selectedLessonNote?.label ?? 'Récapitulatif général'}</svelte:element
						>
						{#if selectedLessonNote}<time class="text-sm text-muted-foreground" datetime={selectedLessonNote.startsAt}
								>{formatTeachingDate(selectedLessonNote.startsAt)}</time
							>{/if}
						{#if (selectedLessonNote?.recap ?? snapshot.recap).trim()}{@render noteText(
								'Vu en cours',
								selectedLessonNote?.recap ?? snapshot.recap
							)}{/if}
						{#if (selectedLessonNote?.toDo ?? snapshot.toDo).trim()}{@render noteText(
								'À faire',
								selectedLessonNote?.toDo ?? snapshot.toDo
							)}{/if}
					</WorkSurface>
				{:else if hasNotes}
					<div class="lesson-grid">
						{#each notes as note, index (note.id)}
							<ContentCard
								kind="button"
								id={`${idPrefix}-lesson-card-${note.id}`}
								title={note.label}
								tone="practice"
								heading={compact ? 'h4' : 'h3'}
								metadataAtBottom
								onclick={() => openLesson({ kind: 'lesson', id: note.id })}
							>
								{#snippet metadata()}
									<span class="lesson-metadata">
										<span class="tabular-nums">Séance {index + 1}</span>
										<time datetime={note.startsAt}>{formatTeachingDate(note.startsAt)}</time>
									</span>
								{/snippet}
							</ContentCard>
						{/each}
						{#if snapshot.recap.trim() || snapshot.toDo.trim()}
							<ContentCard
								kind="button"
								id={`${idPrefix}-lesson-card-general`}
								title="Récapitulatif général"
								tone="practice"
								heading={compact ? 'h4' : 'h3'}
								onclick={() => openLesson({ kind: 'general' })}
							/>
						{/if}
					</div>
				{:else}
					<p class="empty-copy">Aucun récapitulatif ni travail à faire n’est indiqué pour le moment.</p>
				{/if}
			</div>
		</section>
	{/if}
</div>

{#if hasCorrection}
	<AlertDialog.Root bind:open={correctionConfirmationOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Voir le corrigé ?</AlertDialog.Title>
				<AlertDialog.Description>
					Prenez le temps de chercher par vous-même avant de consulter le corrigé. Vous pourrez revenir à l’énoncé
					ensuite.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>Retour</AlertDialog.Cancel>
				<AlertDialog.Action
					onclick={() => {
						exerciseTab = 'solution';
						correctionConfirmationOpen = false;
					}}>Voir le corrigé</AlertDialog.Action
				>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
{/if}

<style>
	.course-document {
		min-width: 0;
		font-size: 1rem;
		line-height: 1.625;
		overflow-wrap: anywhere;
	}
	.course-title {
		font-size: 2.25rem;
		line-height: 1.15;
		text-wrap: balance;
	}
	.course-introduction {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.course-objectives {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.objectives-title {
		font-size: 1rem;
	}
	.objective-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		list-style: disc;
		padding-left: 1.25rem;
	}
	.course-section {
		margin-top: 1.75rem;
		padding-top: 1.75rem;
		border-top: 1px solid var(--border);
		scroll-margin-top: 1.5rem;
	}
	.section-title {
		margin-bottom: 1rem;
	}
	.resource-list {
		display: flex;
		min-width: 0;
		flex-direction: column;
	}
	.resource-row {
		display: flex;
		min-width: 0;
		min-height: 3.75rem;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
		padding: 1rem 0;
	}
	.resource-label {
		display: flex;
		min-width: 0;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		font-weight: 500;
	}
	.resource-action,
	.inline-resource {
		display: inline-flex;
		min-width: 0;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.5rem;
		border-radius: var(--radius-sm);
		font-size: 0.875rem;
		text-decoration: underline;
		text-underline-offset: 4px;
	}
	.resource-action {
		flex-shrink: 0;
	}
	@media (hover: hover) and (pointer: fine) {
		.resource-action:hover,
		.inline-resource:hover {
			text-decoration-thickness: 2px;
		}
	}
	.lesson-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
		grid-auto-rows: 1fr;
		gap: 1rem;
	}
	.lesson-metadata {
		display: flex;
		flex-direction: column;
		gap: 0 0.75rem;
	}
	@container card-header (min-width: 14rem) {
		.lesson-metadata {
			flex-direction: row;
			flex-wrap: wrap;
		}
	}
	.lesson-detail-title:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.lesson-detail-title {
		overflow-wrap: anywhere;
	}
	.deadlines {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.deadline {
		padding-bottom: 1.25rem;
		border-bottom: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.deadlines > .deadline:last-child {
		border-bottom: 0;
	}
	.deadline-meta {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.note-meta time {
		font-size: 0.875rem;
	}
	.empty-copy {
		color: var(--muted-foreground);
	}
	.compact {
		font-size: 0.875rem;
		line-height: 1.45;
	}
	.compact .course-title {
		font-size: 1.5rem;
		line-height: 1.25;
	}
	.compact .course-introduction {
		gap: 0.25rem;
		padding-bottom: 0.75rem;
	}
	.compact .course-meta {
		font-size: 0.75rem;
	}
	.compact .course-description,
	.compact .course-objectives {
		margin-top: 0.25rem;
	}
	.compact .course-objectives {
		display: block;
	}
	.compact .objectives-title {
		display: inline;
		font-size: inherit;
	}
	.compact .objective-list {
		display: inline;
		padding-left: 0.5rem;
		list-style: none;
	}
	.compact .objective-list li {
		display: inline;
	}
	.compact .objective-list li + li::before {
		content: ' · ';
	}
	.compact .course-section {
		min-height: 3.875rem;
		margin-top: 0;
		padding: 0.5rem 0;
	}
	.compact .section-title {
		margin-bottom: 0.25rem;
		font-size: 0.875rem;
		line-height: 1.45;
		letter-spacing: 0;
	}
	.compact .resource-list {
		flex-direction: row;
		flex-wrap: wrap;
		gap: 0 1rem;
	}
	.compact .resource-row {
		min-height: 2.75rem;
		padding: 0;
	}
	.compact .inline-resource {
		font-size: 0.75rem;
	}
	.compact .deadlines {
		gap: 0.75rem;
	}
	.compact .deadline {
		gap: 0.25rem;
	}
	.compact .deadline-meta {
		flex-direction: row;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
	}
	.section-panel .course-section {
		margin-top: 0;
		padding-top: 0;
		border-top: 0;
	}
	.section-panel .section-title {
		margin-bottom: 1.25rem;
		font-size: 1.25rem;
		line-height: 1.333;
	}
	.section-panel .resource-list {
		margin-top: 0;
	}
	.section-panel .resource-row {
		padding: 1rem 0;
	}
	.section-panel .complementary-resources .resource-list {
		gap: 0.5rem;
	}
	.section-panel .complementary-resources .resource-row {
		min-height: 2.75rem;
		padding: 0;
	}
	.section-panel .inline-resource {
		font-size: 1rem;
	}
	.section-body {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 1rem;
	}
	.course-section-heading {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}
	.course-section-heading :global(svg) {
		width: var(--icon-size);
		height: var(--icon-size);
		flex-shrink: 0;
		align-self: flex-start;
		margin-top: 0.25rem;
		color: var(--primary);
	}
	.instruction-block {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.75rem;
	}
	.instruction-block + .instruction-block {
		margin-top: 0.75rem;
	}
	.instruction-copy {
		color: color-mix(in oklch, var(--foreground) 75%, var(--muted-foreground));
		min-width: 0;
		font-weight: 400;
		text-wrap: pretty;
	}
	.compact .instruction-copy {
		font-size: inherit;
		line-height: inherit;
	}
	.section-body > p,
	.note-copy,
	.deadline > p {
		max-width: 70ch;
	}
	.rubric-section {
		min-width: 0;
		border-top: 1px solid var(--border);
	}
	.rubric-disclosure summary {
		display: flex;
		min-height: 2.75rem;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		padding-block: 1rem;
		border-radius: var(--radius-sm);
		list-style: none;
		transition: color var(--motion-fast) var(--ease-work);
	}
	.rubric-disclosure summary::-webkit-details-marker {
		display: none;
	}
	.rubric-summary-title {
		flex: 1 1 12rem;
		font-size: 1rem;
		font-weight: 600;
		text-wrap: pretty;
	}
	.rubric-disclosure :global(.rubric-chevron) {
		color: var(--primary);
		margin-inline-start: auto;
	}
	.rubric-disclosure[open] :global(.rubric-chevron) {
		transform: rotate(180deg);
	}
	.rubric-disclosure summary:focus-visible {
		color: var(--primary);
	}
	@media (hover: hover) {
		.rubric-disclosure summary:hover {
			color: var(--primary);
		}
	}
	.rubric-groups {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding-bottom: 0.5rem;
	}
	.rubric-section li {
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--border);
	}
	.rubric-section .rubric-group:last-child li:last-child {
		border-bottom: 0;
	}
	.rubric-group {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.75rem;
	}
	.rubric-group + .rubric-group {
		margin-top: 0.5rem;
	}
	@media (prefers-reduced-motion: no-preference) {
		.course-document :global(.course-detail) {
			opacity: 1;
			transform: translateX(0);
			transition:
				opacity var(--motion-panel) var(--ease-work),
				transform var(--motion-panel) var(--ease-work);
		}
		.rubric-disclosure :global(.rubric-chevron) {
			transition: transform var(--motion-fast) var(--ease-work);
		}
		@starting-style {
			.course-document :global(.course-detail) {
				opacity: 0.65;
				transform: translateX(6px);
			}
		}
	}
	.rubric-line-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.25rem 1rem;
	}
	.rubric-maximum {
		flex-shrink: 0;
		color: var(--muted-foreground);
		font-size: 0.875rem;
		font-variant-numeric: tabular-nums;
	}
	.course-document pre {
		max-width: 100%;
		overscroll-behavior-inline: contain;
		background: var(--muted);
	}
	.compact .section-body {
		gap: 0.5rem;
	}
	.compact .deadline {
		padding-bottom: 0.75rem;
	}
	.reading-objectives {
		max-width: 70ch;
		margin-top: 2rem;
	}
	@container (min-width: 35rem) {
		.compact .course-section {
			display: grid;
			grid-template-columns: 11.5rem minmax(0, 1fr);
			gap: 0.75rem;
		}
		.compact .section-title {
			margin-bottom: 0;
			padding-top: 0.75rem;
		}
		.compact .deadlines {
			padding-top: 0.25rem;
		}
	}
	@media (max-width: 40rem) {
		.course-title {
			font-size: 1.875rem;
		}
		.compact .course-title {
			font-size: 1.5rem;
		}
		.resource-row {
			flex-wrap: wrap;
			gap: 0.25rem 1rem;
		}
		.resource-action {
			margin-left: auto;
		}
	}
</style>
