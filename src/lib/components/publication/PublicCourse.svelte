<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import PublicHeader from '#lib/components/publication/PublicHeader.svelte';
	import ModuleCourseContent from '#lib/components/publication/ModuleCourseContent.svelte';
	import { publicationSections, type PublicModuleData } from '#lib/domain/publication.js';
	let {
		data,
		preview = false,
		activeSection = $bindable('supports')
	}: { data: PublicModuleData; preview?: boolean; activeSection?: string } = $props();
	const renderedAt = Date.now();
	const idPrefix = $derived(`${preview ? 'review' : 'cours'}-${data.contextId}`);
	const orderedDeadlines = $derived(
		[...data.snapshot.deadlines].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
	);
	const upcomingDeadline = $derived(
		orderedDeadlines.find((deadline) => Date.parse(deadline.dueAt) >= renderedAt) ?? null
	);
	const railDeadline = $derived(upcomingDeadline ?? orderedDeadlines.at(-1) ?? null);
	const projectLinks = $derived(
		data.snapshot.resources.filter((link) => link.kind === 'instructions' || link.kind === 'rubric')
	);
	const hasInlineInstructions = $derived(
		Boolean(
			data.snapshot.studentContent.instructions.trim() ||
			data.snapshot.studentContent.projectInstructions.trim() ||
			data.snapshot.rubric.length
		)
	);
	const submissionLink = $derived(
		projectLinks.find((link) => link.kind === 'instructions') ?? null
	);
	function date(value: string) {
		return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long' }).format(
			new Date(value)
		);
	}
	function time(value: string) {
		return new Intl.DateTimeFormat('fr-FR', {
			timeZone: 'Europe/Paris',
			hour: 'numeric',
			minute: '2-digit'
		})
			.format(new Date(value))
			.replace(':', ' h ');
	}
</script>

<PublicHeader
	className={data.snapshot.className}
	academicYear={data.snapshot.academicYear}
	mainId={idPrefix}
	showSkipLink={!preview}
/>
<svelte:element
	this={preview ? 'section' : 'main'}
	id={idPrefix}
	tabindex="-1"
	class={['public-course mx-auto', { preview }]}
