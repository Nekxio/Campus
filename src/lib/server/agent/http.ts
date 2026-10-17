import type { ProposalAgentAction } from '../../domain/proposals.js';
import { error, isHttpError, json, type RequestEvent } from '@sveltejs/kit';
import type { z } from 'zod';
import type { Database } from '../db/index.js';
import { createDatabase } from '../db/index.js';
import { withAuth } from '../auth/runtime.js';
import { agentBearer, authenticateAgent, requireRubricPermission } from './keys.js';
import { readTeachingJson } from '../teaching/http.js';
import { validationFields } from '../../domain/teaching.js';
import type { AgentAction } from '../../domain/module-import.js';

function agentResponse(body: unknown, status = 200) {
	return json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
function sameOriginWhenProvided(event: RequestEvent) {
	const origin = event.request.headers.get('origin');
	if (
		(origin && origin !== event.url.origin) ||
		event.request.headers.get('sec-fetch-site') === 'cross-site'
	)
		error(403, 'Origine de la requête refusée.');
}
async function handleAgent(
	event: RequestEvent,
	action: AgentAction | ProposalAgentAction,
	operation: (
		db: Database,
		principal: Awaited<ReturnType<typeof authenticateAgent>>
	) => Promise<unknown>
) {
	try {
		const key = agentBearer(event.request);
		sameOriginWhenProvided(event);
		return await withAuth(async (auth, client) => {
			const principal = await authenticateAgent(auth, client, key, action);
			const result = await operation(createDatabase(client), principal);
			return result instanceof Response ? result : agentResponse(result);
		});
	} catch (cause) {
		if (isHttpError(cause)) return agentResponse({ message: cause.body.message }, cause.status);
		return agentResponse(
			{
				message:
					'Import indisponible. Conservez votre dossier et réessayez avec la même clé d’import.'
			},
			503
		);
	}
}
export function agentRead(
	operation: (db: Database, event: RequestEvent) => Promise<unknown>,
	action: 'read' | 'proposal_read' = 'read'
) {
	return (event: RequestEvent) => handleAgent(event, action, (db) => operation(db, event));
}
export function agentWrite<S extends z.ZodType>(
	action: 'create' | 'update' | 'proposal_create',
	schema: S,
	operation: (db: Database, teacherId: string, input: z.output<S>) => Promise<unknown>
) {
	return (event: RequestEvent) =>
		handleAgent(event, action, async (db, principal) => {
			const parsed = schema.safeParse(await readTeachingJson(event.request));
			if (!parsed.success)
				return agentResponse(
					{ message: 'Vérifiez les champs de l’import.', fields: validationFields(parsed.error) },
					422
				);
			if (
				parsed.data &&
				typeof parsed.data === 'object' &&
				'rubric' in parsed.data &&
				parsed.data.rubric
			)
				requireRubricPermission(principal.permissions);
			const removals =
				parsed.data && typeof parsed.data === 'object' && 'remove' in parsed.data
					? parsed.data.remove
					: null;
			if (
				removals &&
				typeof removals === 'object' &&
				['assessments', 'groups', 'lines', 'results', 'deadlineAssessments'].some(
					(key) => key in removals
				)
			)
				requireRubricPermission(principal.permissions);
			return operation(db, principal.teacherId, parsed.data);
		});
}
