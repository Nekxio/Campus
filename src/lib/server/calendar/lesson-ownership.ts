import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { calendarLessons, lessons, teachingContexts } from '../db/schema.js';
import type { CalendarStore } from './state.js';
import type { ModuleDraft } from '../../teaching/types.js';
export const guardManagedLessons = async (db: CalendarStore, context: ModuleDraft['contexts'][number]) => {
	const managed = await db
		.select({
			lesson: {
				id: lessons.id,
				title: lessons.title,
				startsAt: lessons.startsAt,
				endsAt: lessons.endsAt
			}
		})
		.from(calendarLessons)
		.innerJoin(lessons, eq(lessons.id, calendarLessons.lessonId))
		.where(eq(lessons.contextId, context.id));
	for (const { lesson } of managed) {
		const incoming = context.lessons.find((v) => v.id === lesson.id);
		if (
			!incoming ||
			incoming.title !== lesson.title ||
			new Date(incoming.startsAt).getTime() !== lesson.startsAt.getTime() ||
			new Date(incoming.endsAt).getTime() !== lesson.endsAt.getTime()
		)
			error(
				409,
				'Les horaires des séances importées sont gérés par le calendrier de l’école. Vos notes sont conservées ; actualisez le module avant de réessayer.'
			);
	}
};
export const getManagedLessons = async (db: CalendarStore, moduleId: string) => {
	return db
		.select({ id: calendarLessons.lessonId, status: calendarLessons.status })
		.from(calendarLessons)
		.innerJoin(lessons, eq(lessons.id, calendarLessons.lessonId))
		.innerJoin(teachingContexts, eq(teachingContexts.id, lessons.contextId))
		.where(eq(teachingContexts.moduleId, moduleId));
};
