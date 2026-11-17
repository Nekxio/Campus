import { error, isHttpError } from '@sveltejs/kit';
import { and, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { calendarSubscriptions as sources, calendarMappings as mappings, calendarLessons } from '../db/schema.js';
import {
	calendarCommandSchema,
	type CalendarCommand,
	type CalendarOccurrence,
	type CalendarSettings
} from '../../domain/calendar-subscription.js';
import { CalendarFeedError, fetchCalendarFeed, validateCalendarUrl } from './feed.js';
import { getCalendarSettings, subscription } from './state.js';
import { applyCalendarEvents, availableCalendarContexts } from './apply.js';
export { getCalendarSettings } from './state.js';
const conflict = (): never => error(409, 'La connexion a changé. Actualisez Applications avant de réessayer.');
const parisDay = (date: Date) =>
	new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Paris',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(date);
interface Dependencies {
	now?: Date;
	loadFeed?: (url: string, now: Date) => Promise<CalendarOccurrence[]>;
}
export const syncCalendarIfDue = async (
	db: Database,
	teacherId: string,
	manual: boolean,
	now: Date = new Date(),
	loadFeed: NonNullable<Dependencies['loadFeed']> = fetchCalendarFeed
) => {
	const token = crypto.randomUUID();
	const claimed = await db
		.update(sources)
		.set({
			leaseToken: token,
			leaseUntil: new Date(now.getTime() + 60000),
			lastAttempt: now,
			attemptDay: parisDay(now)
		})
		.where(
			and(
				eq(sources.teacherId, teacherId),
				eq(sources.active, true),
				or(isNull(sources.leaseUntil), lt(sources.leaseUntil, now)),
				manual
					? or(isNull(sources.lastAttempt), lt(sources.lastAttempt, new Date(now.getTime() - 60000)))
					: or(isNull(sources.attemptDay), ne(sources.attemptDay, parisDay(now)))
			)
		)
		.returning();
	if (!claimed.length) {
		if (manual && (await subscription(db, teacherId))?.active)
			error(429, 'Une actualisation vient d’être demandée. Patientez une minute avant de réessayer.');
		return false;
	}
	const source = claimed[0];
	try {
		const events = await loadFeed(source.url, now);
		return await db.transaction(async (tx) => {
			const current = await subscription(tx, teacherId);
			if (!current?.active || current.leaseToken !== token || current.revision !== source.revision) return false;
			const bindings = await tx
				.select()
				.from(mappings)
				.where(
					and(eq(mappings.teacherId, teacherId), eq(mappings.generation, source.generation), eq(mappings.active, true))
				);
			const changed = await applyCalendarEvents(tx, bindings, events, now);
			await tx
				.update(sources)
				.set({ lastSuccess: now, error: '', leaseUntil: null, leaseToken: null })
				.where(and(eq(sources.teacherId, teacherId), eq(sources.leaseToken, token)));
			return changed;
		});
	} catch (cause) {
		// Provider errors can contain the private subscription URL. Never persist them.
		const message =
			isHttpError(cause) && cause.status === 409
				? cause.body.message
				: 'Actualisation impossible. Les dernières séances sont conservées. Vérifiez le flux ou réessayez.';
		await db
			.update(sources)
			.set({ error: message, leaseUntil: null, leaseToken: null })
			.where(and(eq(sources.teacherId, teacherId), eq(sources.leaseToken, token)));
		return false;
	}
};
export const calendarCommand = async (
	db: Database,
	teacherId: string,
	raw: CalendarCommand,
	dependencies: Dependencies = {}
): Promise<CalendarSettings> => {
	const parsed = calendarCommandSchema.safeParse(raw);
	if (!parsed.success) error(422, 'Vérifiez les réglages du calendrier.');
	const input = parsed.data;
	const now = dependencies.now ?? new Date();
	const loadFeed = dependencies.loadFeed ?? fetchCalendarFeed;
	let changed = false;
	if (input.action === 'sync') changed = await syncCalendarIfDue(db, teacherId, input.manual, now, loadFeed);
	if (input.action === 'preview') {
		let url: string;
		try {
			url = validateCalendarUrl(input.url);
		} catch {
			error(422, 'Renseignez un lien iCalendar HTTPS de Pronote Campus, sans identifiant ni fragment.');
		}
		const before = await subscription(db, teacherId);
		if (before?.active)
			error(409, 'Déconnectez le calendrier avant de modifier ses associations. Les séances seront conservées.');
		if (before?.lastAttempt && now.getTime() - before.lastAttempt.getTime() < 60000)
			error(429, 'Patientez une minute avant de charger à nouveau le calendrier.');
		// Claim before downloading: concurrent tabs cannot multiply preview requests.
		const generation = before?.url === url ? before.generation : crypto.randomUUID();
		if (before) {
			const claimed = await db
				.update(sources)
				.set({ lastAttempt: now, revision: sql`${sources.revision}+1` })
				.where(and(eq(sources.teacherId, teacherId), eq(sources.revision, before.revision)))
				.returning();
			if (!claimed.length) conflict();
		} else await db.insert(sources).values({ teacherId, generation, url, lastAttempt: now });
		let events: CalendarOccurrence[];
		try {
			events = await loadFeed(url, now);
		} catch (cause) {
			error(
				422,
				cause instanceof CalendarFeedError
					? cause.message
					: 'Le calendrier n’a pas pu être lu. Fournissez un flux iCalendar HTTPS valide et compatible. Aucune séance n’a été modifiée.'
			);
		}
		await db.transaction(async (tx) => {
			const current = await subscription(tx, teacherId);
			if (!current || current.active || current.revision !== (before ? before.revision + 1 : 1)) conflict();
			await tx
				.update(sources)
				.set({
					url,
					generation,
					preview: events,
					previewAt: now,
					error: '',
					revision: sql`${sources.revision}+1`
				})
				.where(eq(sources.teacherId, teacherId));
		});
	}
	if (input.action === 'connect')
		await db.transaction(async (tx) => {
			const source = await subscription(tx, teacherId);
			if (
				!source ||
				source.active ||
				source.revision !== input.revision ||
				!source.previewAt ||
				now.getTime() - source.previewAt.getTime() > 30 * 60000
			)
				conflict();
			if (new Set(input.mappings.map((v) => v.course)).size !== input.mappings.length)
				error(422, 'Un cours ne peut être associé qu’une fois.');
			const existing = await tx
				.select()
				.from(mappings)
				.where(and(eq(mappings.teacherId, teacherId), eq(mappings.generation, source.generation)));
			const selected: (typeof mappings.$inferSelect)[] = [];
			const available = await availableCalendarContexts(tx);
			const adoptions = new Map<string, string>();
			const adoptedIds = new Set<string>();
			for (const item of input.mappings) {
				if (!available.some((v) => v.id === item.contextId))
					error(409, 'Cette classe ou cette année n’est plus disponible pour la synchronisation.');
				if (!source.preview.some((v) => v.course === item.course)) error(422, 'Ce cours n’est pas dans l’aperçu.');
				const previous = existing.find((v) => v.course === item.course && v.contextId === item.contextId);
				const oldContext = existing.find((v) => v.course === item.course && v.contextId !== item.contextId);
				const previousContextIsActive = oldContext && available.some((v) => v.id === oldContext.contextId);
				if (previousContextIsActive)
					error(
						409,
						'Un cours déjà importé conserve sa classe et son année. Créez une association distincte pour la nouvelle année.'
					);
				for (const adoption of item.adoptions) {
					if (
						adoptions.has(`${item.course}\n${adoption.key}`) ||
						adoptedIds.has(adoption.lessonId) ||
						!source.preview.some((v) => v.course === item.course && v.key === adoption.key)
					)
						error(422, 'Rapprochement de séance ambigu.');
					adoptions.set(`${item.course}\n${adoption.key}`, adoption.lessonId);
					adoptedIds.add(adoption.lessonId);
				}
				selected.push(
					previous
						? { ...previous, active: true }
						: {
								id: crypto.randomUUID(),
								teacherId,
								generation: source.generation,
								course: item.course,
								contextId: item.contextId,
								active: true
							}
				);
			}
			await tx
				.insert(mappings)
				.values(selected)
				.onConflictDoUpdate({ target: mappings.id, set: { active: true } });
			changed = await applyCalendarEvents(tx, selected, source.preview, now, adoptions);
			await tx
				.update(sources)
				.set({
					active: true,
					lastSuccess: now,
					attemptDay: parisDay(now),
					error: '',
					revision: sql`${sources.revision}+1`
				})
				.where(eq(sources.teacherId, teacherId));
		});
	if (input.action === 'disconnect')
		await db.transaction(async (tx) => {
			const source = await subscription(tx, teacherId);
			if (!source || source.revision !== input.revision) conflict();
			await tx
				.update(sources)
				.set({
					active: false,
					leaseToken: null,
					leaseUntil: null,
					revision: sql`${sources.revision}+1`
				})
				.where(eq(sources.teacherId, teacherId));
			const ids = tx.select({ id: mappings.id }).from(mappings).where(eq(mappings.teacherId, teacherId));
			await tx
				.update(calendarLessons)
				.set({ status: 'disconnected' })
				.where(and(sql`${calendarLessons.mappingId} IN (${ids})`, ne(calendarLessons.status, 'cancelled')));
			await tx.update(mappings).set({ active: false }).where(eq(mappings.teacherId, teacherId));
		});
	return { ...(await getCalendarSettings(db, teacherId)), changed };
};
