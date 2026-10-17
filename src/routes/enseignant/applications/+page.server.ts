import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withAuth } from '#lib/server/auth/runtime.js';
import { listApplications } from '#lib/server/mcp/consent.js';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals }) => {
	const teacher = requireTeacherPage(locals);
	return { applications: await withAuth((_auth, client) => listApplications(client, teacher.id)) };
};
