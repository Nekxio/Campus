import type { GradeGridData } from './grading.js';

export type GradeWorkspaceData = GradeGridData & {
	academicYears: string[];
	academicYear: string | null;
	classes: { id: string; name: string; academicYear: string }[];
	classId: string | null;
};
