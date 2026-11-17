import { describe, expect, it, vi } from 'vitest';
import { fetchCalendarFeed, parseCalendarFeed, validateCalendarUrl } from './feed.js';

const now = new Date('2026-10-31T12:00:00Z');
const event = (extra = '', uid = 'web-1') =>
	`BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:Web development\r\nDTSTART:20261102T080000Z\r\nDTEND:20261102T100000Z\r\n${extra}END:VEVENT`;
const calendar = (...events: string[]) =>
	`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Campus tests//EN\r\n${events.join('\r\n')}\r\nEND:VCALENDAR`;
const source = 'https://fictional.pronote-campus.net/hp/Telechargements/ical/teacher.ics?icalsecurise=fake';

describe('school calendar parsing', () => {
	const allDay = (start = '20261101', end = '20261102', uid = 'school-day') =>
		`BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:School closure\r\nDTSTART;VALUE=DATE:${start}\r\nDTEND;VALUE=DATE:${end}\r\nEND:VEVENT`;
	it('imports timed lessons from a Pronote calendar containing all-day entries without inventing midnight lessons', () => {
		expect(parseCalendarFeed(calendar(allDay(), event()), now)).toEqual(parseCalendarFeed(calendar(event()), now));
	});
	it('returns no lessons for a calendar containing only all-day entries', () => {
		expect(parseCalendarFeed(calendar(allDay()), now)).toEqual([]);
	});
	it.each([
		allDay('20260230', '20260301'),
		allDay('20261102', '20261101'),
		allDay().replace('DTEND;VALUE=DATE:20261102', 'DTEND:20261102T100000Z'),
		allDay().replace('DTSTART;VALUE=DATE:', 'DTSTART;VALUE=DATE;TZID=Europe/Paris:')
	])('still rejects malformed or mixed all-day boundaries', (entry) => {
		expect(() => parseCalendarFeed(calendar(event(), entry), now)).toThrow();
	});
	it('rejects conflicting all-day and timed identities instead of dropping a lesson exception', () => {
		expect(() => parseCalendarFeed(calendar(event(), allDay('20261101', '20261102', 'web-1')), now)).toThrow();
	});

	it('reads only scheduling data, including unfolded course names', () => {
		const feed = calendar(
			event('DESCRIPTION:Never import this private text\r\n').replace('Web development', 'Web develop\r\n ment')
		);
		expect(parseCalendarFeed(feed, now)).toEqual([
			{
				key: JSON.stringify(['web-1', 'single']),
				course: 'Web development',
				title: 'Web development',
				startsAt: '2026-11-02T08:00:00.000Z',
				endsAt: '2026-11-02T10:00:00.000Z',
				cancelled: false
			}
		]);
	});
	it('keeps identity when a single event moves and preserves explicit cancellation', () => {
		const original = parseCalendarFeed(calendar(event()), now)[0];
		const moved = parseCalendarFeed(calendar(event('STATUS:CANCELLED\r\n').replaceAll('20261102', '20261103')), now)[0];
		expect(moved.key).toBe(original.key);
		expect(moved.cancelled).toBe(true);
		expect(moved.startsAt).not.toBe(original.startsAt);
	});
	it('expands weekly occurrences and uses the original occurrence identity after a move', () => {
		const base = event('RRULE:FREQ=WEEKLY;COUNT=3\r\n');
		const exception = event('RECURRENCE-ID:20261109T080000Z\r\n')
			.replaceAll('DTSTART:20261102', 'DTSTART:20261110')
			.replaceAll('DTEND:20261102', 'DTEND:20261110');
		const result = parseCalendarFeed(calendar(base, exception), now);
		expect(result).toHaveLength(3);
		expect(result.find((item) => item.startsAt.startsWith('2026-11-10'))?.key).toBe(
			JSON.stringify(['web-1', '2026-11-09T08:00:00.000Z'])
		);
	});
	it('honors excluded dates and explicit recurrence cancellation', () => {
		const base = event('RRULE:FREQ=WEEKLY;COUNT=3\r\nEXDATE:20261109T080000Z\r\n');
		const cancelled = event('RECURRENCE-ID:20261116T080000Z\r\nSTATUS:CANCELLED\r\n').replaceAll(
			'20261102',
			'20261116'
		);
		const result = parseCalendarFeed(calendar(base, cancelled), now);
		expect(result).toHaveLength(2);
		expect(result[1].cancelled).toBe(true);
	});
	it('retains an explicit cancellation even when its occurrence is also excluded from the series', () => {
		const base = event('RRULE:FREQ=WEEKLY;COUNT=2\r\nEXDATE:20261109T080000Z\r\n');
		const cancelled = event('RECURRENCE-ID:20261109T080000Z\r\nSTATUS:CANCELLED\r\n').replaceAll(
			'20261102',
			'20261109'
		);
		const result = parseCalendarFeed(calendar(base, cancelled), now);
		expect(result).toHaveLength(2);
		expect(result[1].cancelled).toBe(true);
	});
	it.each([
		'<html>not a calendar</html>',
		calendar(event(), event()),
		calendar(event().replace('20261102T080000Z', '20261102T120000Z')),
		calendar(event().replaceAll('20261102', '20261131')),
		calendar(event().replace('20261102T080000Z', '20261102T250000Z')),
		calendar(event().replaceAll('20261102T080000Z', '20261102T080000')),
		calendar(event().replace('DTSTART:', 'DTSTART;TZID=Unknown/Place:').replace('20261102T080000Z', '20261102T080000')),
		calendar(event('RRULE:FREQ=SECONDLY\r\n')),
		calendar(event('RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30\r\n')),
		calendar(event('RRULE:FREQ=DAILY;UNTIL=20261131T000000Z\r\n')),
		calendar(event('RRULE:FREQ=DAILY;UNTIL=20261130T250000Z\r\n')),
		calendar(event('RRULE:FREQ=DAILY;COUNT=1.5\r\n')),
		calendar(event('RRULE:FREQ=DAILY;INTERVAL=-1\r\n')),
		calendar(event(event('', 'nested'))),
		calendar(event('RECURRENCE-ID;RANGE=THISANDFUTURE:20261102T080000Z\r\n')),
		calendar(event().replace('SUMMARY:Web development', 'SUMMARY:')),
		'x'.repeat(512 * 1024 + 1)
	])('rejects ambiguous, invalid or unsupported input without producing partial lessons', (feed) => {
		expect(() => parseCalendarFeed(feed, now)).toThrow();
	});
	it('bounds import size rather than silently truncating lessons', () => {
		expect(() =>
			parseCalendarFeed(calendar(...Array.from({ length: 201 }, (_, i) => event('', `uid-${i}`))), now)
		).toThrow();
	});
	it.each(['DTSTART:', 'DTEND:'])('rejects a contradictory UTC marker combined with TZID on %s', (property) => {
		const feed = calendar(event().replace(property, `${property.slice(0, -1)};TZID=Europe/Paris:`));
		expect(() => parseCalendarFeed(feed, now)).toThrow();
	});
	it('rejects excessive date values before performing timezone conversions', () => {
		const exclusions = Array.from({ length: 1500 }, () => '20261109T080000Z').join(',');
		expect(() => parseCalendarFeed(calendar(event(`EXDATE:${exclusions}\r\n`)), now)).toThrow();
	});
	it('ignores old and distant events without changing their dates', () => {
		expect(parseCalendarFeed(calendar(event().replaceAll('20261102', '20250101')), now)).toEqual([]);
	});
	it('uses Paris wall time across a daylight-saving change', () => {
		const feed = calendar(
			event('RRULE:FREQ=WEEKLY;COUNT=3\r\n')
				.replace('DTSTART:20261102T080000Z', 'DTSTART;TZID=Europe/Paris:20261019T090000')
				.replace('DTEND:20261102T100000Z', 'DTEND;TZID=Europe/Paris:20261019T110000')
		);
		const parsed = parseCalendarFeed(feed, new Date('2026-10-01T12:00:00Z'));
		expect(parsed.map((item) => item.startsAt)).toEqual([
			'2026-10-19T07:00:00.000Z',
			'2026-10-26T08:00:00.000Z',
			'2026-11-02T08:00:00.000Z'
		]);
	});
	it('refuses ambiguous or nonexistent Paris local times instead of shifting them', () => {
		for (const date of ['20261025T023000', '20260329T023000']) {
			const feed = calendar(
				event()
					.replace('DTSTART:20261102T080000Z', `DTSTART;TZID=Europe/Paris:${date}`)
					.replace('DTEND:20261102T100000Z', `DTEND;TZID=Europe/Paris:${date.replace('023000', '043000')}`)
			);
			expect(() => parseCalendarFeed(feed, now)).toThrow();
		}
	});
	it('refuses an implicit recurring duration change across daylight saving', () => {
		const feed = calendar(
			event('RRULE:FREQ=WEEKLY;COUNT=2\r\n')
				.replace('DTSTART:20261102T080000Z', 'DTSTART;TZID=Europe/Paris:20261018T013000')
				.replace('DTEND:20261102T100000Z', 'DTEND;TZID=Europe/Paris:20261018T033000')
		);
		expect(() => parseCalendarFeed(feed, new Date('2026-10-01T12:00:00Z'))).toThrow();
	});
});

