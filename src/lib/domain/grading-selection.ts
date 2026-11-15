import type { GradeGridData } from './grading.js';

export type GradingNavigationSelection = {
	academicYear?: string | null;
	classId?: string | null;
	moduleId?: string | null;
	contextId?: string | null;
	section?: string | null;
	studentId?: string | null;
};

export const completeGradingSelection = (
	selection: GradingNavigationSelection,
	contexts: readonly { id: string; classId: string | null; academicYear: string }[]
): GradingNavigationSelection => {
	const compatibleContexts = contexts.filter(
		(context) =>
			context.classId !== null &&
			context.academicYear !== '' &&
			(selection.contextId == null || selection.contextId === context.id) &&
			(selection.classId == null || selection.classId === context.classId) &&
			(selection.academicYear == null || selection.academicYear === context.academicYear)
	);
	if (compatibleContexts.length !== 1) return selection;
	const context = compatibleContexts[0];
	return {
		...selection,
		academicYear: selection.academicYear ?? context.academicYear,
		classId: selection.classId ?? context.classId,
		contextId: selection.contextId ?? context.id
	};
};

export const gradingSelectionQuery = (selection: GradingNavigationSelection): URLSearchParams => {
	const query = new URLSearchParams();
	const fields = {
		annee: selection.academicYear,
		classe: selection.classId,
		module: selection.moduleId,
		contexte: selection.contextId,
		section: selection.section,
		etudiant: selection.studentId
	};
	for (const [key, value] of Object.entries(fields)) if (value !== undefined && value !== null) query.set(key, value);
	return query;
};

export type GradeWorkspaceData = GradeGridData & {
	academicYears: string[];
	academicYear: string | null;
	classes: { id: string; name: string; academicYear: string }[];
	classId: string | null;
	selectionNotice?: string;
};
