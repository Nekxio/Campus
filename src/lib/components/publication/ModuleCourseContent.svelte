<script lang="ts">
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import { cn } from '#lib/utils.js';
	import type { PublicationSnapshot } from '#lib/domain/publication.js';
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
	const objectiveEntries = $derived.by(() => {
		const occurrences: Record<string, number> = Object.create(null);
		return snapshot.objectives.map((label) => {
			const occurrence = occurrences[label] ?? 0;
			occurrences[label] = occurrence + 1;
			return { label, key: `${label}:${occurrence}` };
		});
	});
	const courseLinks = $derived(snapshot.resources.filter((link) => link.kind === 'course'));
	const assignmentLinks = $derived(
		snapshot.resources.filter((link) => link.kind === 'instructions' || link.kind === 'rubric')
	);
	const usefulLinks = $derived(snapshot.resources.filter((link) => link.kind === 'resource'));
	const hasInlineInstructions = $derived(
		Boolean(
			snapshot.studentContent.instructions.trim() ||
			snapshot.studentContent.projectInstructions.trim() ||
			snapshot.rubric.length
		)
	);
	const notes = $derived(
		snapshot.lessonNotes.filter((note) => note.recap.trim() || note.toDo.trim())
	);
	const hasNotes = $derived(notes.length > 0 || !!snapshot.recap.trim() || !!snapshot.toDo.trim());
	function date(value: string, includeTime = false) {
		return new Intl.DateTimeFormat('fr-FR', {
			timeZone: 'Europe/Paris',
			dateStyle: 'long',
			...(includeTime ? { timeStyle: 'short' as const } : {})
		}).format(new Date(value));
	}
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
		const sectionIds = [
			'supports',
			'consignes',
			'remise',
			'ressources',
			...(hasNotes ? ['suivi'] : [])
		];
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
				? scrollRoot.scrollTop > 0 &&
					scrollRoot.scrollTop + scrollRoot.clientHeight >= scrollRoot.scrollHeight - 1
				: window.scrollY > 0 &&
					window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
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

