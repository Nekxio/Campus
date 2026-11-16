import { quizEndpoint, quizJson } from '#lib/server/quizzes/http.js';
import { teachingId } from '#lib/server/teaching/http.js';
import { withPublicDatabase } from '#lib/server/teaching/public-database.js';
import { listPublicQuizzes } from '#lib/server/teaching/quiz-public.js';

export const GET = quizEndpoint(async (event) =>
	quizJson(await withPublicDatabase((db) => listPublicQuizzes(db, teachingId(event.params.contextId))))
);
