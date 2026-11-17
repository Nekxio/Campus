import { agentWrite } from '#lib/server/agent/http.js';
import { createAgentClassSchema } from '#lib/domain/roster-agent.js';
import { createAgentClass } from '#lib/server/agent/roster.js';

export const POST = agentWrite('roster_manage', createAgentClassSchema, createAgentClass);
