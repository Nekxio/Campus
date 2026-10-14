import { error } from '@sveltejs/kit';
import type { AuthSession } from '../auth.js';

export function requireTeacher(locals: {
	user: AuthSession['user'] | null;
	session: AuthSession['session'] | null;
}) {
	if (!locals.user || !locals.session || locals.session.expiresAt.getTime() <= Date.now())
		error(401, 'Connexion requise.');
	if (locals.user.role !== 'teacher' || locals.session.userId !== locals.user.id)
		error(403, 'Accès refusé.');
	return locals.user;
}
