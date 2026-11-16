import ICAL from 'ical.js';
import { fromDateInput } from '../../teaching/calendar.js';
import type { CalendarOccurrence } from '../../domain/calendar-subscription.js';

const MAX_BYTES = 512 * 1024;
const MAX_EVENTS = 200;
const MAX_ITERATIONS = 1000;
const MAX_TIME_VALUES = 1000;
const TIME_PROPERTIES = ['dtstart', 'dtend', 'recurrence-id', 'rdate', 'exdate'];
const DAY = 86_400_000;
export class CalendarFeedError extends Error {
	constructor(kind: 'unsupported' | 'size' | 'network' | 'timeout' | 'http' | 'redirect', status?: number) {
		const messages = {
			unsupported: 'Le fichier reçu n’est pas un calendrier iCalendar compatible. Aucune séance n’a été modifiée.',
			size: 'Le calendrier dépasse la limite de lecture de 512 Ko. Aucune séance n’a été modifiée.',
			network:
				'Calendrier indisponible : le téléchargement a échoué. Réessayez dans un instant. Aucune séance n’a été modifiée.',
			timeout:
				'Le calendrier n’a pas répondu dans les 10 secondes. Réessayez dans un instant. Aucune séance n’a été modifiée.',
			redirect:
				'Le lien d’abonnement redirige vers une autre adresse. Utilisez le lien iCalendar direct fourni par l’école. Aucune séance n’a été modifiée.',
			http:
				status === 401 || status === 403 || status === 404
					? `Pronote Campus a refusé le téléchargement (HTTP ${status}). Recopiez le lien d’abonnement complet depuis l’école. Aucune séance n’a été modifiée.`
					: `Pronote Campus n’a pas fourni le calendrier (HTTP ${status}). Réessayez plus tard. Aucune séance n’a été modifiée.`
		};
		super(messages[kind]);
		this.name = 'CalendarFeedError';
	}
}
const invalidFeed = () => new CalendarFeedError('unsupported');
type Component = InstanceType<typeof ICAL.Component>;
type Time = InstanceType<typeof ICAL.Time>;
type Event = InstanceType<typeof ICAL.Event>;

export const validateCalendarUrl = (value: string): string => {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('Renseignez un lien HTTPS de calendrier Pronote Campus.');
	}
	if (
		url.protocol !== 'https:' ||
		!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+pronote-campus\.net$/.test(url.hostname) ||
		url.username ||
		url.password ||
		url.port ||
		url.hash ||
		!/^\/hp\/Telechargements\/ical\/[A-Za-z0-9_.-]+\.ics$/.test(url.pathname) ||
		value.length > 4096
	)
		throw new Error('Renseignez un lien HTTPS de calendrier Pronote Campus, sans identifiant ni fragment.');
	return url.toString();
};

const timeZone = (component: Component, propertyName: string): string => {
	const property = component.getFirstProperty(propertyName);
	if (!property) throw invalidFeed();
	const zone = property.getParameter('tzid');
	if (zone && zone !== 'Europe/Paris') throw invalidFeed();
	return zone === 'Europe/Paris' ? zone : 'UTC';
};

const instant = (time: Time, zone: string): string => {
	if (!time || time.isDate) throw invalidFeed();
	const text = time.toString();
	if (zone === 'Europe/Paris') {
		if (text.endsWith('Z')) throw invalidFeed();
		return fromDateInput(text);
	}
	if (time.zone.tzid !== 'UTC' || !text.endsWith('Z')) throw invalidFeed();
	const date = new Date(text);
	if (!Number.isFinite(date.getTime()) || date.toISOString().replace('.000', '') !== text) throw invalidFeed();
	return date.toISOString();
};

const validateRawRules = (text: string) => {
	let eventDepth = 0;
	const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
	if (lines.length > 5000) throw invalidFeed();
	for (const rawLine of lines) {
		const line = rawLine.toUpperCase();
		if (line === 'BEGIN:VEVENT') eventDepth++;
		if (line === 'END:VEVENT') eventDepth--;
		if (eventDepth < 0 || eventDepth > 1) throw invalidFeed();
		if (!eventDepth || !/^RRULE[:;]/.test(line)) continue;
		if (!line.startsWith('RRULE:')) throw invalidFeed();
		// Restrict expansion to simple school timetables; arbitrary BY* combinations can be costly.
		const parts = line.slice(6).split(';');
		const names = new Set<string>();
		const weekly = parts.includes('FREQ=WEEKLY');
		for (const part of parts) {
			const [name, value, extra] = part.split('=');
			if (extra !== undefined || names.has(name)) throw invalidFeed();
			names.add(name);
			if (name === 'FREQ' && ['DAILY', 'WEEKLY'].includes(value)) continue;
			if (['COUNT', 'INTERVAL'].includes(name) && /^\d{1,4}$/.test(value) && Number(value) > 0 && Number(value) <= 1000)
				continue;
			if (name === 'UNTIL' && /^\d{8}T\d{6}Z$/.test(value)) {
				const date = value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z');
				if (new Date(date).toISOString().replace('.000', '') !== date) throw invalidFeed();
				continue;
			}
			if (name === 'WKST' && /^(MO|TU|WE|TH|FR|SA|SU)$/.test(value)) continue;
			if (name === 'BYDAY' && weekly && /^(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU))*$/.test(value)) continue;
			throw invalidFeed();
		}
		if (!names.has('FREQ')) throw invalidFeed();
		if (names.has('COUNT') && names.has('UNTIL')) throw invalidFeed();
	}
	if (eventDepth !== 0) throw invalidFeed();
};

