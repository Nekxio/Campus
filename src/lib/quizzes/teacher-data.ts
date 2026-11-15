import type { QuizDraft } from '#lib/domain/quiz-content.js';
import type { RubricData } from '#lib/domain/grading.js';
import type { ModuleDetail } from '#lib/teaching/types.js';

export type QuizRunSummary = {
	id: string;
	quizId: string;
	status: 'lobby' | 'running' | 'closed';
	sourceRunId: string | null;
	createdAt: Date;
	canOpenFollowUp?: boolean;
};

export type QuizWorkspaceData = {
	academicYear: string;
	module: ModuleDetail;
	rubric: RubricData;
	quizzes: QuizDraft[];
	runs: QuizRunSummary[];
	selectedContextId: string;
};
