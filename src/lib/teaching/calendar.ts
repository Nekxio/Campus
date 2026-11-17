import {
	CalendarDateTime,
	fromDate,
	parseDate,
	parseDateTime,
	toCalendarDateTime,
	toZoned
} from '@internationalized/date';
export const teachingTimeZone = 'Europe/Paris';
const lessonDateFormatter = new Intl.DateTimeFormat('fr-FR', {
	dateStyle: 'medium',
	timeStyle: 'short',
	timeZone: teachingTimeZone
});
const teachingDateFormatters = {
	long: new Intl.DateTimeFormat('fr-FR', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: teachingTimeZone
	}),
	full: new Intl.DateTimeFormat('fr-FR', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: teachingTimeZone
	})
};
const teachingTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
	timeStyle: 'short',
	timeZone: teachingTimeZone
});
export const validTeachingMonth = (value: string | null | undefined): string | undefined =>
	value && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : undefined;

export const teachingCalendarMonth = (fallback: Date, requested?: string | null) => {
	const month = validTeachingMonth(requested);
	const range = teachingMonth(month ? parseDate(`${month}-01`).toDate(teachingTimeZone) : fallback);
	// The calendar library clamps month addition at year 9999; December still includes its last day.
	if (range.month === '9999-12') {
		return { ...range, endsAt: new Date(range.startsAt.getTime() + 31 * 24 * 60 * 60 * 1000) };
	}
	return range;
};

export function teachingMonth(now: Date) {
	const local = fromDate(now, teachingTimeZone);
	const start = toZoned(new CalendarDateTime(local.year, local.month, 1), teachingTimeZone);
	return {
		month: start.toString().slice(0, 7),
		startsAt: start.toDate(),
		endsAt: start.add({ months: 1 }).toDate()
	};
}
export function lessonDatesInMonth(
	month: ReturnType<typeof teachingMonth>,
	lessons: { startsAt: Date; endsAt: Date }[]
) {
	const dates = new Set<string>();
	for (const lesson of lessons) {
		const start = Math.max(lesson.startsAt.getTime(), month.startsAt.getTime());
		const end = Math.min(lesson.endsAt.getTime(), month.endsAt.getTime());
		if (end <= start) continue;
		let date = parseDate(fromDate(new Date(start), teachingTimeZone).toString().slice(0, 10));
		const last = fromDate(new Date(end - 1), teachingTimeZone)
			.toString()
			.slice(0, 10);
		while (date.toString() <= last) {
			dates.add(date.toString());
			if (date.toString() === last) break;
			date = date.add({ days: 1 });
		}
	}
	return [...dates].sort();
}
export function toDateInput(value: string) {
	return value
		? toCalendarDateTime(fromDate(new Date(value), teachingTimeZone))
				.toString()
				.slice(0, 16)
		: '';
}
export function fromDateInput(value: string) {
	return toZoned(parseDateTime(value), teachingTimeZone, 'reject').toDate().toISOString();
}
export const formatLessonDate = (value: string) => lessonDateFormatter.format(new Date(value));

export const formatTeachingDate = (value: string, style: 'long' | 'full' = 'long') =>
	teachingDateFormatters[style].format(new Date(value));

export const formatTeachingTime = (value: string) => teachingTimeFormatter.format(new Date(value)).replace(':', ' h ');
