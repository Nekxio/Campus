import type { Database } from '../index.js';
import { seedGradingFixtures } from './grading-fixtures.js';
import { getCorrectionContext, createCorrectionProposal } from '../../teaching/proposals.js';

// Explicit fictional fixtures only, in a newly created local database. Never issue an agent key.
export async function seedProposalFixtures(db: Database) {
	const ids = await seedGradingFixtures(db);
	const proposals: string[] = [];
	for (const studentId of ids.students.slice(0, 6)) {
		const context = await getCorrectionContext(db, ids.module, ids.currentContext, studentId);
		const project = context.assessments.find((a) => a.id === ids.project)!;
		const points = [5, 5, 4, 4, 5, 4, 4, 4, 8, 7, 7, 9, 9, 8];
		const proposalId = crypto.randomUUID();
		await createCorrectionProposal(db, ids.teacher, {
			requestId: crypto.randomUUID(),
			proposalId,
			payload: {
				version: 2,
				moduleId: ids.module,
				contextId: ids.currentContext,
				studentId,
				assessmentId: ids.project,
				rubricRevision: context.rubricRevision,
				contextRevision: context.contextRevision,
				correctionRevision:
					context.student!.corrections.find((c) => c.assessmentId === ids.project)?.revision ?? 0,
				scores: project.lines.map((line, index) => ({ lineId: line.id, points: points[index] })),
				semesterComment: 'Travail sérieux et progression régulière.',
				commentRevision: context.student!.comment.revision
			}
		});
		proposals.push(proposalId);
	}
	return { ...ids, proposals };
}
