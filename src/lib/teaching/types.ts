import type { Preparation, Resource } from '../domain/contracts.js';
import type { StudentContent } from '../domain/pedagogy.js';

export type ClassSummary = {
	id: string;
	name: string;
	academicYear: string;
	revision: number;
	studentCount: number;
	moduleCount: number;
};
export type StudentRecord = { id: string; name: string; revision: number; position: number };
export type ModuleSummary = {
	id: string;
	title: string;
	description: string;
	revision: number;
	resourceCount: number;
	needsReview?: boolean;
	paused?: boolean;
	agentChanges?: string[];
	classes: { id: string; name: string; academicYear: string }[];
};
export type ClassDetail = ClassSummary & { students: StudentRecord[]; modules: ModuleSummary[] };
export type ClassesData = {
	classes: ClassSummary[];
	selected: ClassDetail | null;
	modules: ModuleSummary[];
};
export type LessonDraft = {
	id: string;
	title: string;
	startsAt: string;
	endsAt: string;
	recap: string;
	toDo: string;
};
export type ContextDraft = {
	id: string;
	classId: string;
	expectedRevision?: number;
	lessons: LessonDraft[];
};
export type ModuleDraft = {
	title: string;
	description: string;
	objectives: string[];
	sourcePath: string;
	preparation: Preparation;
	studentContent?: StudentContent;
	resources: Resource[];
	contexts: ContextDraft[];
};
export type ModuleDetail = ModuleDraft & {
	id: string;
	revision: number;
	needsReview?: boolean;
	agentChanges?: string[];
	paused?: boolean;
};
export type EditorData = {
	classes: ClassSummary[];
	module: ModuleDetail | null;
	publishedPath?: string | null;
};
export type HomeData = {
	modules: ModuleSummary[];
	calendar: { month: string; lessonDates: string[] };
	nextLesson: {
		moduleId: string;
		contextId?: string;
		classId?: string;
		moduleTitle: string;
		className: string;
		academicYear: string;
		title: string;
		startsAt: string;
		endsAt: string;
	} | null;
};
export function emptyModule(): ModuleDraft {
	return {
		title: '',
		description: '',
		objectives: [],
		sourcePath: '',
		preparation: { framing: '', nextSteps: '', sourceLinks: [] },
		studentContent: { instructions: '', projectInstructions: '', exercises: [] },
		resources: [],
		contexts: []
	};
}
export function editableModule(module: ModuleDetail | null): ModuleDraft {
	if (!module) return emptyModule();
	const {
		title,
		description,
		objectives,
		sourcePath,
		preparation,
		studentContent,
		resources,
		contexts
	} = module;
	return structuredClone({
		title,
		description,
		objectives,
		sourcePath,
		preparation,
		studentContent: studentContent ?? { instructions: '', projectInstructions: '', exercises: [] },
		resources,
		contexts
	});
}
