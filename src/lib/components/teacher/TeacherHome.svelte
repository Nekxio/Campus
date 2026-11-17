<script lang="ts">
	import CalendarIcon from '@lucide/svelte/icons/calendar-days';
	import DailyCalendarSync from '#lib/components/calendar/DailyCalendarSync.svelte';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { Button } from '#lib/components/ui/button/index.js';
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import LessonCalendar from './LessonCalendar.svelte';
	import type { HomeData } from '#lib/teaching/types.js';
	import { formatLessonDate } from '#lib/teaching/calendar.js';
	import TeacherWorkspace from '#lib/components/teaching/TeacherWorkspace.svelte';
	import * as Alert from '#lib/components/ui/alert/index.js';
	let { userName, data }: { userName: string; data: HomeData } = $props();
	const scope = $derived(
		new URLSearchParams({
			...(data.nextLesson?.classId ? { classe: data.nextLesson.classId } : {}),
			...(data.nextLesson?.contextId ? { contexte: data.nextLesson.contextId } : {})
		}).toString()
	);
	const reviewModules = $derived(data.modules.filter((module) => module.needsReview));
	afterNavigate(({ to }) => {
		if (to?.url.hash === '#modules') void goto(resolve('/enseignant/modules'), { replace: true });
	});
</script>

<TeacherWorkspace {userName} active="home" title="Accueil">
	<DailyCalendarSync />
	<header class="home-heading">
		<div>
			<h1 class="page-title">Mon atelier</h1>
		</div>
		<Button href="/enseignant/modules/nouveau"><PlusIcon data-icon="inline-start" />Créer un module</Button>
	</header>
	<div class="home-stage">
		<section class={['next-lesson', { empty: !data.nextLesson }]} aria-label="Prochaine séance">
			{#if data.nextLesson}
				<h2>Prochaine séance</h2>
				<p class="lesson-date">
					<CalendarIcon aria-hidden="true" /><time datetime={data.nextLesson.startsAt}
						>{formatLessonDate(data.nextLesson.startsAt)}</time
					>
				</p>
				<h3>{data.nextLesson.moduleTitle}</h3>
				<p class="lesson-context">
					{data.nextLesson.className}
				</p>
				<p class="lesson-title">{data.nextLesson.title}</p>
				<div class="lesson-actions">
					<Button href={`/enseignant/modules/${data.nextLesson.moduleId}?section=preparation&${scope}`}
						>Ouvrir la préparation<ArrowRightIcon data-icon="inline-end" /></Button
					><Button variant="outline" href={`/enseignant/modules/${data.nextLesson.moduleId}?section=planning&${scope}`}
						>Voir le planning</Button
					>
				</div>
			{:else}
				<h2>{data.modules.length ? 'Aucune séance à venir' : 'Votre premier module'}</h2>
				<p class="lesson-title">
					{data.modules.length
						? 'Ajoutez une date dans « Classe et planning » d’un module.'
						: 'Commencez par créer un module pour préparer vos cours, puis associez-lui une classe.'}
				</p>
				{#if data.modules.length}
					<div class="lesson-actions">
						<Button variant="outline" href="/enseignant/modules"
							>Choisir un module<ArrowRightIcon data-icon="inline-end" /></Button
						>
					</div>
				{/if}
			{/if}
		</section>
		<aside class="home-calendar" aria-label="Calendrier des séances">
			<LessonCalendar data={data.calendar} nextLesson={data.nextLesson} />
		</aside>
		<details class="mobile-calendar">
			<summary>Afficher le calendrier du mois</summary><LessonCalendar
				data={data.calendar}
				nextLesson={data.nextLesson}
			/>
		</details>
	</div>
	{#if reviewModules.length}<Alert.Root role="region" aria-label="Brouillons à relire" class="mb-8"
			><Alert.Title>Brouillons à relire avant publication</Alert.Title><Alert.Description
				><ul class="flex flex-wrap gap-3">
					{#each reviewModules as module (module.id)}<li>
							<Button variant="link" href={`/enseignant/modules/${module.id}`}>{module.title}</Button>
						</li>{/each}
				</ul></Alert.Description
			></Alert.Root
		>{/if}
</TeacherWorkspace>

<style>
	.mobile-calendar {
		display: none;
	}
	.mobile-calendar summary {
		min-height: 44px;
		padding-block: 0.75rem;
		font-size: 0.875rem;
		font-weight: 600;
	}
	.home-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1.5rem;
	}
	.home-stage {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 21rem;
		margin-top: var(--space-sections);
		margin-bottom: var(--space-sections);
		background: var(--card);
		border-radius: var(--radius-xl);
	}
	.next-lesson {
		padding: var(--surface-padding);
		min-width: 0;
		grid-column: 1;
	}
	.next-lesson h2 {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--muted-foreground);
	}
	.next-lesson h3 {
		font-size: 2rem;
		line-height: 1.2;
		font-weight: 600;
		letter-spacing: -0.03em;
		margin-top: 1rem;
		max-width: 24ch;
		overflow-wrap: anywhere;
	}
	.next-lesson.empty {
		align-self: start;
	}
	.next-lesson.empty h2 {
		font-size: 1.25rem;
		color: var(--foreground);
	}
	.next-lesson.empty .lesson-actions {
		margin-top: var(--space-content);
	}
	.lesson-date {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1.5rem;
		color: var(--primary);
		font-size: 0.875rem;
		font-weight: 600;
	}
	.lesson-date :global(svg) {
		width: var(--icon-size);
		height: var(--icon-size);
	}
	.lesson-context {
		margin-top: 0.75rem;
		font-weight: 500;
		overflow-wrap: anywhere;
	}
	.lesson-title {
		margin-top: 0.5rem;
		color: var(--muted-foreground);
		max-width: 55ch;
		overflow-wrap: anywhere;
	}
	.lesson-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: var(--space-groups);
	}
	.home-calendar {
		grid-column: 2;
		grid-row: 1;
		padding: 1.5rem;
		background: var(--muted);
		border-radius: 0 var(--radius-xl) var(--radius-xl) 0;
		min-width: 0;
	}
	@media (max-width: 79.99rem) {
		.home-stage {
			grid-template-columns: minmax(0, 1fr) 18rem;
		}
		.next-lesson h3 {
			font-size: 1.75rem;
		}
		.home-calendar {
			padding: 1rem;
		}
	}
	@media (max-width: 55rem) {
		.home-stage {
			grid-template-columns: 1fr;
			background: transparent;
		}
		.next-lesson {
			background: var(--card);
			border-radius: var(--radius-xl);
		}
		.home-calendar {
			display: none;
		}
		.mobile-calendar {
			display: block;
			margin-top: 1rem;
			grid-column: 1;
		}
		.home-heading {
			align-items: start;
			flex-direction: column;
		}
	}
</style>
