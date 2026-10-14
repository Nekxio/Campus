import { agentRead } from '#lib/server/agent/http.js';
import { getCorrectionContext } from '#lib/server/teaching/proposals.js';
import { teachingId } from '#lib/server/teaching/http.js';
export const GET = agentRead(
	(db, { url }) =>
		db.transaction((tx) =>
			getCorrectionContext(
				tx,
				teachingId(url.searchParams.get('moduleId') ?? undefined),
				teachingId(url.searchParams.get('contextId') ?? undefined),
				url.searchParams.has('studentId')
					? teachingId(url.searchParams.get('studentId') ?? undefined)
					: undefined
			)
		),
	'proposal_read'
);
