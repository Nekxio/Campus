import { integer, sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { user } from './auth.schema.js';
import { lessons, teachingContexts } from './teaching.schema.js';
import type { CalendarOccurrence } from '../../domain/calendar-subscription.js';

export const calendarSubscriptions = sqliteTable('calendar_subscription', {
	teacherId: text('teacher_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	generation: text('generation').notNull(),
	url: text('url').notNull(),
	active: integer('active', { mode: 'boolean' }).notNull().default(false),
	revision: integer('revision').notNull().default(1),
	preview: text('preview', { mode: 'json' }).$type<CalendarOccurrence[]>().notNull().default([]),
	previewAt: integer('preview_at', { mode: 'timestamp_ms' }),
	lastSuccess: integer('last_success', { mode: 'timestamp_ms' }),
	lastAttempt: integer('last_attempt', { mode: 'timestamp_ms' }),
	attemptDay: text('attempt_day'),
	leaseUntil: integer('lease_until', { mode: 'timestamp_ms' }),
	leaseToken: text('lease_token'),
	error: text('error').notNull().default('')
});
export const calendarMappings = sqliteTable(
	'calendar_mapping',
	{
		id: text('id').primaryKey(),
		teacherId: text('teacher_id')
			.notNull()
			.references(() => calendarSubscriptions.teacherId, { onDelete: 'cascade' }),
		generation: text('generation').notNull(),
		course: text('course').notNull(),
		contextId: text('context_id')
			.notNull()
			.references(() => teachingContexts.id, { onDelete: 'cascade' }),
		active: integer('active', { mode: 'boolean' }).notNull().default(true)
	},
	(t) => [
		uniqueIndex('calendar_mapping_course').on(t.teacherId, t.generation, t.course, t.contextId),
		index('calendar_mapping_context').on(t.contextId)
	]
);
export const calendarLessons = sqliteTable(
	'calendar_lesson',
	{
		lessonId: text('lesson_id')
			.primaryKey()
			.references(() => lessons.id, { onDelete: 'cascade' }),
		mappingId: text('mapping_id')
			.notNull()
			.references(() => calendarMappings.id, { onDelete: 'restrict' }),
		eventKey: text('event_key').notNull(),
		status: text('status', { enum: ['active', 'cancelled', 'missing', 'disconnected'] })
			.notNull()
			.default('active')
	},
	(t) => [uniqueIndex('calendar_lesson_event').on(t.mappingId, t.eventKey)]
);
