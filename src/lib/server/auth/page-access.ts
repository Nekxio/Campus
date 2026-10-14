import { isHttpError, redirect } from '@sveltejs/kit';
import { requireTeacher } from './access.js';

type Locals = Parameters<typeof requireTeacher>[0];
export function requireTeacherPage(locals: Locals) {
	try {
		return requireTeacher(locals);
	} catch (cause) {
		if (isHttpError(cause) && cause.status === 401) redirect(303, '/connexion');
		throw cause;
	}
}

export function redirectSignedInTeacher(locals: Locals) {
	if (!locals.user || !locals.session || locals.session.expiresAt.getTime() <= Date.now()) return;
	// An explicit empty fragment prevents a redirect from inheriting an invitation fragment.
	const user = requireTeacher(locals);
	if (user) redirect(303, '/#');
}
