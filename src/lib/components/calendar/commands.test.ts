import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarSettings } from '#lib/domain/calendar-subscription.js';
import { CalendarCommandError, checkDailyCalendar, sendCalendarCommand } from './commands.js';

const settings = {
	connection: null,
	contexts: [],
	issues: []
} satisfies CalendarSettings;

const respond = (body: unknown, status = 200) => {
	const fetch = vi.fn().mockResolvedValue(Response.json(body, { status }));
	vi.stubGlobal('fetch', fetch);
	return fetch;
};

afterEach(() => vi.unstubAllGlobals());

describe('calendar command responses', () => {
	it('validates settings before replacing the current calendar', async () => {
		respond(settings);
		await expect(sendCalendarCommand({ action: 'disconnect', revision: 1 })).resolves.toEqual(settings);
	});

	it('decodes the daily synchronization receipt independently from settings', async () => {
		const fetch = respond({ changed: false });
		await expect(checkDailyCalendar()).resolves.toEqual({ changed: false });
		expect(fetch).toHaveBeenCalledWith('/api/teaching/calendar', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'sync', manual: false })
		});
	});

	it.each([null, {}, [], { ...settings, contexts: null }, { ...settings, connection: { active: true } }])(
		'rejects invalid settings without returning a typed success: %j',
		async (body) => {
			respond(body);
			await expect(
				sendCalendarCommand({ action: 'preview', url: 'https://calendar.example.test' })
			).rejects.toBeInstanceOf(CalendarCommandError);
		}
	);

	it.each([null, settings, { changed: 'false' }])('rejects an invalid daily receipt: %j', async (body) => {
		respond(body);
		await expect(checkDailyCalendar()).rejects.toMatchObject({ status: 200 });
	});

	it('preserves a valid server refusal and its status', async () => {
		respond({ message: 'Association à revoir.' }, 409);
		await expect(checkDailyCalendar()).rejects.toMatchObject({ status: 409, message: 'Association à revoir.' });
	});

	it.each([null, { message: 42 }])('uses a safe message for an invalid error envelope: %j', async (body) => {
		respond(body, 500);
		await expect(checkDailyCalendar()).rejects.toMatchObject({
			status: 500,
			message: 'Le calendrier n’a pas pu être actualisé. Réessayez.'
		});
	});

	it('keeps the response status when JSON is unavailable', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{broken', { status: 502 })));
		await expect(checkDailyCalendar()).rejects.toMatchObject({ status: 502 });
	});
});
