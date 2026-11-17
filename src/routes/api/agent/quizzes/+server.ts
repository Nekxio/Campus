import { agentWrite } from '#lib/server/agent/http.js';
import { createAgentQuizSchema } from '#lib/domain/quiz-agent.js';
import { createAgentQuizDraft } from '#lib/server/agent/quizzes.js';

export const POST = agentWrite('quiz_write', createAgentQuizSchema, createAgentQuizDraft);
