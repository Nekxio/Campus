import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
	calendarLessons,
	calendarMappings,
	lessons,
	modules,
	teachingContexts,
	classes,
	academicYears
} from '../db/schema.js';
import { batches } from '../db/batches.js';
import type { CalendarStore } from './state.js';
import type { CalendarOccurrence } from '../../domain/calendar-subscription.js';
export const availableCalendarContexts = async (db: CalendarStore) =>
	db
		.select({ id: teachingContexts.id, moduleId: teachingContexts.moduleId })
		.from(teachingContexts)
		.innerJoin(modules, eq(modules.id, teachingContexts.moduleId))
		.innerJoin(classes, eq(classes.id, teachingContexts.classId))
		.leftJoin(academicYears, eq(academicYears.academicYear, classes.academicYear))
		.where(
			and(
				isNull(teachingContexts.archivedAt),
				isNull(modules.pausedAt),
				isNull(academicYears.archivedAt),
				isNull(academicYears.purgedAt)
			)
		);
type LessonRow = Pick<typeof lessons.$inferSelect, 'id' | 'contextId' | 'title' | 'startsAt' | 'endsAt'>;
type Metadata = typeof calendarLessons.$inferSelect;
const overlaps = (lesson: LessonRow, proposed: LessonRow) =>
	lesson.startsAt < proposed.endsAt && lesson.endsAt > proposed.startsAt;
