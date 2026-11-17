import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { profileSchema } from '#lib/domain/profile.js';
import { teacherFormAction } from '#lib/server/teaching/form-actions.js';
import { updateTeacherProfile } from '#lib/server/auth/profile.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const teacher = requireTeacherPage(locals);
	return { name: teacher.name, email: teacher.email };
};

export const actions = {
	updateProfile: teacherFormAction(profileSchema, updateTeacherProfile, {
		id: 'teacher-profile',
		native: true,
		maxBytes: 1024
	})
} satisfies Actions;
