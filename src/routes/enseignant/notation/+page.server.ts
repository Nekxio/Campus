import type { PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { redirect } from '@sveltejs/kit';
import { gradingSelectionQuery } from '#lib/domain/grading-selection.js';
import {
	resolveGradeWorkspace,
	loadGradeWorkspace,
	gradingStudentId,
	gradingYearCookie,
	gradingPreference,
	rememberGradingWorkspace
} from '#lib/server/teaching/grading-selection.js';
import { teachingId } from '#lib/server/teaching/http.js';
export const load: PageServerLoad = async ({ locals, url, cookies }) => {
	const teacher = requireTeacherPage(locals);
	const id = (name: string) => {
		const value = url.searchParams.get(name);
		return value ? teachingId(value) : (value ?? undefined);
	};
	const preference = gradingPreference(cookies.get(gradingYearCookie), teacher.id);
	const result = await withTeacherDatabase(locals, async (db) => {
		const selection = await resolveGradeWorkspace(db, {
			moduleId: id('module'),
			contextId: id('contexte'),
			classId: id('classe'),
			academicYear: url.searchParams.get('annee') || undefined,
			currentYearOnly: true,
			preferredContexts: preference?.contexts
		});
		const section = url.searchParams.get('section');
		const query = gradingSelectionQuery({
			academicYear: selection.academicYear ?? (url.searchParams.get('annee') === '' ? '' : undefined),
			classId: selection.classId ?? (url.searchParams.get('classe') === '' ? '' : undefined),
			moduleId: selection.moduleId ?? (url.searchParams.get('module') === '' ? '' : undefined),
			contextId: selection.contextId,
			section:
				selection.moduleId && section && ['information', 'preparation', 'resources', 'planning'].includes(section)
					? section
					: undefined,
			studentId: await gradingStudentId(db, selection, url.searchParams.get('etudiant'))
		});
		const search = query.size ? '?' + query.toString() : '';
		if (url.search !== search && !selection.selectionNotice)
			return { kind: 'redirect' as const, selection, location: url.pathname + search };
		return { kind: 'workspace' as const, selection, grid: await loadGradeWorkspace(db, selection) };
	});
	if (result.selection.academicYear) {
		const nextPreference = rememberGradingWorkspace(result.selection, teacher.id, preference);
		if (cookies.get(gradingYearCookie) !== nextPreference)
			cookies.set(gradingYearCookie, nextPreference, {
				path: '/enseignant',
				httpOnly: true,
				sameSite: 'strict',
				secure: url.protocol === 'https:',
				maxAge: 365 * 24 * 60 * 60
			});
	} else if (url.searchParams.get('annee') === '') {
		cookies.delete(gradingYearCookie, { path: '/enseignant' });
	}
	if (result.kind === 'redirect') redirect(307, result.location);
	return { grid: result.grid };
};
