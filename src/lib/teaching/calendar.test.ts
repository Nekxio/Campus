import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	fromDateInput,
	toDateInput,
	teachingMonth,
	lessonDatesInMonth,
	validTeachingMonth,
	teachingCalendarMonth,
	formatLessonDate,
	formatTeachingDate,
	formatTeachingTime
} from './calendar.js';
describe('Paris teaching calendar', () => {
	afterEach(() => vi.unstubAllEnvs());
	it.each(['UTC', 'America/Los_Angeles', 'Asia/Tokyo'])(
		'keeps Paris display dates independent of the runtime time zone %s',
		(timeZone) => {
			vi.stubEnv('TZ', timeZone);
			expect(formatTeachingDate('2026-12-31T23:30:00Z')).toBe('1 janvier 2027');
			expect(formatTeachingDate('2026-06-30T22:30:00Z', 'full')).toBe('mercredi 1 juillet 2026');
			expect(formatLessonDate('2026-06-30T22:30:00Z')).toBe('1 juil. 2026, 00:30');
			expect(formatTeachingTime('2026-12-31T23:30:00Z')).toBe('00 h 30');
		}
	);
	it('formats full calendar labels and course times in Paris', () => {
		expect(formatTeachingDate('2026-12-31T23:30:00Z', 'full')).toBe('vendredi 1 janvier 2027');
		expect(formatTeachingTime('2026-12-31T23:30:00Z')).toBe('00 h 30');
		expect(formatTeachingTime('2026-06-30T22:30:00Z')).toBe('00 h 30');
		expect(formatTeachingTime('2026-10-25T00:30:00Z')).toBe('02 h 30');
		expect(formatTeachingTime('2026-10-25T01:30:00Z')).toBe('02 h 30');
	});
	it('bounds formatter construction when rendering a list of lessons', () => {
		const DateTimeFormat = Intl.DateTimeFormat;
		const formatter = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (...args) {
			return new DateTimeFormat(...args);
		});
		try {
			for (let day = 1; day <= 20; day++) {
				const date = `2026-05-${String(day).padStart(2, '0')}T08:30:00Z`;
				expect(formatTeachingDate(date)).toBe(`${day} mai 2026`);
				expect(formatTeachingDate(date, 'full')).toContain(`${day} mai 2026`);
				expect(formatLessonDate(date)).toContain('10:30');
				expect(formatTeachingTime(date)).toBe('10 h 30');
			}
			expect(formatter.mock.calls.length).toBeLessThanOrEqual(4);
		} finally {
			formatter.mockRestore();
		}
	});
	it('formats French dates and times in Paris across winter and summer midnight boundaries', () => {
		expect(formatTeachingDate('2026-12-31T23:30:00Z')).toBe('1 janvier 2027');
		expect(formatTeachingDate('2026-06-30T22:30:00Z')).toBe('1 juillet 2026');
		expect(formatTeachingDate('2026-12-31T23:30:00Z')).not.toMatch(/\d:\d|UTC|GMT/);
		expect(formatLessonDate('2026-12-31T23:30:00Z')).toContain('1 janv. 2027');
		expect(formatLessonDate('2026-12-31T23:30:00Z')).toContain('00:30');
		expect(formatLessonDate('2026-06-30T22:30:00Z')).toContain('1 juil. 2026');
		expect(formatLessonDate('2026-06-30T22:30:00Z')).toContain('00:30');
	});
	it('accepts exact supported calendar months and rejects malformed or out-of-range input', () => {
		for (const value of ['0001-01', '2026-12', '9999-12']) expect(validTeachingMonth(value)).toBe(value);
		for (const value of [
			null,
			undefined,
			'',
			'0000-01',
			'10000-01',
			'2026-00',
			'2026-13',
			'2026-1',
			' 2026-01',
			'2026-01-01'
		])
			expect(validTeachingMonth(value)).toBeUndefined();
	});
	it('keeps requested Paris month boundaries independent of UTC year boundaries', () => {
		const month = teachingCalendarMonth(new Date('2026-10-29T12:00:00Z'), '2027-01');
		expect(month.month).toBe('2027-01');
		expect(month.startsAt.toISOString()).toBe('2026-12-31T23:00:00.000Z');
		expect(month.endsAt.toISOString()).toBe('2027-01-31T23:00:00.000Z');
		expect(teachingCalendarMonth(new Date('2026-12-31T23:30:00Z'), 'invalid').month).toBe('2027-01');
	});
	it.each([
		['2026-02', '2026-01-31T23:00:00.000Z', '2026-02-28T23:00:00.000Z'],
		['2028-02', '2028-01-31T23:00:00.000Z', '2028-02-29T23:00:00.000Z'],
		['2026-03', '2026-02-28T23:00:00.000Z', '2026-03-31T22:00:00.000Z']
	])('uses the exact Paris boundaries of %s', (requested, startsAt, endsAt) => {
		const month = teachingCalendarMonth(new Date('2026-10-29T12:00:00Z'), requested);
		expect(month.month).toBe(requested);
		expect(month.startsAt.toISOString()).toBe(startsAt);
		expect(month.endsAt.toISOString()).toBe(endsAt);
	});
	it('includes the last day of the highest supported calendar year', () => {
		const month = teachingCalendarMonth(new Date('2026-10-29T12:00:00Z'), '9999-12');
		expect(month.startsAt.toISOString()).toBe('9999-11-30T23:00:00.000Z');
		expect(month.endsAt.toISOString()).toBe('9999-12-31T23:00:00.000Z');
		expect(
			lessonDatesInMonth(month, [
				{
					startsAt: new Date('9999-12-31T10:00:00Z'),
					endsAt: new Date('9999-12-31T12:00:00Z')
				}
			])
		).toEqual(['9999-12-31']);
	});
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
	it('marks every day of a multi-day lesson and sorts lessons chronologically', () => {
		const month = teachingMonth(new Date('2026-10-14T12:00:00Z'));
		expect(
			lessonDatesInMonth(month, [
				{
					startsAt: new Date('2026-10-20T07:00:00Z'),
					endsAt: new Date('2026-10-20T10:00:00Z')
				},
				{
					startsAt: new Date('2026-10-15T07:00:00Z'),
					endsAt: new Date('2026-10-17T10:00:00Z')
				}
			])
		).toEqual(['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-20']);
	});
});
