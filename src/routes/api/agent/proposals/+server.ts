import { agentWrite } from '#lib/server/agent/http.js';
import { createProposalSchema } from '#lib/domain/proposals.js';
import { createCorrectionProposal } from '#lib/server/teaching/proposals.js';
export const POST = agentWrite('proposal_create', createProposalSchema, createCorrectionProposal);