const validateEvent = (component: Component, toInstant: typeof instant): Event => {
	for (const name of TIME_PROPERTIES) {
		for (const property of component.getAllProperties(name)) {
			const values: unknown[] = property.jCal.slice(3);
			for (const value of values) {
				if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z?$/.test(value)) throw invalidFeed();
				if (property.getParameter('tzid') && value.endsWith('Z')) throw invalidFeed();
				const utcValue = value.endsWith('Z') ? value : `${value}Z`;
				if (new Date(utcValue).toISOString().replace('.000', '') !== utcValue) throw invalidFeed();
			}
		}
	}
	for (const name of ['uid', 'summary', 'dtstart', 'dtend', 'recurrence-id']) {
		if (component.getAllProperties(name).length > 1) throw invalidFeed();
	}
	const event = new ICAL.Event(component, { exceptions: [], strictExceptions: true });
	if (
		!event.uid ||
		event.uid.length > 512 ||
		!event.summary?.trim() ||
		event.summary.trim().length > 200 ||
		component.hasProperty('duration')
	)
		throw invalidFeed();
	const start = toInstant(event.startDate, timeZone(component, 'dtstart'));
	const end = toInstant(event.endDate, timeZone(component, 'dtend'));
	if (end <= start || new Date(end).getTime() - new Date(start).getTime() > 7 * DAY) throw invalidFeed();
	for (const name of ['rdate', 'exdate', 'recurrence-id']) {
		for (const property of component.getAllProperties(name)) {
			if (property.getParameter('range')) throw invalidFeed();
			for (const value of property.getValues()) {
				if (!(value instanceof ICAL.Time)) throw invalidFeed();
				toInstant(value, timeZone(component, name));
			}
		}
	}
	const rules = component.getAllProperties('rrule');
	if (rules.length > 1 || component.hasProperty('exrule')) throw invalidFeed();
	if (rules.some((rule) => !(rule.getFirstValue() instanceof ICAL.Recur))) throw invalidFeed();
	return event;
};

const isAllDayEvent = (component: Component): boolean => {
	const start = component.getFirstProperty('dtstart');
	const end = component.getFirstProperty('dtend');
	if (start?.type !== 'date' && end?.type !== 'date') return false;
	for (const name of ['dtstart', 'dtend']) {
		const properties = component.getAllProperties(name);
		const property = properties[0];
		const value: unknown = property?.jCal[3];
		if (
			properties.length !== 1 ||
			property.type !== 'date' ||
			property.getParameter('tzid') ||
			typeof value !== 'string' ||
			!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) ||
			new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
		)
			throw invalidFeed();
	}
	if (String(end!.jCal[3]) <= String(start!.jCal[3])) throw invalidFeed();
	return true;
};

