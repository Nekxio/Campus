<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import ContentCard from '#lib/components/shared/ContentCard.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { Resource } from '#lib/domain/contracts.js';
	import type { PublicationSnapshot } from '#lib/domain/publication.js';
	import { formatLessonDate } from '#lib/teaching/calendar.js';
	import CourseMarkdown from './CourseMarkdown.svelte';
	import { publicRubricTotals } from './course-presentation.js';

	let {
		snapshot,
		idPrefix,
		rubricSection,
		resourceLinks,
		children
	}: {
		snapshot: PublicationSnapshot;
		idPrefix: string;
		rubricSection: Snippet<[PublicationSnapshot['rubric'][number], boolean?]>;
		resourceLinks: Snippet<[Resource[], boolean?, boolean?]>;
		children: Snippet;
	} = $props();
	const dossiers = $derived(
		(snapshot.studentContent.dossiers ?? []).flatMap((dossier) => {
			const rubric = snapshot.rubric.find((assessment) => assessment.assessmentId === dossier.assessmentId);
			if (!rubric) return [];
			return [
				{
					...dossier,
					rubric,
					totals: publicRubricTotals(rubric),
					deadline: snapshot.deadlines.find((date) => date.assessmentId === dossier.assessmentId),
					links: snapshot.resources.filter((link) => dossier.resourceIds.includes(link.id))
				}
			];
		})
	);
	let selectedId = $state<string | null>(null);
	const selected = $derived(dossiers.find((dossier) => dossier.assessmentId === selectedId));
	const selectDossier = async (id: string | null) => {
		const target = id ? `${idPrefix}-dossier-title` : `${idPrefix}-dossier-${selectedId}`;
		selectedId = id;
		await tick();
		document.getElementById(target)?.focus();
	};
	const focusPart = (part: string) => {
		const target = document.getElementById(`${idPrefix}-dossier-${part}`);
		if (!target) return;
		const disclosure = target.querySelector('details');
		if (disclosure) disclosure.open = true;
		(target.querySelector('summary') ?? target).focus({ preventScroll: true });
		target.scrollIntoView({ block: 'start' });
	};
</script>

{#snippet shortcut(part: string, label: string)}
	<Button
		type="button"
		variant="link"
		class="min-h-11 px-0 underline underline-offset-4"
		aria-controls={`${idPrefix}-dossier-${part}`}
		onclick={() => focusPart(part)}>{label}</Button
	>
{/snippet}

{#if selected}
	<div class="course-detail flex min-w-0 flex-col gap-5">
		<Button type="button" variant="ghost" class="w-fit px-0" onclick={() => selectDossier(null)}>
			<ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />Retour aux dossiers
		</Button>
		<h3 class="panel-title" id={`${idPrefix}-dossier-title`} tabindex="-1">{selected.rubric.title}</h3>
		<nav class="flex flex-wrap items-center gap-x-5 border-b" aria-label="Dans ce dossier">
			{#if selected.instructions.trim()}{@render shortcut('instructions', 'Consignes')}{/if}
			{@render shortcut('rubric', 'Barème')}
			{#if selected.deadline}{@render shortcut('due', 'Remise')}{/if}
			{#if selected.links.length}{@render shortcut('files', 'Fichiers')}{/if}
		</nav>
		{#if selected.instructions.trim()}
			<section id={`${idPrefix}-dossier-instructions`} tabindex="-1" class="flex min-w-0 flex-col gap-3">
				<h4 class="item-title">Consignes</h4>
				<CourseMarkdown text={selected.instructions} headingLevel={5} />
			</section>
		{/if}
		<div id={`${idPrefix}-dossier-rubric`} tabindex="-1">
			{@render rubricSection(selected.rubric, true)}
		</div>
		{#if selected.deadline}
			<section id={`${idPrefix}-dossier-due`} tabindex="-1" class="flex flex-col gap-2">
				<h4 class="item-title">Échéance et remise</h4>
				<time datetime={selected.deadline.dueAt} class="font-medium">{formatLessonDate(selected.deadline.dueAt)}</time>
				{#if selected.deadline.submissionInstructions.trim()}
					<CourseMarkdown text={selected.deadline.submissionInstructions} headingLevel={5} />
				{/if}
			</section>
		{/if}
		{#if selected.links.length}
			<section id={`${idPrefix}-dossier-files`} tabindex="-1" class="flex flex-col gap-2">
				<h4 class="item-title">Fichiers du dossier</h4>
				{@render resourceLinks(selected.links, false, false)}
			</section>
		{/if}
	</div>
{:else}
	{#if dossiers.length}
		<section class="flex flex-col gap-3">
			<h3 class="panel-title">Dossiers à remettre</h3>
			<ul class="grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2">
				{#each dossiers as dossier (dossier.assessmentId)}
					<li class="min-w-0">
						<ContentCard
							kind="button"
							id={`${idPrefix}-dossier-${dossier.assessmentId}`}
							title={dossier.rubric.title}
							heading="h4"
							icon={FolderIcon}
							metadataAtBottom
							onclick={() => selectDossier(dossier.assessmentId)}
						>
							{#snippet metadata()}
								<span class="block"
									>{dossier.totals.criteria} critère{dossier.totals.criteria > 1 ? 's' : ''} · {dossier.totals.points} point{dossier
										.totals.points > 1
										? 's'
										: ''}</span
								>
								{#if dossier.deadline}Remise le <time datetime={dossier.deadline.dueAt}
										>{formatLessonDate(dossier.deadline.dueAt)}</time
									>{/if}
							{/snippet}
						</ContentCard>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
	{@render children()}
{/if}

<style>
	[id][tabindex='-1'] {
		scroll-margin-block-start: 1.5rem;
	}
</style>
