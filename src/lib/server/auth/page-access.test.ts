import { describe, expect, it } from 'vitest';
import { requireTeacherPage, redirectSignedInTeacher } from './page-access.js';
import type { AuthSession } from '../auth.js';

const locals: AuthSession = {
	user: {
		id: 'teacher',
		name: 'Teacher Demo',
		email: 'teacher@example.test',
		emailVerified: false,
		createdAt: new Date(),
		updatedAt: new Date(),
		role: 'teacher'
	},
	session: {
		id: 'session',
		token: 'fictional-token',
		userId: 'teacher',
		createdAt: new Date(),
		updatedAt: new Date(),
		expiresAt: new Date(Date.now() + 3600000)
	}
};
function failure(action: () => unknown) {
	try {
		return action();
	} catch (cause) {
		return cause;
	}
}

describe('Teacher page access', () => {
	it('redirects anonymous and expired visitors before returning identity', () => {
		expect(failure(() => requireTeacherPage({ user: null, session: null }))).toMatchObject({
			status: 303,
			location: '/connexion'
		});
		expect(
			failure(() => requireTeacherPage({ ...locals, session: { ...locals.session, expiresAt: new Date(0) } }))
		).toMatchObject({ status: 303, location: '/connexion' });
		expect(requireTeacherPage(locals).name).toBe('Teacher Demo');
	});
	it('refuses another role and mismatched session identity instead of redirecting it into the workspace', () => {
		expect(
			failure(() => requireTeacherPage({ ...locals, user: { ...locals.user, role: 'student' as 'teacher' } }))
		).toMatchObject({ status: 403 });
		expect(
			failure(() => requireTeacherPage({ ...locals, session: { ...locals.session, userId: 'other' } }))
		).toMatchObject({ status: 403 });
	});
	it('redirects existing teachers to a fixed destination with an explicit empty fragment', () => {
		expect(redirectSignedInTeacher({ user: null, session: null })).toBeUndefined();
		expect(failure(() => redirectSignedInTeacher(locals))).toMatchObject({
			status: 303,
			location: '/#'
		});
	});
});
