import { error } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/index.js';
import { classes, modules, students, teachingContexts } from '../db/schema.js';
import { academicYearSchema, idSchema } from '../../domain/contracts.js';
import { currentAcademicYear } from '../../domain/academic-year.js';
import type { GradeWorkspaceData } from '../../domain/grading-selection.js';
import { activeClassFilter } from './annual-access.js';
import { getGradeGrid } from './grading.js';

type Store = Parameters<typeof getGradeGrid>[0];
export type GradingSelection = {
	academicYear?: string;
	classId?: string;
	moduleId?: string;
	contextId?: string;
	preferredYear?: string;
	currentYearOnly?: boolean;
	preferredContexts?: GradingContextPreference[];
};
type ResolvedGradeWorkspace = Omit<GradeWorkspaceData, 'rubric' | 'students'> & {
	moduleId: string | null;
};

export const gradingYearCookie = 'coursely-grading-year';
const contextPreferenceSchema = z.strictObject({
	academicYear: academicYearSchema,
	classId: idSchema,
	moduleId: idSchema,
	contextId: idSchema
});
type GradingContextPreference = z.infer<typeof contextPreferenceSchema>;
const preferenceSchema = z.strictObject({
	teacherId: z.string(),
	academicYear: academicYearSchema,
	contexts: z.array(contextPreferenceSchema).max(10).default([])
});

export const gradingPreference = (raw: string | undefined, teacherId: string) => {
	try {
		const parsed = preferenceSchema.safeParse(JSON.parse(raw ?? 'null'));
		return parsed.success && parsed.data.teacherId === teacherId ? parsed.data : undefined;
	} catch {
		return undefined;
	}
};

export const gradingYearPreference = (raw: string | undefined, teacherId: string) =>
	gradingPreference(raw, teacherId)?.academicYear;

export const rememberGradingWorkspace = (
	grid: GradeWorkspaceData | ResolvedGradeWorkspace,
	teacherId: string,
	previous: ReturnType<typeof gradingPreference>
) => {
	const moduleId = 'moduleId' in grid ? grid.moduleId : grid.rubric?.module.id;
	const complete = Boolean(grid.academicYear && grid.classId && grid.contextId && moduleId);
	const contexts = (previous?.contexts ?? [])
		.filter(
			(item) =>
				(!(complete || grid.selectionNotice) || item.academicYear !== grid.academicYear) &&
				grid.academicYears.includes(item.academicYear)
		)
		.slice(-9);
	if (grid.academicYear && grid.classId && grid.contextId && moduleId)
		contexts.push({
			academicYear: grid.academicYear,
			classId: grid.classId,
			moduleId,
			contextId: grid.contextId
		});
	return JSON.stringify({ teacherId, academicYear: grid.academicYear, contexts });
};

const unavailable: () => never = () =>
	error(404, 'Cette sélection n’est plus disponible. Choisissez une classe et un module actifs.');