export const parseCalendarFeed = (text: string, now = new Date()): CalendarOccurrence[] => {
	try {
		if (
			new TextEncoder().encode(text).byteLength > MAX_BYTES ||
			(text.match(/^BEGIN:/gm)?.length ?? 0) > 500 ||
			!text.startsWith('BEGIN:VCALENDAR')
		)
			throw invalidFeed();
		// ICAL normalizes some invalid recurrence values; validate their original spelling first.
		validateRawRules(text);
		const root = ICAL.Component.fromString(text);
		if (root.name !== 'vcalendar' || root.getFirstPropertyValue('version') !== '2.0') throw invalidFeed();
		const components = root.getAllSubcomponents('vevent');
		if (
			components.length > 400 ||
			root.getAllSubcomponents().some((item) => !['vevent', 'vtimezone'].includes(item.name))
		)
			throw invalidFeed();
		const dateValueCount = components.reduce(
			(total, component) =>
				total +
				TIME_PROPERTIES.reduce(
					(count, name) =>
						count + component.getAllProperties(name).reduce((values, property) => values + property.jCal.length - 3, 0),
					0
				),
			0
		);
		if (dateValueCount > MAX_TIME_VALUES) throw invalidFeed();
		// Paris uses the same authoritative timezone rules as manual planning, not feed-supplied rules.
		root.removeAllSubcomponents('vtimezone');
		const convertedTimes = new Map<string, string>();
		const toInstant: typeof instant = (time, zone) => {
			const key = `${zone}:${time.toString()}`;
			const cached = convertedTimes.get(key);
			if (cached) return cached;
			const value = instant(time, zone);
			convertedTimes.set(key, value);
			return value;
		};
		const allDayUids = new Set<string>();
		const timedComponents = components.filter((component) => {
			if (!isAllDayEvent(component)) return true;
			allDayUids.add(String(component.getFirstPropertyValue('uid')));
			return false;
		});
		const events = timedComponents.map((component) => validateEvent(component, toInstant));
		if (events.some((event) => allDayUids.has(event.uid))) throw invalidFeed();
		const byUid = new Map<string, Event[]>();
		for (const event of events) byUid.set(event.uid, [...(byUid.get(event.uid) ?? []), event]);
		const result: CalendarOccurrence[] = [];
		const seen = new Set<string>();
		let iterations = 0;
		const min = now.getTime() - 30 * DAY;
		const max = now.getTime() + 365 * DAY;
		const append = (event: Event, startTime: Time, endTime: Time, occurrence?: Time, base?: Event) => {
			const startsAt = toInstant(startTime, timeZone(event.component, 'dtstart'));
			const endsAt = toInstant(endTime, timeZone(event.component, 'dtend'));
			if (endsAt <= startsAt) throw invalidFeed();
			if (base === event) {
				const duration =
					Date.parse(toInstant(base.endDate, timeZone(base.component, 'dtend'))) -
					Date.parse(toInstant(base.startDate, timeZone(base.component, 'dtstart')));
				if (Date.parse(endsAt) - Date.parse(startsAt) !== duration) throw invalidFeed();
			}
			if (new Date(endsAt).getTime() < min || new Date(startsAt).getTime() > max) return;
			const identity = occurrence && base ? toInstant(occurrence, timeZone(base.component, 'dtstart')) : 'single';
			const key = JSON.stringify([event.uid, identity]);
			if (seen.has(key) || result.length >= MAX_EVENTS) throw invalidFeed();
			seen.add(key);
			result.push({
				key,
				course: (base ?? event).summary.trim(),
				title: event.summary.trim(),
				startsAt,
				endsAt,
				cancelled: event.component.getFirstPropertyValue('status') === 'CANCELLED'
			});
		};
		for (const related of byUid.values()) {
			const masters = related.filter((event) => !event.isRecurrenceException());
			if (masters.length !== 1) throw invalidFeed();
			const master = masters[0];
			const exceptions = related.filter((event) => event.isRecurrenceException());
			const exceptionKeys = new Set<string>();
			for (const exception of exceptions) {
				if (timeZone(exception.component, 'recurrence-id') !== timeZone(master.component, 'dtstart'))
					throw invalidFeed();
				const key = toInstant(exception.recurrenceId, timeZone(exception.component, 'recurrence-id'));
				if (exceptionKeys.has(key) || !master.isRecurring()) throw invalidFeed();
				exceptionKeys.add(key);
				master.relateException(exception);
			}
			if (!master.isRecurring()) {
				append(master, master.startDate, master.endDate);
				continue;
			}
			const expansion = master.iterator();
			let occurrence: Time | null;
			while ((occurrence = expansion.next())) {
				if (++iterations > MAX_ITERATIONS) throw invalidFeed();
				if (new Date(toInstant(occurrence, timeZone(master.component, 'dtstart'))).getTime() > max) break;
				const detail = master.getOccurrenceDetails(occurrence);
				append(detail.item, detail.startDate, detail.endDate, occurrence, master);
			}
			for (const exception of exceptions) {
				const identity = toInstant(exception.recurrenceId, timeZone(master.component, 'dtstart'));
				if (!seen.has(JSON.stringify([exception.uid, identity]))) {
					append(exception, exception.startDate, exception.endDate, exception.recurrenceId, master);
				}
			}
		}
		return result.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.key.localeCompare(b.key));
	} catch {
		throw invalidFeed();
	}
};

const readFeed = async (response: Response): Promise<string> => {
	if ([301, 302, 303, 307, 308].includes(response.status)) {
		await response.body?.cancel();
		throw new CalendarFeedError('redirect');
	}
	if (!response.ok) throw new CalendarFeedError('http', response.status);
	if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new CalendarFeedError('size');
	if (!response.body) throw invalidFeed();
	const reader = response.body.getReader();
	const decoder = new TextDecoder('utf-8', { fatal: true });
	let bytes = 0;
	let text = '';
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > MAX_BYTES) {
				await reader.cancel();
				throw new CalendarFeedError('size');
			}
			text += decoder.decode(chunk.value, { stream: true });
		}
		return text + decoder.decode();
	} finally {
		reader.releaseLock();
	}
};

export const fetchCalendarFeed = async (
	url: string,
	now = new Date(),
	fetcher: typeof fetch = fetch
): Promise<CalendarOccurrence[]> => {
	const source = validateCalendarUrl(url);
	try {
		const response = await fetcher(source, {
			redirect: 'manual',
			cache: 'no-store',
			credentials: 'omit',
			headers: { Accept: 'text/calendar' },
			signal: AbortSignal.timeout(10_000)
		});
		return parseCalendarFeed(await readFeed(response), now);
	} catch (cause) {
		if (cause instanceof CalendarFeedError) throw cause;
		throw new CalendarFeedError(cause instanceof Error && cause.name === 'TimeoutError' ? 'timeout' : 'network');
	}
};
