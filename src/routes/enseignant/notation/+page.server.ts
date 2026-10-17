import type { PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { redirect } from '@sveltejs/kit';
import {
	getGradeWorkspace,
	gradingYearCookie,
	gradingYearPreference
} from '#lib/server/teaching/grading-selection.js';
import { teachingId } from '#lib/server/teaching/http.js';
export const load: PageServerLoad = async ({ locals, url, cookies }) => {
	const teacher = requireTeacherPage(locals);
	const id = (name: string) => {
		const value = url.searchParams.get(name);
		return value ? teachingId(value) : undefined;
	};
	const grid = await withTeacherDatabase(locals, (db) =>
		getGradeWorkspace(db, {
			moduleId: id('module'),
			contextId: id('contexte'),
			classId: id('classe'),
			academicYear: url.searchParams.get('annee') ?? undefined,
			preferredYear: gradingYearPreference(cookies.get(gradingYearCookie), teacher.id)
		})
	);
	if (grid.academicYear) {
		const preference = JSON.stringify({ teacherId: teacher.id, academicYear: grid.academicYear });
		if (cookies.get(gradingYearCookie) !== preference)
			cookies.set(gradingYearCookie, preference, {
				path: '/enseignant',
				httpOnly: true,
				sameSite: 'strict',
				secure: url.protocol === 'https:',
				maxAge: 365 * 24 * 60 * 60
			});
	} else if (url.searchParams.get('annee') === '') {
		cookies.delete(gradingYearCookie, { path: '/enseignant' });
	}
	const query = new URLSearchParams();
	if (grid.academicYear) query.set('annee', grid.academicYear);
	else if (url.searchParams.get('annee') === '') query.set('annee', '');
	if (grid.classId) query.set('classe', grid.classId);
	if (grid.rubric) query.set('module', grid.rubric.module.id);
	if (grid.contextId) query.set('contexte', grid.contextId);
	const studentId = url.searchParams.get('etudiant');
	if (studentId && grid.students.some((item) => item.id === studentId))
		query.set('etudiant', studentId);
	const search = query.size ? '?' + query.toString() : '';
	if (url.search !== search) redirect(307, url.pathname + search);
	return { grid };
};
