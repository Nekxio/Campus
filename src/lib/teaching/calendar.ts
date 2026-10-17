import {
	CalendarDateTime,
	fromDate,
	parseDate,
	parseDateTime,
	toCalendarDateTime,
	toZoned
} from '@internationalized/date';
export const teachingTimeZone = 'Europe/Paris';
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
export function formatLessonDate(value: string) {
	return new Intl.DateTimeFormat('fr-FR', {
		timeZone: teachingTimeZone,
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(new Date(value));
}
