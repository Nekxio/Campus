import { describe, expect, it } from 'vitest';
import { fromDateInput, toDateInput, teachingMonth, lessonDatesInMonth } from './calendar.js';
describe('Paris teaching calendar', () => {
	it('uses Paris offsets independently of the server or browser time zone', () => {
		expect(fromDateInput('2026-10-13T09:00')).toBe('2026-10-13T07:00:00.000Z');
		expect(fromDateInput('2026-12-13T09:00')).toBe('2026-12-13T08:00:00.000Z');
		expect(toDateInput('2026-10-13T07:00:00.000Z')).toBe('2026-10-13T09:00');
	});
	it('rejects nonexistent and ambiguous daylight-saving times', () => {
		expect(() => fromDateInput('2026-03-29T02:30')).toThrow();
		expect(() => fromDateInput('2026-10-25T02:30')).toThrow();
	});
	it('bounds the current month in Paris through daylight-saving changes', () => {
		const month = teachingMonth(new Date('2026-03-31T22:30:00Z'));
		expect(month.month).toBe('2026-04');
		expect(month.startsAt.toISOString()).toBe('2026-03-31T22:00:00.000Z');
		expect(month.endsAt.toISOString()).toBe('2026-04-30T22:00:00.000Z');
	});
	it('marks Paris days, clips spanning lessons and excludes an exclusive end at midnight', () => {
		const month = teachingMonth(new Date('2026-10-14T12:00:00Z'));
		const lesson = (start: string, end: string) => ({
			startsAt: new Date(start),
			endsAt: new Date(end)
		});
		expect(
			lessonDatesInMonth(month, [
				lesson('2026-09-30T21:30:00Z', '2026-10-01T22:00:00Z'),
				lesson('2026-10-14T22:30:00Z', '2026-10-15T01:00:00Z'),
				lesson('2026-10-15T08:00:00Z', '2026-10-15T09:00:00Z'),
				lesson('2026-10-31T22:30:00Z', '2026-11-01T03:00:00Z')
			])
		).toEqual(['2026-10-01', '2026-10-15', '2026-10-31']);
	});
});
