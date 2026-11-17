import { z } from 'zod';
import { academicYearSchema, idSchema } from './contracts.js';

export const calendarCommandSchema = z.discriminatedUnion('action', [
	z.strictObject({ action: z.literal('preview'), url: z.string().max(2048) }),
	z.strictObject({
		action: z.literal('connect'),
		revision: z.number().int().positive(),
		mappings: z
			.array(
				z.strictObject({
					course: z.string().min(1).max(200),
					contextId: idSchema,
					adoptions: z.array(z.strictObject({ key: z.string().max(1024), lessonId: idSchema })).max(200)
				})
			)
			.min(1)
			.max(50)
	}),
	z.strictObject({ action: z.literal('sync'), manual: z.boolean() }),
	z.strictObject({ action: z.literal('disconnect'), revision: z.number().int().positive() })
]);
export type CalendarCommand = z.infer<typeof calendarCommandSchema>;
export const calendarOccurrenceSchema = z.object({
	key: z.string(),
	course: z.string(),
	title: z.string(),
	startsAt: z.string(),
	endsAt: z.string(),
	cancelled: z.boolean()
});
export type CalendarOccurrence = z.infer<typeof calendarOccurrenceSchema>;

export const calendarSettingsSchema = z.object({
	changed: z.boolean().optional(),
	connection: z
		.object({
			active: z.boolean(),
			revision: z.int().nonnegative(),
			lastSuccess: z.string().nullable(),
			lastAttempt: z.string().nullable(),
			error: z.string(),
			previewAt: z.string().nullable(),
			events: z.array(calendarOccurrenceSchema),
			mappings: z.array(z.object({ course: z.string(), contextId: idSchema }))
		})
		.nullable(),
	contexts: z.array(
		z.object({
			id: idSchema,
			label: z.string(),
			academicYear: academicYearSchema.optional(),
			lessons: z.array(z.object({ id: idSchema, title: z.string(), startsAt: z.string(), endsAt: z.string() }))
		})
	),
	issues: z.array(
		z.object({
			lessonId: idSchema,
			title: z.string(),
			status: z.enum(['cancelled', 'missing', 'disconnected']),
			contextId: idSchema,
			moduleId: idSchema
		})
	)
});
export type CalendarSettings = z.infer<typeof calendarSettingsSchema>;
