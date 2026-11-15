import { error } from '@sveltejs/kit';
import { agentWrite } from '#lib/server/agent/http.js';
import { patchAgentQuizSchema } from '#lib/domain/quiz-agent.js';
import { patchAgentQuizDraft } from '#lib/server/agent/quizzes.js';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = (event) =>
	agentWrite('quiz_write', patchAgentQuizSchema, (db, teacherId, input) => {
		if (input.id !== event.params.quizId) error(422, 'L’identifiant du quiz ne correspond pas à la requête.');
		return patchAgentQuizDraft(db, teacherId, input);
	})(event);
