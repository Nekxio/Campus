import { agentRead } from '#lib/server/agent/http.js';
import { readImportContext } from '#lib/server/agent/import.js';
import { teachingId } from '#lib/server/teaching/http.js';
export const GET = agentRead((db, event) =>
	readImportContext(
		db,
		event.url.searchParams.has('moduleId')
			? teachingId(event.url.searchParams.get('moduleId') ?? undefined)
			: undefined
	)
);
