import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import * as t from '../db/schema.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import { editableModule } from '../../teaching/types.js';
import { getHomeData, getModule, updateModule } from '../teaching/service.js';
import { calendarCommand, getCalendarSettings } from './service.js';
import { fetchCalendarFeed } from './feed.js';
import { calendarSettingsSchema, type CalendarOccurrence } from '../../domain/calendar-subscription.js';
let client: Client;
let db: Database;
let ids: Awaited<ReturnType<typeof seedFoundationFixtures>>;
const now = new Date('2026-10-31T08:00:00Z');
const url = 'https://school.pronote-campus.net/hp/Telechargements/ical/demo.ics';
const event: CalendarOccurrence = {
	key: 'stable-uid',
	course: 'Web B2',
	title: 'Web B2',
	startsAt: '2026-11-04T08:00:00.000Z',
	endsAt: '2026-11-04T10:00:00.000Z',
	cancelled: false
};
const feed = vi.fn<() => Promise<CalendarOccurrence[]>>();
const command = (input: Parameters<typeof calendarCommand>[2], time = now) =>
	calendarCommand(db, ids.teacher, input, { now: time, loadFeed: feed });
const connect = async (adoptions: { key: string; lessonId: string }[] = []) => {
	const preview = await command({ action: 'preview', url });
	return command({
		action: 'connect',
		revision: preview.connection!.revision,
		mappings: [{ course: event.course, contextId: ids.currentContext, adoptions }]
	});
};
beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(now);
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedFoundationFixtures(db);
	feed.mockReset().mockResolvedValue([event]);
});
afterEach(() => {
	client.close();
	vi.useRealTimers();
});
describe('school calendar subscription', () => {
	it('keeps historical associations readable while identifying current and future context years', async () => {
		await db.update(t.teachingContexts).set({ archivedAt: null }).where(eq(t.teachingContexts.id, ids.oldContext));
		const futureClassId = crypto.randomUUID();
		const futureContextId = crypto.randomUUID();
		await db.insert(t.classes).values({ id: futureClassId, name: 'B2 Demo', academicYear: '2027-2028' });
		await db.insert(t.teachingContexts).values({
			id: futureContextId,
			moduleId: ids.module,
			classId: futureClassId,
			className: 'B2 Demo',
			academicYear: '2027-2028'
		});
		const preview = await command({ action: 'preview', url });
		await command({
			action: 'connect',
			revision: preview.connection!.revision,
			mappings: [{ course: event.course, contextId: ids.oldContext, adoptions: [] }]
		});
		const mappings = await db.select().from(t.calendarMappings);
		const lessons = await db.select().from(t.lessons);
		const settings = calendarSettingsSchema.parse(await getCalendarSettings(db, ids.teacher));
		expect(settings.contexts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: ids.currentContext,
					academicYear: '2026-2027',
					label: 'Demo · Application web · B2 Demo'
				}),
				expect.objectContaining({
					id: ids.oldContext,
					academicYear: '2025-2026',
					label: 'Demo · Application web · B2 Demo · 2025-2026',
					lessons: [
						expect.objectContaining({
							title: 'Demo · Preserved lesson',
							startsAt: '2025-10-13T08:00:00.000Z',
							endsAt: '2025-10-13T10:00:00.000Z'
						})
					]
				}),
				expect.objectContaining({
					id: futureContextId,
					academicYear: '2027-2028',
					label: 'Demo · Application web · B2 Demo · 2027-2028'
				})
			])
		);
		expect(settings.contexts.every((context) => Boolean(context.academicYear))).toBe(true);
		expect(settings.connection?.mappings).toEqual([{ course: event.course, contextId: ids.oldContext }]);
		const activeContextId = settings.connection!.mappings[0].contextId;
		expect(settings.contexts.find((context) => context.id === activeContextId)?.label).toBe(
			'Demo · Application web · B2 Demo · 2025-2026'
		);
		expect(await db.select().from(t.calendarMappings)).toEqual(mappings);
		expect(await db.select().from(t.lessons)).toEqual(lessons);
	});

	it('accepts settings from clients without context year metadata', async () => {
		const settings = await getCalendarSettings(db, ids.teacher);
		const legacy = {
			...settings,
			contexts: settings.contexts.map(({ id, label, lessons }) => ({ id, label, lessons }))
		};
		expect(calendarSettingsSchema.parse(legacy)).toEqual(legacy);
	});

	it('explains a refused download without changing lessons or leaking provider details', async () => {
		const before = await db.select().from(t.lessons);
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private-provider-body', { status: 403 }));
		await expect(
			calendarCommand(
				db,
				ids.teacher,
				{ action: 'preview', url },
				{
					now,
					loadFeed: (source, date) => fetchCalendarFeed(source, date, fetcher)
				}
			)
		).rejects.toMatchObject({
			status: 422,
			body: { message: expect.stringContaining('HTTP 403') }
		});
		expect(await db.select().from(t.lessons)).toEqual(before);
		expect((await getCalendarSettings(db, ids.teacher)).connection?.previewAt).toBeNull();
	});

	it('previews without changing lessons, excludes unmapped courses and never returns the secret URL', async () => {
		feed.mockResolvedValue([event, { ...event, key: 'other', course: 'Other' }]);
		const before = await db.select().from(t.lessons);
		const preview = await command({ action: 'preview', url });
		expect(await db.select().from(t.lessons)).toEqual(before);
		expect(JSON.stringify(preview)).not.toContain('pronote-campus');
		await command({
			action: 'connect',
			revision: preview.connection!.revision,
			mappings: [{ course: event.course, contextId: ids.currentContext, adoptions: [] }]
		});
		expect(await db.select().from(t.calendarLessons)).toHaveLength(1);
	});
	it('reschedules a stable identity once while preserving preparation, manual lessons and stale-draft protection', async () => {
		await connect();
		const [source] = await db.select().from(t.calendarLessons);
		await db
			.update(t.lessons)
			.set({ recap: 'Keep my notes', toDo: 'Keep my preparation' })
			.where(eq(t.lessons.id, source.lessonId));
		const before = await getModule(db, ids.module);
		const stale = { ...editableModule(before), expectedRevision: before.revision };
		const manual = await db.select().from(t.lessons).where(eq(t.lessons.contextId, ids.currentContext));
		feed.mockResolvedValue([{ ...event, startsAt: '2026-11-05T09:00:00.000Z', endsAt: '2026-11-05T11:00:00.000Z' }]);
		await command({ action: 'sync', manual: true }, new Date('2026-11-01T08:00:00Z'));
		await command({ action: 'sync', manual: true }, new Date('2026-11-01T08:02:00Z'));
		const [updated] = await db.select().from(t.lessons).where(eq(t.lessons.id, source.lessonId));
		expect(updated).toMatchObject({
			recap: 'Keep my notes',
			toDo: 'Keep my preparation',
			startsAt: new Date('2026-11-05T09:00:00Z')
		});
		expect(await db.select().from(t.calendarLessons)).toHaveLength(1);
		for (const lesson of manual.filter((v) => v.id !== source.lessonId))
			expect(await db.select().from(t.lessons).where(eq(t.lessons.id, lesson.id))).toEqual([lesson]);
		await expect(updateModule(db, ids.module, stale)).rejects.toMatchObject({ status: 409 });
	});
	it('refuses removal or source-owned date edits even from a fresh module draft, but accepts notes', async () => {
		await connect();
		const [source] = await db.select().from(t.calendarLessons);
		const before = await getModule(db, ids.module);
		const original = { ...editableModule(before), expectedRevision: before.revision };
		const removed = structuredClone(original);
		removed.contexts[0].lessons = removed.contexts[0].lessons.filter((v) => v.id !== source.lessonId);
		await expect(updateModule(db, ids.module, removed)).rejects.toMatchObject({ status: 409 });
		const changed = structuredClone(original);
		changed.contexts[0].lessons.find((v) => v.id === source.lessonId)!.title = 'Changed';
		await expect(updateModule(db, ids.module, changed)).rejects.toMatchObject({ status: 409 });
		original.contexts[0].lessons.find((v) => v.id === source.lessonId)!.recap = 'Allowed';
		await updateModule(db, ids.module, original);
	});
	it('retains missing events, excludes explicit cancellations from the home calendar, and reactivates a returning event', async () => {
		await connect();
		feed.mockResolvedValue([]);
		await command({ action: 'sync', manual: true }, new Date('2026-11-01T08:00:00Z'));
		expect((await db.select().from(t.calendarLessons))[0].status).toBe('missing');
		feed.mockResolvedValue([{ ...event, cancelled: true }]);
		await command({ action: 'sync', manual: true }, new Date('2026-11-02T08:00:00Z'));
		expect((await getHomeData(db, now, '2026-11')).calendar.lessonDates).not.toContain('2026-11-04');
		feed.mockResolvedValue([event]);
		await command({ action: 'sync', manual: true }, new Date('2026-11-03T08:00:00Z'));
		expect((await db.select().from(t.calendarLessons))[0].status).toBe('active');
	});
	it('claims one attempt per Paris usage day, including failures, and preserves the last good schedule', async () => {
		await connect();
		const saved = await db.select().from(t.lessons);
		feed.mockRejectedValue(new Error('private source URL must not leak'));
		await command({ action: 'sync', manual: false }, new Date('2026-10-31T23:01:00Z'));
		await command({ action: 'sync', manual: false }, new Date('2026-11-01T08:00:00Z'));
		expect(feed).toHaveBeenCalledTimes(2);
		expect(await db.select().from(t.lessons)).toEqual(saved);
		expect(JSON.stringify(await getCalendarSettings(db, ids.teacher))).not.toContain('private source');
	});
	it('disconnects without deleting lessons and stops subsequent network work', async () => {
		const settings = await connect();
		const before = await db.select().from(t.lessons);
		await command({ action: 'disconnect', revision: settings.connection!.revision });
		await command({ action: 'sync', manual: true }, new Date('2026-11-01T08:00:00Z'));
		expect(feed).toHaveBeenCalledTimes(1);
		expect(await db.select().from(t.lessons)).toEqual(before);
		expect((await db.select().from(t.calendarLessons))[0].status).toBe('disconnected');
	});
	it('requires explicit adoption when a manual lesson could be the same occurrence', async () => {
		const lessonId = crypto.randomUUID();
		await db.insert(t.lessons).values({
			id: lessonId,
			contextId: ids.currentContext,
			title: 'Manual',
			startsAt: new Date(event.startsAt),
			endsAt: new Date(event.endsAt),
			recap: 'Preserve'
		});
		await expect(connect()).rejects.toMatchObject({ status: 409 });
		const p = await getCalendarSettings(db, ids.teacher);
		await command({
			action: 'connect',
			revision: p.connection!.revision,
			mappings: [
				{
					course: event.course,
					contextId: ids.currentContext,
					adoptions: [{ key: event.key, lessonId }]
				}
			]
		});
		expect((await db.select().from(t.calendarLessons))[0].lessonId).toBe(lessonId);
		expect((await db.select().from(t.lessons).where(eq(t.lessons.id, lessonId)))[0].recap).toBe('Preserve');
	});
	it('rejects archived contexts and expired previews without writes', async () => {
		const p = await command({ action: 'preview', url });
		await expect(
			command({
				action: 'connect',
				revision: p.connection!.revision,
				mappings: [{ course: event.course, contextId: ids.oldContext, adoptions: [] }]
			})
		).rejects.toMatchObject({ status: 409 });
		await expect(
			command(
				{
					action: 'connect',
					revision: p.connection!.revision,
					mappings: [{ course: event.course, contextId: ids.currentContext, adoptions: [] }]
				},
				new Date('2026-11-02T08:00:00Z')
			)
		).rejects.toMatchObject({ status: 409 });
		expect(await db.select().from(t.calendarLessons)).toHaveLength(0);
	});
	it('rolls back an entire refresh when a rescheduled event collides with a manual lesson', async () => {
		await connect();
		await db.insert(t.lessons).values({
			contextId: ids.currentContext,
			title: 'Manual conflict',
			startsAt: new Date('2026-11-05T08:00:00Z'),
			endsAt: new Date('2026-11-05T10:00:00Z')
		});
		const before = await db.select().from(t.lessons);
		feed.mockResolvedValue([{ ...event, startsAt: '2026-11-05T08:00:00.000Z', endsAt: '2026-11-05T10:00:00.000Z' }]);
		const result = await command({ action: 'sync', manual: true }, new Date('2026-11-01T08:00:00Z'));
		expect(result.connection!.error).toContain('créneau');
		expect(await db.select().from(t.lessons)).toEqual(before);
	});
	it('does not modify archived contexts or published snapshots during refresh', async () => {
		await connect();
		const publications = await db.select().from(t.modulePublications);
		await db.update(t.teachingContexts).set({ archivedAt: now }).where(eq(t.teachingContexts.id, ids.currentContext));
		const before = await db.select().from(t.lessons);
		feed.mockResolvedValue([{ ...event, startsAt: '2026-11-05T08:00:00.000Z', endsAt: '2026-11-05T10:00:00.000Z' }]);
		await command({ action: 'sync', manual: true }, new Date('2026-11-01T08:00:00Z'));
		expect(await db.select().from(t.lessons)).toEqual(before);
		expect(await db.select().from(t.modulePublications)).toEqual(publications);
	});
	it('allows a reviewed association for a new academic year without moving old preparation', async () => {
		const connected = await connect();
		await command({ action: 'disconnect', revision: connected.connection!.revision });
		await db.update(t.teachingContexts).set({ archivedAt: now }).where(eq(t.teachingContexts.id, ids.currentContext));
		const classId = crypto.randomUUID(),
			contextId = crypto.randomUUID();
		await db.insert(t.classes).values({ id: classId, name: 'Next year', academicYear: '2027-2028' });
		await db.insert(t.teachingContexts).values({
			id: contextId,
			classId,
			moduleId: ids.module,
			className: 'Next year',
			academicYear: '2027-2028'
		});
		feed.mockResolvedValue([{ ...event, key: 'next-year-event' }]);
		const preview = await command({ action: 'preview', url }, new Date('2026-11-01T08:00:00Z'));
		await command(
			{
				action: 'connect',
				revision: preview.connection!.revision,
				mappings: [{ course: event.course, contextId, adoptions: [] }]
			},
			new Date('2026-11-01T08:01:00Z')
		);
		expect(await db.select().from(t.calendarLessons)).toHaveLength(2);
		expect(
			(await db.select().from(t.lessons).where(eq(t.lessons.contextId, ids.currentContext))).some(
				(v) => v.title === event.title
			)
		).toBe(true);
	});
	it('does not reactivate a cancelled lesson on disconnect', async () => {
		await connect();
		feed.mockResolvedValue([{ ...event, cancelled: true }]);
		const cancelled = await command({ action: 'sync', manual: true }, new Date('2026-11-01T08:00:00Z'));
		await command({ action: 'disconnect', revision: cancelled.connection!.revision });
		expect((await getHomeData(db, now, '2026-11')).calendar.lessonDates).not.toContain('2026-11-04');
	});
	it.each(['cancelled', 'disconnected'] as const)(
		'respects a %s lesson from the previous subscription when replacing the feed',
		async (status) => {
			let settings = await connect();
			const [original] = await db.select().from(t.calendarLessons);
			await db
				.update(t.lessons)
				.set({ recap: 'Keep my notes', toDo: 'Keep my preparation' })
				.where(eq(t.lessons.id, original.lessonId));
			if (status === 'cancelled') {
				feed.mockResolvedValue([{ ...event, cancelled: true }]);
				settings = await command({ action: 'sync', manual: true }, new Date('2026-11-01T08:00:00Z'));
			}
			await command({ action: 'disconnect', revision: settings.connection!.revision });
			const [metadata] = await db.select().from(t.calendarLessons);
			const [lesson] = await db.select().from(t.lessons).where(eq(t.lessons.id, original.lessonId));
			expect(metadata.status).toBe(status);
			const replacement = { ...event, title: 'Replacement' };
			feed.mockResolvedValue([replacement]);
			const preview = await command(
				{ action: 'preview', url: 'https://school.pronote-campus.net/hp/Telechargements/ical/replacement.ics' },
				new Date('2026-11-01T08:02:00Z')
			);
			const mappingsBefore = await db.select().from(t.calendarMappings);
			const moduleBefore = await getModule(db, ids.module);
			const connection = command(
				{
					action: 'connect',
					revision: preview.connection!.revision,
					mappings: [{ course: event.course, contextId: ids.currentContext, adoptions: [] }]
				},
				new Date('2026-11-01T08:02:00Z')
			);
			if (status === 'disconnected') {
				await expect(connection).rejects.toMatchObject({ status: 409 });
				expect(await db.select().from(t.calendarLessons)).toEqual([metadata]);
				expect(await db.select().from(t.calendarMappings)).toEqual(mappingsBefore);
				expect(await getModule(db, ids.module)).toEqual(moduleBefore);
				expect((await getCalendarSettings(db, ids.teacher)).connection?.active).toBe(false);
			} else {
				expect((await connection).connection?.active).toBe(true);
				const imported = (await db.select().from(t.calendarLessons)).find((row) => row.lessonId !== lesson.id)!;
				expect(imported).toMatchObject({ eventKey: event.key, status: 'active' });
				expect(imported.mappingId).not.toBe(metadata.mappingId);
				feed.mockResolvedValue([{ ...replacement, title: 'Updated replacement' }]);
				const refreshed = await command({ action: 'sync', manual: true }, new Date('2026-11-01T08:04:00Z'));
				expect(refreshed.connection?.error).toBe('');
				expect(await db.select().from(t.lessons).where(eq(t.lessons.id, imported.lessonId))).toEqual([
					expect.objectContaining({
						title: 'Updated replacement',
						startsAt: new Date(event.startsAt),
						endsAt: new Date(event.endsAt)
					})
				]);
				expect(await db.select().from(t.calendarLessons)).toHaveLength(2);
			}
			expect(await db.select().from(t.lessons).where(eq(t.lessons.id, lesson.id))).toEqual([lesson]);
			expect(await db.select().from(t.calendarLessons).where(eq(t.calendarLessons.lessonId, lesson.id))).toEqual([
				metadata
			]);
		}
	);
	it('does not infer a new lesson when a bound event changes its course label', async () => {
		const connected = await connect();
		await command({ action: 'disconnect', revision: connected.connection!.revision });
		feed.mockResolvedValue([{ ...event, course: 'Renamed course', title: 'Renamed' }]);
		const preview = await command({ action: 'preview', url }, new Date('2026-11-01T08:00:00Z'));
		await expect(
			command(
				{
					action: 'connect',
					revision: preview.connection!.revision,
					mappings: [{ course: 'Renamed course', contextId: ids.secondContext, adoptions: [] }]
				},
				new Date('2026-11-01T08:01:00Z')
			)
		).rejects.toMatchObject({ status: 409 });
		expect(await db.select().from(t.calendarLessons)).toHaveLength(1);
	});
	it('holds a database lease during network work and ignores a response after disconnect', async () => {
		const settings = await connect();
		let release!: (events: CalendarOccurrence[]) => void;
		feed.mockImplementation(
			() =>
				new Promise((resolve) => {
					release = resolve;
				})
		);
		const sync = command({ action: 'sync', manual: false }, new Date('2026-11-01T08:00:00Z'));
		await vi.waitFor(() => expect(feed).toHaveBeenCalledTimes(2));
		await command({ action: 'sync', manual: false }, new Date('2026-11-01T08:00:00Z'));
		expect(feed).toHaveBeenCalledTimes(2);
		await command({ action: 'disconnect', revision: settings.connection!.revision });
		release([{ ...event, title: 'Must not overwrite' }]);
		await sync;
		expect((await db.select().from(t.lessons)).some((v) => v.title === 'Must not overwrite')).toBe(false);
	});
	it('imports a full bounded feed without duplicating events or incrementing revisions per lesson', async () => {
		const contextId = crypto.randomUUID();
		const moduleId = crypto.randomUUID();
		await db.insert(t.modules).values({ id: moduleId, title: 'Fictional full year' });
		await db.insert(t.teachingContexts).values({
			id: contextId,
			moduleId,
			classId: ids.currentClass,
			className: 'B2 Demo',
			academicYear: '2026-2027'
		});
		feed.mockResolvedValue(
			Array.from({ length: 200 }, (_, index) => ({
				...event,
				key: `event-${index}`,
				startsAt: new Date(Date.UTC(2027, 0, 1 + index, 8)).toISOString(),
				endsAt: new Date(Date.UTC(2027, 0, 1 + index, 10)).toISOString()
			}))
		);
		const preview = await command({ action: 'preview', url });
		await command({
			action: 'connect',
			revision: preview.connection!.revision,
			mappings: [{ course: event.course, contextId, adoptions: [] }]
		});
		expect(await db.select().from(t.calendarLessons)).toHaveLength(200);
		expect((await db.select().from(t.modules).where(eq(t.modules.id, moduleId)))[0].revision).toBe(2);
		await command({ action: 'sync', manual: true }, new Date('2026-11-01T08:00:00Z'));
		expect(await db.select().from(t.calendarLessons)).toHaveLength(200);
		expect((await db.select().from(t.modules).where(eq(t.modules.id, moduleId)))[0].revision).toBe(2);
	});
	it('explains throttled manual refreshes without claiming a successful download', async () => {
		await connect();
		await expect(command({ action: 'sync', manual: true })).rejects.toMatchObject({ status: 429 });
		expect(feed).toHaveBeenCalledTimes(1);
	});
	it('validates a simultaneous timetable swap against the final schedule', async () => {
		const other = {
			...event,
			key: 'other',
			startsAt: '2026-11-04T10:00:00.000Z',
			endsAt: '2026-11-04T12:00:00.000Z'
		};
		feed.mockResolvedValue([event, other]);
		await connect();
		feed.mockResolvedValue([
			{ ...event, startsAt: other.startsAt, endsAt: other.endsAt },
			{ ...other, startsAt: event.startsAt, endsAt: event.endsAt }
		]);
		const result = await command({ action: 'sync', manual: true }, new Date('2026-11-01T08:00:00Z'));
		expect(result.connection!.error).toBe('');
		const rows = await db
			.select({ start: t.lessons.startsAt, key: t.calendarLessons.eventKey })
			.from(t.lessons)
			.innerJoin(t.calendarLessons, eq(t.lessons.id, t.calendarLessons.lessonId));
		expect(rows.find((v) => v.key === event.key)!.start.toISOString()).toBe(other.startsAt);
		expect(rows.find((v) => v.key === other.key)!.start.toISOString()).toBe(event.startsAt);
	});
	it('lets a later cancellation free a slot in the same atomic refresh', async () => {
		const other = {
			...event,
			key: 'other',
			startsAt: '2026-11-04T10:00:00.000Z',
			endsAt: '2026-11-04T12:00:00.000Z'
		};
		feed.mockResolvedValue([event, other]);
		await connect();
		feed.mockResolvedValue([
			{ ...event, startsAt: other.startsAt, endsAt: other.endsAt },
			{ ...other, cancelled: true }
		]);
		const result = await command({ action: 'sync', manual: true }, new Date('2026-11-01T08:00:00Z'));
		expect(result.connection!.error).toBe('');
		expect((await db.select().from(t.calendarLessons)).find((v) => v.eventKey === other.key)!.status).toBe('cancelled');
	});
});

