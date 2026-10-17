<script lang="ts">
	import { parseDate } from '@internationalized/date';
	import { Calendar } from '#lib/components/ui/calendar/index.js';
	import { teachingTimeZone } from '#lib/teaching/calendar.js';
	import type { HomeData } from '#lib/teaching/types.js';
	let { data }: { data: HomeData['calendar'] } = $props();
	const month = $derived(parseDate(`${data.month}-01`));
	const dates = $derived(new Set(data.lessonDates));
	const dateLabel = new Intl.DateTimeFormat('fr-FR', {
		timeZone: teachingTimeZone,
		dateStyle: 'full'
	});
</script>

<div class="lesson-calendar">
	<Calendar
		type="single"
		locale="fr-FR"
		weekStartsOn={1}
		placeholder={month}
		readonly
		navigation={false}
		aria-label="Calendrier des séances du mois"
		class="w-full p-0"
	>
		{#snippet day({ day, outsideMonth })}
			<span class={['lesson-day', { outside: outsideMonth }]}>
				<span aria-hidden="true">{day.day}</span>
				<span class="sr-only"
					>{dateLabel.format(day.toDate(teachingTimeZone))}{dates.has(day.toString())
						? ', séance planifiée'
						: ''}</span
				>
				{#if !outsideMonth && dates.has(day.toString())}<span class="lesson-dot" aria-hidden="true"
					></span>{/if}
			</span>
		{/snippet}
	</Calendar>
	<p class="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
		<span class="lesson-dot" aria-hidden="true"></span>Jour avec une séance · heure de Paris
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
	.lesson-day {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 2.5rem;
		font-size: 0.875rem;
	}
	.outside {
		color: var(--muted-foreground);
	}
	.lesson-dot {
		display: inline-block;
		width: 0.375rem;
		height: 0.375rem;
		border-radius: 50%;
		background: var(--foreground);
		flex-shrink: 0;
	}
	.lesson-day .lesson-dot {
		position: absolute;
		bottom: 0.125rem;
	}
</style>
