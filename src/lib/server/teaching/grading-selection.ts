import { error } from '@sveltejs/kit';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/index.js';
import { classes, modules, teachingContexts } from '../db/schema.js';
import { academicYearSchema } from '../../domain/contracts.js';
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
};

export const gradingYearCookie = 'coursely-grading-year';
const preferenceSchema = z.strictObject({
	teacherId: z.string(),
	academicYear: academicYearSchema
});

export function gradingYearPreference(raw: string | undefined, teacherId: string) {
	try {
		const parsed = preferenceSchema.safeParse(JSON.parse(raw ?? 'null'));
		return parsed.success && parsed.data.teacherId === teacherId
			? parsed.data.academicYear
			: undefined;
	} catch {
		return undefined;
	}
}

const unavailable: () => never = () =>
	error(404, 'Cette sélection n’est plus disponible. Choisissez une année et une classe actives.');

// Resolve explicit identities before any roster read. Never select the first module or newest year.
export async function getGradeWorkspace(
	db: Store & Pick<Database, 'select'>,
	selection: GradingSelection = {}
): Promise<GradeWorkspaceData> {
	const [classList, contextList] = await Promise.all([
		db
			.select({ id: classes.id, name: classes.name, academicYear: classes.academicYear })
			.from(classes)
			.where(activeClassFilter(db))
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
					eq(teachingContexts.academicYear, classes.academicYear),
					activeClassFilter(db)
				)
			)
			.orderBy(asc(modules.title), asc(teachingContexts.id))
	]);
	const academicYears = [...new Set(classList.map((item) => item.academicYear))];
	let selectedClass = selection.classId
		? classList.find((item) => item.id === selection.classId)
		: undefined;
	if (selection.classId && !selectedClass) unavailable();
	let selectedContext = selection.contextId
		? contextList.find((item) => item.id === selection.contextId)
		: undefined;
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
		selectedClass = classList.find((item) => item.id === selectedContext.classId);
	}
	const inferredYear = selectedClass?.academicYear;
	if (selection.academicYear && !academicYears.includes(selection.academicYear)) unavailable();
	if (
		inferredYear &&
		selection.academicYear !== undefined &&
		selection.academicYear !== inferredYear
	)
		unavailable();
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
	const contexts = selectedClass
		? contextList.filter((item) => item.classId === selectedClass.id)
		: [];
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
	const grid = selectedContext
		? await getGradeGrid(db, selectedContext.moduleId, selectedContext.id)
		: { rubric: null, contextId: null, students: [] };
	return {
		...grid,
		modules: moduleList,
		contexts: contexts.map(({ id, moduleId, className, academicYear }) => ({
			id,
			moduleId,
			className,
			academicYear
		})),
		academicYears,
		academicYear,
		classes: visibleClasses,
		classId: selectedClass?.id ?? null
	};
}