it.each(['foreign teacher', 'prior generation'] as const)(
	'rejects adoption of a managed lesson from %s without changing its provenance',
	async (provenance) => {
		await connect();
		feed.mockResolvedValue([{ ...event, cancelled: true }]);
		const settings = await command({ action: 'sync', manual: true }, new Date('2026-11-01T08:00:00Z'));
		const [metadata] = await db.select().from(t.calendarLessons);
		const [lesson] = await db.select().from(t.lessons).where(eq(t.lessons.id, metadata.lessonId));
		expect(metadata.status).toBe('cancelled');
		let claimantId = ids.teacher;
		if (provenance === 'foreign teacher') {
			claimantId = crypto.randomUUID();
			await db.insert(t.user).values({ id: claimantId, name: 'Fictional teacher', email: 'calendar@example.test' });
		} else {
			await command({ action: 'disconnect', revision: settings.connection!.revision });
		}
		const replacement = { ...event, key: 'replacement', title: 'Replacement', course: 'Replacement' };
		const preview = await calendarCommand(
			db,
			claimantId,
			{
				action: 'preview',
				url: 'https://school.pronote-campus.net/hp/Telechargements/ical/other-demo.ics'
			},
			{ now: new Date('2026-11-01T08:02:00Z'), loadFeed: async () => [replacement] }
		);
		expect(preview.contexts.flatMap((context) => context.lessons).some((entry) => entry.id === lesson.id)).toBe(false);
		const before = await db.select().from(t.calendarMappings);
		await expect(
			calendarCommand(
				db,
				claimantId,
				{
					action: 'connect',
					revision: preview.connection!.revision,
					mappings: [
						{
							course: replacement.course,
							contextId: ids.currentContext,
							adoptions: [{ key: replacement.key, lessonId: lesson.id }]
						}
					]
				},
				{ now: new Date('2026-11-01T08:02:00Z') }
			)
		).rejects.toMatchObject({ status: 409 });
		expect(await db.select().from(t.lessons).where(eq(t.lessons.id, lesson.id))).toEqual([lesson]);
		expect(await db.select().from(t.calendarLessons)).toEqual([metadata]);
		expect(await db.select().from(t.calendarMappings)).toEqual(before);
	}
);
