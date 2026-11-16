import type { LayoutServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
export const load: LayoutServerLoad = ({ locals }) => {
	const user = requireTeacherPage(locals);
	return { user: { name: user.name } };
};
export const prerender = false;
