import { agentRead, agentWrite } from '#lib/server/agent/http.js';
import { addAgentStudentsSchema } from '#lib/domain/roster-agent.js';
import { readClassRoster, addAgentStudents } from '#lib/server/agent/roster.js';
import { teachingId } from '#lib/server/teaching/http.js';

export const GET = agentRead(
	(db, event) =>
		db.transaction((tx) => readClassRoster(tx, teachingId(event.url.searchParams.get('classId') ?? undefined))),
	'roster_manage'
);
export const POST = agentWrite('roster_manage', addAgentStudentsSchema, addAgentStudents);
