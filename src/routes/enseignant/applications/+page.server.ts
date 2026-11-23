import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withAuth } from '#lib/server/auth/runtime.js';
import { listApplications, revokeApplication } from '#lib/server/mcp/consent.js';
import { mcpConnection } from '#lib/server/mcp/oauth.js';
import type { Actions, PageServerLoad } from './$types';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { calendarCommand, getCalendarSettings } from '#lib/server/calendar/service.js';
import { requireTeacher } from '#lib/server/auth/access.js';
import { teacherFormAction } from '#lib/server/teaching/form-actions.js';
import { revokeConsentSchema } from '#lib/domain/remote-mcp.js';
import { calendarCommandSchema } from '#lib/domain/calendar-subscription.js';
import { z } from 'zod';
export const load: PageServerLoad = async ({ locals }) => {
	const teacher = requireTeacherPage(locals);
	const [agents, calendar] = await Promise.all([
		withAuth(async (_auth, client, origin) => ({
			applications: await listApplications(client, teacher.id),
			connection: mcpConnection(origin)
		})),
		withTeacherDatabase(locals, (db) => getCalendarSettings(db, teacher.id))
	]);
	return { ...agents, calendar };
};

const manualCalendarCommandSchema = z.discriminatedUnion('action', [
	calendarCommandSchema.options[0],
	calendarCommandSchema.options[1],
	calendarCommandSchema.options[2].extend({ manual: z.literal(true) }),
	calendarCommandSchema.options[3]
]);

export const actions = {
	revokeApplication: teacherFormAction(
		revokeConsentSchema,
		async (input, { locals }) => {
			const teacher = requireTeacher(locals);
			const receipt = await withAuth((_auth, client) => revokeApplication(client, teacher.id, input));
			return { ...receipt, id: input.id };
		},
		{ native: true, maxBytes: 16384 }
	),
	calendarCommand: teacherFormAction(
		manualCalendarCommandSchema,
		(input, { locals }) => withTeacherDatabase(locals, (db) => calendarCommand(db, requireTeacher(locals).id, input)),
		{
			sanitizeForm: (data) => {
				if ('url' in data) data.url = '';
			}
		}
	)
} satisfies Actions;
