import type { PublicationSnapshot } from '#lib/domain/publication.js';
import type { Resource } from '#lib/domain/contracts.js';

type Deadline = PublicationSnapshot['deadlines'][number];
type Exercise = PublicationSnapshot['studentContent']['exercises'][number];
type Lesson = PublicationSnapshot['lessonNotes'][number];
const semesters = ['S1', 'S2'] as const;
type Semester = (typeof semesters)[number];
type Workshop = { kind: 'workshop'; id: string; title: string; semester?: Semester | null; lesson?: Lesson };
type CourseSupport = { kind: 'document'; id: string; title: string; url: string } | Workshop;
export type CourseSupportScope = 'all' | 'documents' | 'workshops' | Semester | `lesson:${string}`;
export type CourseSupportSelection = { query: string; scope: CourseSupportScope; page: number };
const supportsPerPage = 6;

export const publicRubricTotals = (assessment: PublicationSnapshot['rubric'][number]) => {
	const lines = assessment.groups.flatMap((group) => group.lines);
	return { criteria: lines.length, points: lines.reduce((total, line) => total + line.maxPoints, 0) };
};

const compareLessons = (left: Lesson, right: Lesson) =>
	Date.parse(left.startsAt) - Date.parse(right.startsAt) || left.id.localeCompare(right.id);

const compareWorkshops = (left: Workshop, right: Workshop) => {
	const bySemester = (left.semester ?? 'Z').localeCompare(right.semester ?? 'Z');
	if (bySemester) return bySemester;
	if (left.lesson && right.lesson) return compareLessons(left.lesson, right.lesson);
	return Number(!left.lesson) - Number(!right.lesson);
};

export const buildCourseSupports = (
	links: readonly Resource[],
	exercises: readonly Exercise[],
	lessons: readonly Lesson[]
): CourseSupport[] => {
	const lessonByExercise = new Map<string, Lesson>();
	for (const lesson of lessons) {
		for (const exerciseId of lesson.exerciseIds ?? []) lessonByExercise.set(exerciseId, lesson);
	}
	const documents = links.map<CourseSupport>(({ id, label, url }) => ({ kind: 'document', id, title: label, url }));
	const workshops = exercises
		.map<Workshop>(({ id, title, semester }) => ({
			kind: 'workshop',
			id,
			title,
			semester,
			lesson: lessonByExercise.get(id)
		}))
		.sort(compareWorkshops);
	return [...documents, ...workshops];
};

export const courseSupportFilters = (supports: readonly CourseSupport[]) => {
	const workshops = supports.filter((support) => support.kind === 'workshop');
	const lessons = new Map<string, Lesson>();
	for (const { lesson } of workshops) {
		if (lesson) lessons.set(lesson.id, lesson);
	}
	return {
		hasTypes: workshops.length > 0 && workshops.length < supports.length,
		semesters: semesters.filter((semester) => workshops.some((workshop) => workshop.semester === semester)),
		lessons: [...lessons.values()].sort(compareLessons)
	};
};

const normalizeSearch = (text: string) =>
	text
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLocaleLowerCase('fr');

const matchesScope = (support: CourseSupport, scope: CourseSupportScope) => {
	if (scope === 'all') return true;
	if (support.kind === 'document') return scope === 'documents';
	return (
		scope === 'workshops' || scope === support.semester || (support.lesson && scope === `lesson:${support.lesson.id}`)
	);
};

export const pageCourseSupports = (
	supports: readonly CourseSupport[],
	{ query, scope, page }: CourseSupportSelection
) => {
	const search = normalizeSearch(query.trim());
	const matches = supports.filter(
		(support) =>
			matchesScope(support, scope) &&
			(!search ||
				normalizeSearch(support.title).includes(search) ||
				(support.kind === 'workshop' && support.lesson && normalizeSearch(support.lesson.label).includes(search)))
	);
	const total = matches.length;
	const pageCount = Math.max(1, Math.ceil(total / supportsPerPage));
	const currentPage = Math.min(Math.max(page, 1), pageCount);
	const offset = (currentPage - 1) * supportsPerPage;
	return {
		items: matches.slice(offset, offset + supportsPerPage),
		page: currentPage,
		pageCount,
		first: total ? offset + 1 : 0,
		last: Math.min(offset + supportsPerPage, total),
		total
	};
};

export function selectRailDeadline<T extends Deadline>(deadlines: readonly T[], renderedAt: number): T | null {
	const orderedDeadlines = [...deadlines].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
	return (
		orderedDeadlines.find((deadline) => Date.parse(deadline.dueAt) >= renderedAt) ?? orderedDeadlines.at(-1) ?? null
	);
}
