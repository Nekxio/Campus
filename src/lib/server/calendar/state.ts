import { and, eq, isNull, ne, sql, inArray } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
	calendarSubscriptions,
	calendarMappings,
	calendarLessons,
	lessons,
	modules,
	teachingContexts,
	classes
} from '../db/schema.js';
import { activeClassFilter } from '../teaching/annual-access.js';
import { currentAcademicYear } from '../../domain/academic-year.js';
import type { CalendarSettings } from '../../domain/calendar-subscription.js';
export type CalendarStore = Pick<Database, 'select' | 'update' | 'insert'>;
export const subscription = async (db: CalendarStore, teacherId: string) =>
	(await db.select().from(calendarSubscriptions).where(eq(calendarSubscriptions.teacherId, teacherId)))[0];
export const activeLessonFilter = sql`NOT EXISTS (SELECT 1 FROM calendar_lesson WHERE calendar_lesson.lesson_id = ${lessons.id} AND calendar_lesson.status = 'cancelled')`;
export const getCalendarSettings = async (db: CalendarStore, teacherId: string): Promise<CalendarSettings> => {
	const currentYear = currentAcademicYear();
	const source = await subscription(db, teacherId);
	const contexts = await db
		.select({
			id: teachingContexts.id,
			moduleTitle: modules.title,
			className: classes.name,
			year: classes.academicYear
		})
		.from(teachingContexts)
		.innerJoin(modules, eq(modules.id, teachingContexts.moduleId))
		.innerJoin(classes, eq(classes.id, teachingContexts.classId))
		.where(and(isNull(teachingContexts.archivedAt), isNull(modules.pausedAt), activeClassFilter(db)));
	const mappings = source
		? await db
				.select()
				.from(calendarMappings)
				.where(and(eq(calendarMappings.teacherId, teacherId), eq(calendarMappings.generation, source.generation)))
		: [];
	const managed = await db
		.select({
			lessonId: calendarLessons.lessonId,
			title: lessons.title,
			status: calendarLessons.status,
			contextId: lessons.contextId,
			moduleId: teachingContexts.moduleId
		})
		.from(calendarLessons)
		.innerJoin(calendarMappings, eq(calendarMappings.id, calendarLessons.mappingId))
		.innerJoin(lessons, eq(lessons.id, calendarLessons.lessonId))
		.innerJoin(teachingContexts, eq(teachingContexts.id, lessons.contextId))
		.where(
			and(
				eq(calendarMappings.teacherId, teacherId),
				ne(calendarLessons.status, 'active'),
				isNull(teachingContexts.archivedAt)
			)
		);
	const managedIds = db.select({ id: calendarLessons.lessonId }).from(calendarLessons);
	const manual = contexts.length
		? await db
				.select({
					id: lessons.id,
					contextId: lessons.contextId,
					title: lessons.title,
					startsAt: lessons.startsAt,
					endsAt: lessons.endsAt
				})
				.from(lessons)
				.where(
					and(
						inArray(
							lessons.contextId,
							contexts.map((v) => v.id)
						),
						sql`${lessons.id} NOT IN (${managedIds})`
					)
				)
		: [];
	return {
		connection: source
			? {
					active: source.active,
					revision: source.revision,
					lastSuccess: source.lastSuccess?.toISOString() ?? null,
					lastAttempt: source.lastAttempt?.toISOString() ?? null,
					error: source.error,
					previewAt: source.previewAt?.toISOString() ?? null,
					events: source.preview,
					mappings: mappings.filter((v) => v.active).map(({ course, contextId }) => ({ course, contextId }))
				}
			: null,
		contexts: contexts.map((c) => ({
			id: c.id,
			label: `${c.moduleTitle} · ${c.className}${c.year === currentYear ? '' : ` · ${c.year}`}`,
			academicYear: c.year,
			lessons: manual
				.filter((v) => v.contextId === c.id)
				.map((v) => ({
					id: v.id,
					title: v.title,
					startsAt: v.startsAt.toISOString(),
					endsAt: v.endsAt.toISOString()
				}))
		})),
		issues: managed.filter((v): v is CalendarSettings['issues'][number] => v.status !== 'active')
	};
};
