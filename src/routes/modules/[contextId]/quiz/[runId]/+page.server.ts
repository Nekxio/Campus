import type { PageServerLoad } from './$types';
import { teachingId } from '#lib/server/teaching/http.js';
import { withPublicDatabase } from '#lib/server/teaching/public-database.js';
import { getPublicModule, getPublicRecoveryClassId } from '#lib/server/teaching/publications.js';
import { requirePublicQuizRun } from '#lib/server/teaching/quiz-public.js';

export const load: PageServerLoad = async ({ params, setHeaders, locals }) => {
	setHeaders({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' });
	const contextId = teachingId(params.contextId);
	const runId = teachingId(params.runId);
	const result = await withPublicDatabase((db) =>
		db.transaction(async (tx) => {
			const published = await getPublicModule(tx, contextId);
			await requirePublicQuizRun(tx, contextId, runId);
			const classId = await getPublicRecoveryClassId(tx, published);
			return {
				classId,
				className: published.snapshot.className,
				academicYear: published.snapshot.academicYear,
				courseTitle: published.snapshot.title
			};
		})
	);
	locals.publicClassId = result.classId;
	return {
		contextId,
		runId,
		className: result.className,
		academicYear: result.academicYear,
		courseTitle: result.courseTitle
	};
};
