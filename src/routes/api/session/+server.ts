import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireTeacher } from '#lib/server/auth/access.js';

export const GET: RequestHandler = ({ locals }) => {
	const user = requireTeacher(locals);
	return json({ user: { id: user.id, name: user.name, role: user.role } });
};
