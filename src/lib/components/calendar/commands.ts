import { z } from 'zod';
import { calendarSettingsSchema, type CalendarCommand } from '#lib/domain/calendar-subscription.js';

export class CalendarCommandError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

export type CalendarSettingsCommand = Exclude<CalendarCommand, { action: 'sync' }> | { action: 'sync'; manual: true };
const errorSchema = z.object({ message: z.string() });
const dailyReceiptSchema = z.object({ changed: z.boolean() });
const failureMessage = 'Le calendrier n’a pas pu être actualisé. Réessayez.';

const requestCalendar = async <T>(command: CalendarCommand, decode: (payload: unknown) => T): Promise<T> => {
	const response = await fetch('/api/teaching/calendar', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(command)
	});
	let result: unknown;
	try {
		result = await response.json();
	} catch {
		throw new CalendarCommandError(failureMessage, response.status);
	}
	if (!response.ok) {
		const error = errorSchema.safeParse(result);
		throw new CalendarCommandError(error.success ? error.data.message : failureMessage, response.status);
	}
	try {
		return decode(result);
	} catch {
		throw new CalendarCommandError(failureMessage, response.status);
	}
};

export const sendCalendarCommand = (command: CalendarSettingsCommand) =>
	requestCalendar(command, calendarSettingsSchema.parse);
export const checkDailyCalendar = () => requestCalendar({ action: 'sync', manual: false }, dailyReceiptSchema.parse);
