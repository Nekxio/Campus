import { proposalDecisionActionSchema } from '#lib/domain/proposals.js';
import { teacherFormAction } from '#lib/server/teaching/form-actions.js';
import type { Actions, PageServerLoad } from './$types';
import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { decideCorrectionProposal, getProposalReview } from '#lib/server/teaching/proposals.js';
import { teachingId } from '#lib/server/teaching/http.js';
export const load: PageServerLoad = ({ locals, url }) => {
	requireTeacherPage(locals);
	const id = url.searchParams.get('proposition'),
		context = url.searchParams.get('contexte');
	return withTeacherDatabase(locals, (db) =>
		db.transaction((tx) =>
			getProposalReview(tx, id ? teachingId(id) : undefined, context ? teachingId(context) : undefined)
		)
	).then((review) => ({ review }));
};

export const actions = {
	decideProposal: teacherFormAction(proposalDecisionActionSchema, (input, event) =>
		withTeacherDatabase(event.locals, (db) => decideCorrectionProposal(db, input.proposalId, input.decision))
	)
} satisfies Actions;
