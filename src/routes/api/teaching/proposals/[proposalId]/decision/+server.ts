import { proposalDecisionSchema } from '#lib/domain/proposals.js';
import { decideCorrectionProposal } from '#lib/server/teaching/proposals.js';
import { teachingEndpoint, teachingId } from '#lib/server/teaching/http.js';
export const POST = teachingEndpoint(proposalDecisionSchema, (db, input, event) =>
	decideCorrectionProposal(db, teachingId(event.params.proposalId), input)
);