>
	{#if data.classPath}
		<Button href={data.classPath} variant="link" class="mb-4 min-h-11 px-0"
			><ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />Retour à la classe</Button
		>
	{/if}
	<header class="course-introduction mb-7 flex flex-col gap-4">
		<svelte:element this={preview ? 'h2' : 'h1'} class="course-title font-semibold tracking-tight"
			>{data.snapshot.title}</svelte:element
		>
		{#if data.snapshot.description.trim()}<p
				class="course-description whitespace-pre-wrap text-muted-foreground"
			>
				{data.snapshot.description}
			</p>{/if}
	</header>
	{#if data.snapshot.objectives.length}
		<section class="mb-7 max-w-[70ch]" aria-labelledby={`${idPrefix}-objectives`}>
			<h2 id={`${idPrefix}-objectives`} class="mb-2 text-base font-semibold">
				Objectifs du module
			</h2>
			<ul class="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed text-muted-foreground">
				{#each data.snapshot.objectives as objective, index (`${index}-${objective}`)}<li>
						{objective}
					</li>{/each}
			</ul>
		</section>
	{/if}
	{#if railDeadline}<section
			class="deadline-reminder mb-6 flex min-w-0 flex-wrap items-center justify-between gap-x-5 gap-y-2 rounded-xl border px-4 py-3"
			aria-label={upcomingDeadline ? 'Prochaine échéance' : 'Dernière échéance'}
		>
			<div class="min-w-0 text-sm">
				<p class="font-medium wrap-anywhere">{railDeadline.label}</p>
				<p class="mt-1 text-muted-foreground">
					<time datetime={railDeadline.dueAt}
						>{date(railDeadline.dueAt)} · {time(railDeadline.dueAt)}</time
					>
					· heure de Paris{!upcomingDeadline ? ' · échéance passée' : ''}
				</p>
			</div>
			<Button type="button" variant="ghost" onclick={() => (activeSection = 'remise')}
				>Voir les modalités de remise</Button
			>
		</section>{/if}
	<Tabs.Root bind:value={activeSection} class="student-tabs min-w-0 gap-0">
		<Tabs.List
			class="grid w-full grid-cols-2 gap-1 rounded-2xl lg:grid-cols-5 lg:rounded-full"
			aria-label="Contenu du module"
		>
			{#each publicationSections as section (section.id)}
				<Tabs.Trigger value={section.id} class="min-h-11 whitespace-normal"
					>{section.label}</Tabs.Trigger
				>
			{/each}
		</Tabs.List>
		<div class="course-columns mt-10 grid min-w-0 gap-8">
			<div class="course-panels min-w-0">
				{#each publicationSections as section (section.id)}
					<Tabs.Content
						value={section.id}
						class="min-w-0 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
					>
						<ModuleCourseContent
							snapshot={data.snapshot}
							{idPrefix}
							onlySection={section.id}
							showObjectives={false}
						/>
					</Tabs.Content>
				{/each}
			</div>
			<aside class="project-rail min-w-0" aria-label="Échéance et documents du projet">
				<section
					class="deadline-panel rounded-xl border p-6"
					aria-labelledby={`${idPrefix}-rail-deadline-title`}
				>
					<h2 id={`${idPrefix}-rail-deadline-title`} class="mb-3.5 text-base font-semibold">
						{upcomingDeadline
							? 'Prochaine échéance'
							: railDeadline
								? 'Dernière échéance'
								: 'Échéances'}
					</h2>
					{#if railDeadline}
						<time datetime={railDeadline.dueAt} class="flex flex-col gap-1 tabular-nums"
							><span class="deadline-date text-2xl font-semibold tracking-tight"
								>{date(railDeadline.dueAt)}</span
							><span class="text-sm text-muted-foreground"
								>{time(railDeadline.dueAt)} · heure de Paris</span
							></time
						>
						{#if !upcomingDeadline}<p class="mt-3 text-sm text-muted-foreground">
								Cette échéance est passée.
							</p>{/if}
						<div class="mt-5 flex flex-col gap-2">
							<Separator class="mb-3" />
							<h3 class="text-sm font-medium">{railDeadline.label}</h3>
							{#if railDeadline.submissionInstructions.trim()}<p
									class="text-sm whitespace-pre-wrap text-muted-foreground"
								>
									{railDeadline.submissionInstructions}
								</p>{:else}<p class="text-sm text-muted-foreground">
									Les modalités de remise ne sont pas précisées.
								</p>{/if}
						</div>
						{#if submissionLink}
							<!-- The publication supplies validated selected external HTTPS links. -->
							<!-- eslint-disable svelte/no-navigation-without-resolve -->
							<a
								href={submissionLink.url}
								target="_blank"
								rel="noreferrer"
								class="project-link mt-1 inline-flex min-h-11 items-center gap-2 rounded-sm text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
								>Consigne de remise<ExternalLinkIcon
									class="size-4 shrink-0"
									aria-hidden="true"
								/><span class="sr-only">
									· {submissionLink.label} · lien externe, nouvel onglet</span
								></a
							>
						{/if}
					{:else}
						<p class="text-sm text-muted-foreground">
							Aucune échéance n’est indiquée pour le moment.
						</p>
					{/if}
				</section>
				<section
					class="project-documents mt-7 border-l pt-6 pl-6"
					aria-labelledby={`${idPrefix}-project-title`}
				>
					<h2 id={`${idPrefix}-project-title`} class="mb-1.5 text-base font-semibold">
						Pour le projet
					</h2>
					<ul class="flex min-w-0 flex-col">
						{#each projectLinks as link (link.id)}
							<li>
								<!-- eslint-disable svelte/no-navigation-without-resolve -->
								<a
									href={link.url}
									target="_blank"
									rel="noreferrer"
									class="project-link flex min-h-11 min-w-0 items-center gap-2 rounded-sm py-2 text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
									><span>{link.label}</span><span class="sr-only">
										· lien externe, nouvel onglet</span
									></a
								>
							</li>
						{:else}<li class="text-sm text-muted-foreground">
								{#if hasInlineInstructions}Les consignes et la grille vierge se trouvent dans «
									Consignes et barèmes ».{:else}Aucune consigne ni aucun barème n’est indiqué pour
									le moment.{/if}
							</li>{/each}
					</ul>
				</section>
			</aside>
		</div>
	</Tabs.Root>
</svelte:element>

<style>
	.public-course {
		container: course / inline-size;
		max-width: calc(72rem + 2.5rem);
		min-height: calc(100svh - 5rem);
		padding: 1.5rem max(1.25rem, env(safe-area-inset-right, 0px))
			calc(4rem + env(safe-area-inset-bottom, 0px)) max(1.25rem, env(safe-area-inset-left, 0px));
		overflow-wrap: anywhere;
	}
	.course-title {
		font-size: 2.25rem;
		line-height: 1.15;
		text-wrap: balance;
	}
	.course-description {
		max-width: 70ch;
		font-size: 1rem;
		line-height: 1.625;
	}
	.public-course :global([data-slot='tabs-trigger']) {
		min-height: 2.75rem;
		touch-action: manipulation;
	}
	.public-course :global([data-slot='tabs-trigger']:last-child) {
		grid-column: 1 / -1;
	}
	.public-course :global([data-slot='tabs-list']) {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		border-radius: var(--radius-2xl);
	}
	.preview {
		min-height: auto;
		padding: 1.25rem;
	}
	.project-rail {
		align-self: start;
		font-size: 1rem;
		line-height: 1.6;
	}
	.deadline-date {
		line-height: 1.25;
	}
	.project-link {
		touch-action: manipulation;
	}
	@media (hover: hover) and (pointer: fine) {
		.project-link:hover {
			text-decoration-thickness: 2px;
		}
	}
	@container course (min-width: 64rem) {
		.public-course :global([data-slot='tabs-list']) {
			grid-template-columns: repeat(5, minmax(0, 1fr));
		}
		.course-columns {
			grid-template-columns: minmax(0, 1fr) 20.25rem;
			column-gap: clamp(2.5rem, calc(100vw - 74.75rem), 5.25rem);
		}
		.public-course :global([data-slot='tabs-trigger']:last-child) {
			grid-column: auto;
		}
	}
	@media (max-width: 40rem) {
		.course-title {
			font-size: 1.875rem;
		}
	}
</style>
