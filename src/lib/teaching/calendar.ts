import { fromDate, parseDateTime, toCalendarDateTime, toZoned } from '@internationalized/date';
export const teachingTimeZone = 'Europe/Paris';
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