describe('private calendar downloads', () => {
	it.each([
		'http://fictional.pronote-campus.net/hp/Telechargements/ical/teacher.ics',
		'https://pronote-campus.net.evil.test/hp/Telechargements/ical/teacher.ics',
		'https://127.0.0.1/hp/Telechargements/ical/teacher.ics',
		'https://user:password@fictional.pronote-campus.net/hp/Telechargements/ical/teacher.ics',
		'https://fictional.pronote-campus.net:8443/hp/Telechargements/ical/teacher.ics',
		'https://fictional.pronote-campus.net/hp/Telechargements/ical/teacher.ics#fragment',
		'https://fictional.pronote-campus.net/another-file'
	])('refuses unsupported destinations before issuing a request', async (url) => {
		const fetcher = vi.fn<typeof fetch>();
		await expect(fetchCalendarFeed(url, now, fetcher)).rejects.toThrow();
		expect(fetcher).not.toHaveBeenCalled();
	});
	it('validates supported destinations, prevents redirects and requests no caching', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response(calendar(event()), { headers: { 'content-type': 'text/calendar' } }));
		expect(validateCalendarUrl(source)).toBe(source);
		expect(await fetchCalendarFeed(source, now, fetcher)).toHaveLength(1);
		expect(fetcher.mock.calls[0][1]).toMatchObject({
			redirect: 'manual',
			cache: 'no-store',
			credentials: 'omit'
		});
	});
	it.each([301, 302, 303, 307, 308])('refuses HTTP %s without following or exposing the redirect', async (status) => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(null, {
				status,
				headers: { location: 'https://untrusted.example/?icalsecurise=private' }
			})
		);
		await expect(fetchCalendarFeed(source, now, fetcher)).rejects.toThrow('redirige');
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
	it('does not expose URL credentials in errors', async () => {
		const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(`Network failure: ${source}`));
		await expect(fetchCalendarFeed(source, now, fetcher)).rejects.toThrow('Calendrier indisponible');
	});
	it.each([401, 403, 404, 503])(
		'identifies HTTP %s without exposing the private URL or response body',
		async (status) => {
			const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(source, { status }));
			await expect(fetchCalendarFeed(source, now, fetcher)).rejects.toThrow(`HTTP ${status}`);
			await expect(fetchCalendarFeed(source, now, fetcher)).rejects.not.toThrow('icalsecurise');
		}
	);
	it('distinguishes a timeout from an incompatible calendar without exposing raw errors', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new DOMException(source, 'TimeoutError'))
			.mockResolvedValueOnce(new Response('<html>provider response</html>'));
		await expect(fetchCalendarFeed(source, now, fetcher)).rejects.toThrow('10 secondes');
		await expect(fetchCalendarFeed(source, now, fetcher)).rejects.toThrow('iCalendar compatible');
	});
	it.each([true, false])('explains a size limit with or without Content-Length (%s)', async (withHeader) => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			new Response('x'.repeat(512 * 1024 + 1), {
				headers: withHeader ? { 'content-length': String(512 * 1024 + 1) } : {}
			})
		);
		await expect(fetchCalendarFeed(source, now, fetcher)).rejects.toThrow('512 Ko');
	});
	it('rejects HTTP failures and oversized streamed bodies', async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response('missing', { status: 404 }))
			.mockResolvedValueOnce(new Response('x'.repeat(512 * 1024 + 1)));
		await expect(fetchCalendarFeed(source, now, fetcher)).rejects.toThrow();
		await expect(fetchCalendarFeed(source, now, fetcher)).rejects.toThrow();
	});
});