const scheduleRow = (id: string, contextId: string, event: CalendarOccurrence): LessonRow => ({
	id,
	contextId,
	title: event.title,
	startsAt: new Date(event.startsAt),
	endsAt: new Date(event.endsAt)
});
export const applyCalendarEvents = async (
	db: CalendarStore,
	mappings: (typeof calendarMappings.$inferSelect)[],
	events: CalendarOccurrence[],
	now: Date,
	adoptions: Map<string, string> = new Map()
) => {
	if (!mappings.length) return false;
	const available = await availableCalendarContexts(db);
	const active = mappings.filter((m) => available.some((c) => c.id === m.contextId));
	if (!active.length) return false;
	const contextIds = [...new Set(active.map((v) => v.contextId))];
	const current = await db
		.select({
			id: lessons.id,
			contextId: lessons.contextId,
			title: lessons.title,
			startsAt: lessons.startsAt,
			endsAt: lessons.endsAt
		})
		.from(lessons)
		.where(inArray(lessons.contextId, contextIds));
	const managed = await db
		.select({ lessonId: calendarLessons.lessonId, status: calendarLessons.status })
		.from(calendarLessons)
		.innerJoin(lessons, eq(lessons.id, calendarLessons.lessonId))
		.where(inArray(lessons.contextId, contextIds));
	const managedIds = new Set(managed.map(({ lessonId }) => lessonId));
	const lessonStatuses = new Map(managed.map(({ lessonId, status }) => [lessonId, status]));
	const identities = await db
		.select({ metadata: calendarLessons })
		.from(calendarLessons)
		.innerJoin(calendarMappings, eq(calendarMappings.id, calendarLessons.mappingId))
		.where(
			and(eq(calendarMappings.teacherId, active[0].teacherId), eq(calendarMappings.generation, active[0].generation))
		);
	const metadata = identities.map((v) => v.metadata);
	const changed = new Set<string>();
	const scheduleWrites = new Map<string, LessonRow>();
	const statusWrites = new Map<string, Metadata>();
	const store = (row: LessonRow, meta: Metadata) => {
		managedIds.add(row.id);
		lessonStatuses.set(row.id, meta.status);
		const index = current.findIndex((v) => v.id === row.id);
		if (index < 0) current.push(row);
		else current[index] = row;
		const metaIndex = metadata.findIndex((v) => v.lessonId === row.id);
		if (metaIndex < 0) metadata.push(meta);
		else metadata[metaIndex] = meta;
		scheduleWrites.set(row.id, row);
		statusWrites.set(row.id, meta);
		changed.add(row.contextId);
	};
	for (const mapping of active) {
		const incoming = events.filter((v) => v.course === mapping.course);
		for (const event of incoming) {
			const previousMetadata = metadata.find((v) => v.mappingId === mapping.id && v.eventKey === event.key);
			const previous = current.find((v) => v.id === previousMetadata?.lessonId);
			if (previous && previous.startsAt <= now) continue;
			if (!previous && (new Date(event.startsAt) <= now || event.cancelled)) continue;
			const adoptedId = adoptions.get(`${mapping.course}\n${event.key}`);
			const candidate = adoptedId
				? current.find((v) => v.id === adoptedId && v.contextId === mapping.contextId)
				: undefined;
			if (!previous && metadata.some((v) => v.eventKey === event.key))
				error(
					409,
					'Cet événement est déjà rattaché à un autre cours. Ses notes et son association ont été conservées.'
				);
			if (!previous && adoptedId && (!candidate || managedIds.has(adoptedId)))
				error(409, 'La séance choisie est indisponible ou déjà associée.');
			if (
				candidate &&
				(candidate.startsAt.toISOString() !== event.startsAt || candidate.endsAt.toISOString() !== event.endsAt)
			)
				error(409, 'Le rapprochement exige les mêmes horaires.');
			const status = event.cancelled ? 'cancelled' : 'active';
			if (
				previous &&
				previousMetadata?.status === status &&
				previous.title === event.title &&
				previous.startsAt.toISOString() === event.startsAt &&
				previous.endsAt.toISOString() === event.endsAt
			)
				continue;
			if (!previous && !candidate && current.filter((v) => v.contextId === mapping.contextId).length >= 200)
				error(409, 'La limite de 200 séances de ce module est atteinte. Aucune synchronisation n’a été appliquée.');
			const row = scheduleRow(previous?.id ?? candidate?.id ?? crypto.randomUUID(), mapping.contextId, event);
			store(row, { lessonId: row.id, mappingId: mapping.id, eventKey: event.key, status });
		}
		for (const meta of metadata.filter((v) => v.mappingId === mapping.id)) {
			const lesson = current.find((v) => v.id === meta.lessonId);
			if (
				!lesson ||
				lesson.startsAt <= now ||
				incoming.some((v) => v.key === meta.eventKey) ||
				meta.status === 'cancelled' ||
				meta.status === 'missing'
			)
				continue;
			statusWrites.set(meta.lessonId, { ...meta, status: 'missing' });
			changed.add(lesson.contextId);
		}
	}
	// Check the complete proposed timetable: swaps and cancellations can free old slots.
	for (const proposed of scheduleWrites.values()) {
		if (lessonStatuses.get(proposed.id) === 'cancelled') continue;
		if (
			current.some(
				(v) =>
					v.contextId === proposed.contextId &&
					v.id !== proposed.id &&
					lessonStatuses.get(v.id) !== 'cancelled' &&
					overlaps(v, proposed)
			)
		)
			error(
				409,
				'Une autre séance occupe le créneau proposé. Les horaires précédents sont conservés ; vérifiez le calendrier dans Applications.'
			);
	}
	// Bulk upserts leave teacher preparation columns untouched, and bound Worker subrequests.
	for (const batch of batches([...scheduleWrites.values()]))
		await db
			.insert(lessons)
			.values(batch)
			.onConflictDoUpdate({
				target: lessons.id,
				set: {
					title: sql`excluded.title`,
					startsAt: sql`excluded.starts_at`,
					endsAt: sql`excluded.ends_at`
				}
			});
	for (const batch of batches([...statusWrites.values()]))
		await db
			.insert(calendarLessons)
			.values(batch)
			.onConflictDoUpdate({
				target: calendarLessons.lessonId,
				set: { status: sql`excluded.status` }
			});
	if (changed.size) {
		await db
			.update(teachingContexts)
			.set({ revision: sql`${teachingContexts.revision}+1` })
			.where(inArray(teachingContexts.id, [...changed]));
		await db
			.update(modules)
			.set({ revision: sql`${modules.revision}+1` })
			.where(inArray(modules.id, [...new Set(available.filter((v) => changed.has(v.id)).map((v) => v.moduleId))]));
	}
	return changed.size > 0;
};