{#snippet resourceLinks(links: Resource[])}
	{#if onlySection}<Separator />{/if}
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
						<span>{link.label}</span>{#if isPdf(link)}<span
								class="text-xs font-normal text-muted-foreground">PDF</span
							>{/if}
					</div>
					{#if onlySection}
						<Button
							href={link.url}
							target="_blank"
							rel="noreferrer"
							variant="outline"
							class="min-h-11"
						>
							{resourceAction(link)}<ExternalLinkIcon
								data-icon="inline-end"
								aria-hidden="true"
							/><span class="sr-only"> · {link.label} · lien externe, nouvel onglet</span>
						</Button>
					{:else}
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							href={link.url}
							target="_blank"
							rel="noreferrer"
							class="resource-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
						>
							{resourceAction(link)}<ExternalLinkIcon
								class="size-4 shrink-0"
								aria-hidden="true"
							/><span class="sr-only"> · {link.label} · lien externe, nouvel onglet</span>
						</a>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
	{#if onlySection}<Separator />{/if}
{/snippet}

{#snippet noteText(label: string, text: string)}
	<p class="note-copy whitespace-pre-wrap text-muted-foreground">
		<strong class="font-medium text-foreground">{label}<span aria-hidden="true"> :</span></strong>
		{text}
	</p>
{/snippet}

{#snippet moduleObjectives()}
	<div class="course-objectives">
		<svelte:element
			this={compact || onlySection ? 'h3' : 'h2'}
			class="objectives-title font-semibold">Objectifs du module</svelte:element
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
			{#if snapshot.description.trim()}<p
					class="course-description whitespace-pre-wrap text-muted-foreground"
				>
					{snapshot.description}
				</p>{/if}
			{#if snapshot.objectives.length > 0}{@render moduleObjectives()}{/if}
		</header>
	{/if}
	{#if !onlySection || onlySection === 'supports'}
		<section
			id={`${idPrefix}-supports`}
			aria-labelledby={`${idPrefix}-supports-title`}
			class="course-section"
		>
			<svelte:element
				this={compact ? 'h3' : 'h2'}
				id={`${idPrefix}-supports-title`}
				class="section-title">Supports du cours</svelte:element
			>
			<div class="section-body">
				{#if courseLinks.length > 0}{@render resourceLinks(
						courseLinks
					)}{:else if !snapshot.studentContent.exercises.length}<p class="empty-copy">
						Aucun support de cours n’est indiqué pour le moment.
					</p>{/if}
				{#each snapshot.studentContent.exercises as exercise (exercise.id)}
					<section class="flex flex-col gap-3 border-t pt-4" aria-label={exercise.title}>
						<h3 class="font-semibold">{exercise.title} · exercice non noté</h3>
						<p class="whitespace-pre-wrap">{exercise.instructions}</p>
						<h4 class="font-medium">Corrigé</h4>
						<p class="whitespace-pre-wrap">{exercise.solution}</p>
						{#if exercise.code}<pre class="overflow-x-auto rounded-xl border p-3"><code
									>{exercise.code}</code
								></pre>{/if}
					</section>
				{/each}
			</div>
			{#if onlySection && showObjectives && snapshot.objectives.length > 0}<div
					class="reading-objectives"
				>
					{@render moduleObjectives()}
				</div>{/if}
		</section>
	{/if}
	{#if !onlySection || onlySection === 'consignes'}
		<section
			id={`${idPrefix}-consignes`}
			aria-labelledby={`${idPrefix}-consignes-title`}
			class="course-section"
		>
			<svelte:element
				this={compact ? 'h3' : 'h2'}
				id={`${idPrefix}-consignes-title`}
				class="section-title">Consignes et barèmes</svelte:element
			>
			<div class="section-body">
				{#if assignmentLinks.length > 0}{@render resourceLinks(
						assignmentLinks
					)}{:else if !hasInlineInstructions}<p class="empty-copy">
						Aucune consigne ni aucun barème n’est indiqué pour le moment.
					</p>{/if}
				{#if snapshot.studentContent.instructions.trim()}<h3 class="font-semibold">
						Consignes du module
					</h3>
					<p class="whitespace-pre-wrap">{snapshot.studentContent.instructions}</p>{/if}
				{#if snapshot.studentContent.projectInstructions.trim()}<h3 class="font-semibold">
						Consignes du projet
					</h3>
					<p class="whitespace-pre-wrap">{snapshot.studentContent.projectInstructions}</p>{/if}
				{#each snapshot.rubric as assessment, assessmentIndex (assessmentIndex)}
					<section
						class="flex flex-col gap-3 border-t pt-4"
						aria-label={`Grille vierge · ${assessment.title}`}
					>
						<h3 class="font-semibold">{assessment.title} · grille vierge</h3>
						{#each assessment.groups as group, groupIndex (groupIndex)}
							<h4 class="font-medium">{group.title}</h4>
							<ul class="flex flex-col gap-3">
								{#each group.lines as line, lineIndex (lineIndex)}<li class="flex flex-col gap-1">
										<p>{line.label} · maximum {line.maxPoints} points</p>
										{#if line.description}<p
												class="text-sm whitespace-pre-wrap text-muted-foreground"
											>
												{line.description}
											</p>{/if}
									</li>{/each}
							</ul>
						{/each}
					</section>
				{/each}
			</div>
		</section>
	{/if}
	{#if !onlySection || onlySection === 'remise'}
		<section
			id={`${idPrefix}-remise`}
			aria-labelledby={`${idPrefix}-remise-title`}
			class="course-section"
		>
			<svelte:element
				this={compact ? 'h3' : 'h2'}
				id={`${idPrefix}-remise-title`}
				class="section-title">Échéances et remise</svelte:element
			>
			<div class="section-body deadlines">
				{#each snapshot.deadlines as deadline (deadline)}
					<div class="deadline">
						<div class="deadline-meta">
							<p class="font-medium">{deadline.label}</p>
							<p class="tabular-nums">
								<time datetime={deadline.dueAt}>{date(deadline.dueAt, true)}</time><span
									class="text-muted-foreground"
								>
									· heure de Paris</span
								>
							</p>
						</div>
						{#if deadline.submissionInstructions.trim()}<p
								class="whitespace-pre-wrap text-muted-foreground"
							>
								{deadline.submissionInstructions}
							</p>{:else}<p class="empty-copy">
								Les modalités de remise ne sont pas précisées.
							</p>{/if}
					</div>
				{:else}<p class="empty-copy">
						Aucune échéance ni modalité de remise n’est indiquée pour le moment.
					</p>{/each}
			</div>
		</section>
	{/if}
	{#if !onlySection || onlySection === 'ressources'}
		<section
			id={`${idPrefix}-ressources`}
			aria-labelledby={`${idPrefix}-ressources-title`}
			class="course-section"
		>
			<svelte:element
				this={compact ? 'h3' : 'h2'}
				id={`${idPrefix}-ressources-title`}
				class="section-title">Ressources utiles</svelte:element
			>
			<div class="section-body">
				{#if usefulLinks.length > 0}{@render resourceLinks(usefulLinks)}{:else}<p
						class="empty-copy"
					>
						Aucune ressource complémentaire n’est indiquée pour le moment.
					</p>{/if}
			</div>
		</section>
	{/if}
	{#if (!onlySection && hasNotes) || onlySection === 'suivi'}
		<section
			id={`${idPrefix}-suivi`}
			aria-labelledby={`${idPrefix}-suivi-title`}
			class="course-section"
		>
			<svelte:element
				this={compact ? 'h3' : 'h2'}
				id={`${idPrefix}-suivi-title`}
				class="section-title">Vu en cours / à faire</svelte:element
			>
			<div class="section-body notes">
				{#if !hasNotes}<p class="empty-copy">
						Aucun récapitulatif ni travail à faire n’est indiqué pour le moment.
					</p>{/if}
				{#each notes as note (note.id)}
					<div class="lesson-note">
						<div class="note-meta">
							<svelte:element this={compact ? 'h4' : 'h3'} class="font-medium"
								>{note.label}</svelte:element
							><time datetime={note.startsAt} class="text-muted-foreground"
								>{date(note.startsAt)}</time
							>
						</div>
						{#if note.recap.trim()}{@render noteText('Vu en cours', note.recap)}{/if}
						{#if note.toDo.trim()}{@render noteText('À faire', note.toDo)}{/if}
					</div>
				{/each}
				{#if snapshot.recap.trim() || snapshot.toDo.trim()}
					<div class="lesson-note">
						{#if snapshot.recap.trim()}{@render noteText('Vu en cours', snapshot.recap)}{/if}
						{#if snapshot.toDo.trim()}{@render noteText('À faire', snapshot.toDo)}{/if}
					</div>
				{/if}
			</div>
		</section>
	{/if}
</div>

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
		margin-top: 1.625rem;
		padding-top: 1.625rem;
		border-top: 1px solid var(--border);
		scroll-margin-top: 1.5rem;
	}
	.section-title {
		margin-bottom: 0.5rem;
		font-size: 1.25rem;
		font-weight: 600;
		letter-spacing: -0.025em;
		line-height: 1.4;
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
		padding: 0.5rem 0;
	}
	.resource-label {
		display: flex;
		min-width: 0;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.625rem;
		font-weight: 500;
	}
	.resource-action,
	.inline-resource {
		display: inline-flex;
		min-width: 0;
		min-height: 2.75rem;
		align-items: center;
		gap: 0.5rem;
		border-radius: 0.25rem;
		font-size: 0.875rem;
		text-decoration: underline;
		text-underline-offset: 4px;
	}
	.resource-action {
		flex-shrink: 0;
	}
	.resource-action:hover,
	.inline-resource:hover {
		text-decoration-thickness: 2px;
	}
	.deadlines,
	.notes {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.deadline,
	.lesson-note {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.deadline-meta,
	.note-meta {
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
		font-size: 0.8125rem;
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
		padding: 0.5625rem 0;
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
	.compact .deadlines,
	.compact .notes {
		gap: 0.75rem;
	}
	.compact .deadline,
	.compact .lesson-note {
		gap: 0.25rem;
	}
	.compact .deadline-meta,
	.compact .note-meta {
		flex-direction: row;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
	}
	.compact .note-meta time {
		font-size: 0.75rem;
	}
	.section-panel .course-section {
		margin-top: 0;
		padding-top: 0;
		border-top: 0;
	}
	.section-panel .section-title {
		margin-bottom: 0.75rem;
		font-size: 1.5rem;
		line-height: 1.333;
	}
	.section-panel .resource-list {
		margin-top: 0;
	}
	.section-panel .resource-row {
		padding: 1.5rem 0;
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
			padding-top: 0.6875rem;
		}
		.compact .deadlines,
		.compact .notes {
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
