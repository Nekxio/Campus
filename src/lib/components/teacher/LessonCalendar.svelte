<script lang="ts">
	import { parseDate, type DateValue } from '@internationalized/date';
	import { SvelteURL } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { ResolvedPathname } from '$app/types';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Calendar } from '#lib/components/ui/calendar/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import {
		teachingTimeZone,
		teachingMonth,
		formatTeachingDate,
		formatTeachingTime,
		formatLessonDate
	} from '#lib/teaching/calendar.js';
	import type { HomeData } from '#lib/teaching/types.js';
	let { data, nextLesson = null }: { data: HomeData['calendar']; nextLesson?: HomeData['nextLesson'] } = $props();
	const month = $derived(parseDate(`${data.month}-01`));
	const dates = $derived(new Set(data.lessonDates));
	const nextMonth = $derived(nextLesson ? teachingMonth(new Date(nextLesson.startsAt)).month : null);
	let loading = $state(false);
	let error = $state('');
	let openDay = $state<string | null>(null);
	const lessonTimeLabel = (lesson: { startsAt: string; endsAt: string }) => {
		const start = formatTeachingDate(lesson.startsAt, 'full');
		const end = formatTeachingDate(lesson.endsAt, 'full');
		return start === end
			? `${formatTeachingTime(lesson.startsAt)} – ${formatTeachingTime(lesson.endsAt)}`
			: `${formatLessonDate(lesson.startsAt)} – ${formatLessonDate(lesson.endsAt)}`;
	};
	const changeMonth = async (value: DateValue | undefined) => {
		if (!value || loading) return;
		const requested = value.toString().slice(0, 7);
		if (requested === data.month) return;
		const destination = new SvelteURL(page.url.href);
		destination.searchParams.set('mois', requested);
		loading = true;
		error = '';
		try {
			await goto(`${destination.pathname}${destination.search}${destination.hash}` as ResolvedPathname, {
				reset: false
			});
		} catch {
			error = 'Ce mois n’a pas pu être chargé. Réessayez.';
		} finally {
			loading = false;
		}
	};
</script>

<div class="lesson-calendar" aria-busy={loading}>
	<Calendar
		type="single"
		locale="fr-FR"
		calendarLabel="Calendrier des séances"
		weekStartsOn={1}
		bind:placeholder={() => month, (value) => void changeMonth(value)}
		disabled={loading}
		readonly
		minValue={parseDate('0001-01-01')}
		maxValue={parseDate('9999-12-31')}
		aria-label="Calendrier des séances du mois"
		class="w-full"
	>
		{#snippet day({ day, outsideMonth })}
			{@const lessons = outsideMonth ? [] : (data.lessonTimes?.[day.toString()] ?? [])}
			{#if lessons.length}
				<Tooltip.Root
					disableCloseOnTriggerClick
					open={openDay === day.toString()}
					onOpenChange={(open) => {
						if (open) openDay = day.toString();
						else if (openDay === day.toString()) openDay = null;
					}}
				>
					<Tooltip.Trigger
						class="lesson-day lesson-trigger"
						disabled={loading}
						onpointerdown={(event) => {
							if (event.pointerType === 'touch') event.preventDefault();
						}}
						onclick={() => {
							openDay = openDay === day.toString() ? null : day.toString();
						}}
					>
						<span aria-hidden="true">{day.day}</span>
						<span class="sr-only"
							>{formatTeachingDate(day.toDate(teachingTimeZone).toISOString(), 'full')}, séance planifiée</span
						>
						<span class="lesson-dot" aria-hidden="true"></span>
					</Tooltip.Trigger>
					<Tooltip.Content side="top" role="tooltip"
						><span class="grid gap-1"
							>{#each lessons as lesson, index (index)}<span>{lessonTimeLabel(lesson)}</span>{/each}</span
						></Tooltip.Content
					>
				</Tooltip.Root>
			{:else}
				<span class={['lesson-day', { outside: outsideMonth }]}>
					<span aria-hidden="true">{day.day}</span>
					<span class="sr-only"
						>{formatTeachingDate(day.toDate(teachingTimeZone).toISOString(), 'full')}{dates.has(day.toString())
							? ', séance planifiée'
							: ''}</span
					>
					{#if !outsideMonth && dates.has(day.toString())}<span class="lesson-dot" aria-hidden="true"></span>{/if}
				</span>
			{/if}
		{/snippet}
	</Calendar>
	{#if error}<p role="alert" class="mt-3 text-sm text-destructive">{error}</p>{/if}
	{#if loading}<p role="status" class="mt-3 text-center text-xs text-muted-foreground">
			Chargement des séances…
		</p>{:else if dates.size === 0}<p class="mt-3 text-center text-xs text-muted-foreground">
			Aucune séance planifiée pour ce mois.
		</p>{/if}
	{#if nextMonth && nextMonth !== data.month}
		<Button
			variant="link"
			class="mt-2 w-full whitespace-normal"
			disabled={loading}
			onclick={() => changeMonth(parseDate(`${nextMonth}-01`))}>Mois de la prochaine séance</Button
		>
	{/if}
	<p class="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
		<span class="lesson-dot" aria-hidden="true"></span>Jour avec une séance
	</p>
</div>

<style>
	.lesson-calendar {
		max-width: 22rem;
		margin-inline: auto;
	}
	.lesson-calendar :global([data-slot='calendar-grid']) {
		width: 100%;
	}
	.lesson-calendar :global(.lesson-day) {
		display: grid;
		grid-template-rows: 1.25rem 0.375rem;
		gap: 0.25rem;
		align-content: center;
		justify-items: center;
		min-height: 2.5rem;
		font-size: 0.875rem;
	}
	.lesson-calendar :global(.lesson-trigger) {
		width: 100%;
		cursor: pointer;
		border: 0;
		background: transparent;
		color: inherit;
	}
	.outside {
		color: var(--muted-foreground);
	}
	.lesson-dot {
		display: inline-block;
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 50%;
		background: var(--primary);
		flex-shrink: 0;
	}
</style>