// Resolve and revalidate identities before any roster read; multiple options remain explicit.
export const resolveGradeWorkspace = async (
	db: Store & Pick<Database, 'select'>,
	selection: GradingSelection = {}
): Promise<ResolvedGradeWorkspace> => {
	const currentYearFilter = selection.currentYearOnly ? eq(classes.academicYear, currentAcademicYear()) : undefined;
	const [classList, contextList] = await Promise.all([
		db
			.select({ id: classes.id, name: classes.name, academicYear: classes.academicYear })
			.from(classes)
			.where(and(activeClassFilter(db), currentYearFilter))
			.orderBy(asc(classes.academicYear), asc(classes.name)),
		db
			.select({
				id: teachingContexts.id,
				moduleId: modules.id,
				title: modules.title,
				classId: classes.id,
				className: classes.name,
				academicYear: classes.academicYear
			})
			.from(teachingContexts)
			.innerJoin(classes, eq(teachingContexts.classId, classes.id))
			.innerJoin(modules, eq(teachingContexts.moduleId, modules.id))
			.where(
				and(
					isNull(teachingContexts.archivedAt),
					isNull(modules.pausedAt),
					eq(teachingContexts.academicYear, classes.academicYear),
					activeClassFilter(db),
					currentYearFilter
				)
			)
			.orderBy(asc(modules.title), asc(teachingContexts.id))
	]);
	const academicYears = [...new Set(classList.map((item) => item.academicYear))];
	let selectedClass = selection.classId ? classList.find((item) => item.id === selection.classId) : undefined;
	if (selection.classId && !selectedClass) unavailable();
	let selectedContext = selection.contextId ? contextList.find((item) => item.id === selection.contextId) : undefined;
	if (selection.contextId && !selectedContext) unavailable();
	if (selection.moduleId) {
		const candidates = contextList.filter(
			(item) =>
				item.moduleId === selection.moduleId &&
				(!selectedClass || item.classId === selectedClass.id) &&
				(selection.academicYear === undefined || item.academicYear === selection.academicYear)
		);
		if (selectedContext && selectedContext.moduleId !== selection.moduleId) unavailable();
		if (!selectedContext && candidates.length === 1) selectedContext = candidates[0];
		if (!candidates.length) unavailable();
	}
	if (selectedContext) {
		if (selectedClass && selectedClass.id !== selectedContext.classId) unavailable();
		const classId = selectedContext.classId;
		selectedClass = classList.find((item) => item.id === classId);
	}
	const inferredYear = selectedClass?.academicYear;
	if (selection.academicYear && !academicYears.includes(selection.academicYear)) unavailable();
	if (inferredYear && selection.academicYear !== undefined && selection.academicYear !== inferredYear) unavailable();
	const academicYear =
		selection.academicYear !== undefined
			? selection.academicYear || null
			: (inferredYear ??
				(selection.preferredYear
					? academicYears.includes(selection.preferredYear)
						? selection.preferredYear
						: null
					: academicYears.length === 1
						? academicYears[0]
						: null));
	const visibleClasses = classList.filter((item) => item.academicYear === academicYear);
	let selectionNotice =
		!academicYear && selection.preferredYear && selection.academicYear === undefined
			? 'La dernière année de travail n’est plus disponible. Choisissez une année ouverte.'
			: undefined;
	const explicitIdentity = [selection.classId, selection.moduleId, selection.contextId].some(
		(value) => value !== undefined
	);
	if (!explicitIdentity) {
		const preferred = selection.preferredContexts?.find((item) => item.academicYear === academicYear);
		if (preferred) {
			selectedClass = visibleClasses.find((item) => item.id === preferred.classId);
			selectedContext = contextList.find(
				(item) =>
					item.id === preferred.contextId &&
					item.moduleId === preferred.moduleId &&
					item.classId === selectedClass?.id &&
					item.academicYear === academicYear
			);
			if (!selectedContext)
				selectionNotice =
					'Le dernier contexte de notation n’est plus disponible. Choisissez une classe et un module actifs.';
		} else if (visibleClasses.length === 1) selectedClass = visibleClasses[0];
	}
	const contexts = selectedClass ? contextList.filter((item) => item.classId === selectedClass.id) : [];
	if (
		!selectedContext &&
		!selectionNotice &&
		selection.moduleId !== '' &&
		selection.contextId !== '' &&
		contexts.length === 1
	)
		selectedContext = contexts[0];
	const moduleList = [
		...new Map(
			contexts.map((item) => [
				item.moduleId,
				{
					id: item.moduleId,
					title: item.title
				}
			])
		).values()
	];
	return {
		modules: moduleList,
		contexts: contexts.map(({ id, moduleId, className, academicYear }) => ({
			id,
			moduleId,
			className,
			academicYear
		})),
		academicYears,
		academicYear,
		selectionNotice,
		classes: visibleClasses,
		classId: selectedClass?.id ?? null,
		moduleId: selectedContext?.moduleId ?? null,
		contextId: selectedContext?.id ?? null
	};
};

export const gradingStudentId = async (
	db: Store,
	selection: ResolvedGradeWorkspace,
	studentId: string | null
): Promise<string | null> => {
	if (!studentId || !selection.classId || !selection.contextId || !selection.moduleId) return null;
	const [student] = await db
		.select({ id: students.id })
		.from(students)
		.where(and(eq(students.id, studentId), eq(students.classId, selection.classId)))
		.limit(1);
	return student?.id ?? null;
};

export const loadGradeWorkspace = async (db: Store, selection: ResolvedGradeWorkspace): Promise<GradeWorkspaceData> => {
	const { moduleId, ...workspace } = selection;
	const grid =
		moduleId && workspace.contextId
			? await getGradeGrid(db, moduleId, workspace.contextId)
			: { rubric: null, students: [] };
	return { ...grid, ...workspace };
};

export const getGradeWorkspace = async (
	db: Store & Pick<Database, 'select'>,
	selection: GradingSelection = {}
): Promise<GradeWorkspaceData> => loadGradeWorkspace(db, await resolveGradeWorkspace(db, selection));
