import { agentRead } from '#lib/server/agent/http.js';
import { readQuizContext } from '#lib/server/agent/quizzes.js';
import { teachingId } from '#lib/server/teaching/http.js';

export const GET = agentRead(
	(db, { url }) =>
		readQuizContext(db, {
			moduleId: teachingId(url.searchParams.get('moduleId') ?? undefined),
			...(url.searchParams.has('contextId')
				? { contextId: teachingId(url.searchParams.get('contextId') ?? undefined) }
				: {}),
			...(url.searchParams.has('quizId') ? { quizId: teachingId(url.searchParams.get('quizId') ?? undefined) } : {})
		}),
	'quiz_read'
);
