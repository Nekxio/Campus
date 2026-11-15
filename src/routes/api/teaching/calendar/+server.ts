import { calendarCommandSchema } from '#lib/domain/calendar-subscription.js';
import { calendarCommand, syncCalendarIfDue } from '#lib/server/calendar/service.js';
import { teachingEndpoint } from '#lib/server/teaching/http.js';
import { requireTeacher } from '#lib/server/auth/access.js';
export const POST = teachingEndpoint(calendarCommandSchema, async (db, input, event) => {
	const teacherId = requireTeacher(event.locals).id;
	if (input.action === 'sync' && !input.manual) return { changed: await syncCalendarIfDue(db, teacherId, false) };
	return calendarCommand(db, teacherId, input);
});
