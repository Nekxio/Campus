import type { PublicationSnapshot } from '#lib/domain/publication.js';

type Deadline = PublicationSnapshot['deadlines'][number];
type Exercise = PublicationSnapshot['studentContent']['exercises'][number];
type Lesson = PublicationSnapshot['lessonNotes'][number];
export type SemesterFilter = 'all' | 'S1' | 'S2';
type ExerciseGroup = { semester: 'S1' | 'S2' | null; lesson?: Lesson; exercises: Exercise[] };

export const publicRubricTotals = (assessment: PublicationSnapshot['rubric'][number]) => {
	const lines = assessment.groups.flatMap((group) => group.lines);
	return { criteria: lines.length, points: lines.reduce((total, line) => total + line.maxPoints, 0) };
};

export const groupCourseExercises = (
	exercises: readonly Exercise[],
	lessons: readonly Lesson[],
	filter: SemesterFilter
): ExerciseGroup[] => {
	const lessonByExercise = new Map<string, Lesson>();
	for (const lesson of lessons) {
		for (const exerciseId of lesson.exerciseIds ?? []) lessonByExercise.set(exerciseId, lesson);
	}
	const groups = new Map<string, ExerciseGroup>();
	for (const exercise of exercises) {
		const semester = exercise.semester ?? null;
		if (filter !== 'all' && semester !== filter) continue;
		const lesson = lessonByExercise.get(exercise.id);
		const key = `${semester ?? ''}:${lesson?.id ?? ''}`;
		const group: ExerciseGroup = groups.get(key) ?? { semester, lesson, exercises: [] };
		group.exercises.push(exercise);
		groups.set(key, group);
	}
	return [...groups.values()].sort((left, right) => {
		const bySemester = (left.semester ?? 'Z').localeCompare(right.semester ?? 'Z');
		if (bySemester) return bySemester;
		if (!left.lesson || !right.lesson) return Number(!left.lesson) - Number(!right.lesson);
		return (
			Date.parse(left.lesson.startsAt) - Date.parse(right.lesson.startsAt) ||
			left.lesson.id.localeCompare(right.lesson.id)
		);
	});
};

export function selectRailDeadline<T extends Deadline>(deadlines: readonly T[], renderedAt: number): T | null {
	const orderedDeadlines = [...deadlines].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
	return (
		orderedDeadlines.find((deadline) => Date.parse(deadline.dueAt) >= renderedAt) ?? orderedDeadlines.at(-1) ?? null
	);
}
