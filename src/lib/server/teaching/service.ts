import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, gte, inArray, isNull, notInArray, sql, count } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { classes, students, modules, resources, teachingContexts, lessons } from '../db/schema.js';
import type {
	ClassSummary,
	ClassesData,
	ModuleSummary,
	ModuleDetail,
	ModuleDraft,
	HomeData
} from '../../teaching/types.js';
import { editableModule } from '../../teaching/types.js';
import { previewRoster } from '../../domain/roster-import.js';

import { activeClassFilter, requireActiveYear } from './annual-access.js';

type Store = Pick<Database, 'select' | 'update' | 'insert' | 'delete'>;
const missing = () => error(404, 'Cet élément n’est plus disponible.');
const conflict = () =>
	error(
		409,
		'Une autre modification a été enregistrée. Vos saisies sont conservées ; rechargez les données avant de réessayer.'
	);
async function claimClass(db: Store, id: string, revision: number) {
	const [current] = await db.select().from(classes).where(eq(classes.id, id));
	if (!current) missing();
	await requireActiveYear(db, current.academicYear);
	const [record] = await db
		.update(classes)
		.set({ revision: sql`${classes.revision} + 1` })
		.where(and(eq(classes.id, id), eq(classes.revision, revision)))
		.returning();
	if (!record) {
		const [exists] = await db.select({ id: classes.id }).from(classes).where(eq(classes.id, id));
		if (!exists) missing();
		conflict();
	}
	return record;
}
async function claimModule(db: Store, id: string, revision: number) {
	const [record] = await db
		.update(modules)
		.set({ revision: sql`${modules.revision} + 1` })
		.where(and(eq(modules.id, id), eq(modules.revision, revision)))
		.returning();
	if (!record) {
		const [exists] = await db.select({ id: modules.id }).from(modules).where(eq(modules.id, id));
		if (!exists) missing();
		conflict();
	}
	return record;
}
export async function listClasses(db: Store): Promise<ClassSummary[]> {
	const [rows, members, attached] = await Promise.all([
		db
			.select()
			.from(classes)
			.where(activeClassFilter(db))
			.orderBy(desc(classes.academicYear), asc(classes.name)),
		db
			.select({ classId: students.classId, total: count() })
			.from(students)
			.groupBy(students.classId),
		db
			.select({ classId: teachingContexts.classId, total: count() })
			.from(teachingContexts)
			.where(isNull(teachingContexts.archivedAt))
			.groupBy(teachingContexts.classId)
	]);
	return rows.map(({ id, name, academicYear, revision }) => ({
		id,
		name,
		academicYear,
		revision,
		studentCount: members.find((v) => v.classId === id)?.total ?? 0,
		moduleCount: attached.find((v) => v.classId === id)?.total ?? 0
	}));
}
export async function listModules(db: Store): Promise<ModuleSummary[]> {
	const [rows, links, attached] = await Promise.all([
		db.select().from(modules).orderBy(asc(modules.title)),
		db
			.select({ moduleId: resources.moduleId, total: count() })
			.from(resources)
			.groupBy(resources.moduleId),
		db
			.select({
				moduleId: teachingContexts.moduleId,
				id: classes.id,
				name: classes.name,
				academicYear: classes.academicYear
			})
			.from(teachingContexts)
			.innerJoin(classes, eq(classes.id, teachingContexts.classId))
			.where(isNull(teachingContexts.archivedAt))
			.orderBy(desc(classes.academicYear), asc(classes.name))
	]);
	return rows.map(({ id, title, description, revision }) => ({
		id,
		title,
		description,
		revision,
		resourceCount: links.find((v) => v.moduleId === id)?.total ?? 0,
		classes: attached
			.filter((v) => v.moduleId === id)
			.map(({ id, name, academicYear }) => ({ id, name, academicYear }))
	}));
}
export async function getClassesData(db: Store, selectedId?: string): Promise<ClassesData> {
	const [allClasses, allModules] = await Promise.all([listClasses(db), listModules(db)]);
	const selected = selectedId ? allClasses.find((v) => v.id === selectedId) : allClasses[0];
	if (selectedId && !selected) missing();
	if (!selected) return { classes: allClasses, selected: null, modules: allModules };
	const roster = await db
		.select({
			id: students.id,
			name: students.name,
			revision: students.revision,
			position: students.position
		})
		.from(students)
		.where(eq(students.classId, selected.id))
		.orderBy(asc(students.position), asc(students.name));
	return {
		classes: allClasses,
		selected: {
			...selected,
			students: roster,
			modules: allModules.filter((v) => v.classes.some((c) => c.id === selected.id))
		},
		modules: allModules
	};
}
export async function createClass(db: Database, input: { name: string; academicYear: string }) {
	return db.transaction(async (tx) => {
		await requireActiveYear(tx, input.academicYear);
		const existing = await tx
			.select()
			.from(classes)
			.where(eq(classes.academicYear, input.academicYear));
		if (existing.some((v) => v.name.toLocaleLowerCase('fr') === input.name.toLocaleLowerCase('fr')))
			error(409, 'Cette classe existe déjà pour cette année.');
		const [record] = await tx.insert(classes).values(input).returning({ id: classes.id });
		return record;
	});
}
export async function updateClass(
	db: Database,
	id: string,
	input: { name: string; academicYear: string; expectedRevision: number }
) {
	return db.transaction(async (tx) => {
		const record = await claimClass(tx, id, input.expectedRevision);
		if (record.academicYear !== input.academicYear)
			error(422, 'Créez une nouvelle classe pour une autre année scolaire.');
		const others = await tx
			.select()
			.from(classes)
			.where(eq(classes.academicYear, input.academicYear));
		if (
			others.some(
				(v) => v.id !== id && v.name.toLocaleLowerCase('fr') === input.name.toLocaleLowerCase('fr')
			)
		)
			error(409, 'Cette classe existe déjà pour cette année.');
		await tx.update(classes).set({ name: input.name }).where(eq(classes.id, id));
		await tx
			.update(teachingContexts)
			.set({ className: input.name, revision: sql`${teachingContexts.revision} + 1` })
			.where(and(eq(teachingContexts.classId, id), isNull(teachingContexts.archivedAt)));
		return { id };
	});
}
export async function addStudents(
	db: Database,
	classId: string,
	input:
		| { kind: 'add'; name: string; expectedRevision: number }
		| { kind: 'import'; source: string; expectedRevision: number }
) {
	return db.transaction(async (tx) => {
		await claimClass(tx, classId, input.expectedRevision);
		const existing = await tx.select().from(students).where(eq(students.classId, classId));
		const preview =
			input.kind === 'import'
				? previewRoster(
						input.source,
						existing.map((v) => v.name)
					)
				: { names: [input.name], errors: [], duplicates: [] };
		if (preview.errors.length)
			error(
				422,
				`Import interrompu : ligne ${preview.errors[0].line}, ${preview.errors[0].message}`
			);
		if (!preview.names.length) error(422, 'Cette liste ne contient aucun nouvel étudiant.');
		const firstPosition = Math.max(-1, ...existing.map((v) => v.position)) + 1;
		// Explicit bounds keep a large roster import within libSQL's bind-variable limit.
		for (let i = 0; i < preview.names.length; i += 100)
			await tx
				.insert(students)
				.values(
					preview.names
						.slice(i, i + 100)
						.map((name, offset) => ({ classId, name, position: firstPosition + i + offset }))
				);
		return { added: preview.names.length, skipped: preview.duplicates.length };
	});
}
export async function changeStudent(
	db: Database,
	classId: string,
	studentId: string,
	input: { expectedRevision: number; classRevision: number; name?: string; confirm?: true }
) {
	return db.transaction(async (tx) => {
		await claimClass(tx, classId, input.classRevision);
		const filter = and(
			eq(students.id, studentId),
			eq(students.classId, classId),
			eq(students.revision, input.expectedRevision)
		);
		const changed =
			input.confirm === true
				? await tx.delete(students).where(filter).returning({ id: students.id })
				: await tx
						.update(students)
						.set({ name: input.name!, revision: sql`${students.revision} + 1` })
						.where(filter)
						.returning({ id: students.id });
		if (!changed.length) conflict();
		return { id: studentId };
	});
}
export async function attachModule(
	db: Database,
	classId: string,
	input: { moduleId: string; moduleRevision: number; expectedRevision: number }
) {
	return db.transaction(async (tx) => {
		const selected = await claimClass(tx, classId, input.expectedRevision);
		await claimModule(tx, input.moduleId, input.moduleRevision);
		const [existing] = await tx
			.select()
			.from(teachingContexts)
			.where(
				and(eq(teachingContexts.classId, classId), eq(teachingContexts.moduleId, input.moduleId))
			);
		if (existing) error(409, 'Ce module est déjà rattaché à cette classe.');
		const [record] = await tx
			.insert(teachingContexts)
			.values({
				moduleId: input.moduleId,
				classId,
				className: selected.name,
				academicYear: selected.academicYear
			})
			.returning({ id: teachingContexts.id });
		return record;
	});
}
export async function getModule(db: Store, id: string): Promise<ModuleDetail> {
	const [record] = await db.select().from(modules).where(eq(modules.id, id));
	if (!record) missing();
	const [links, contexts] = await Promise.all([
		db.select().from(resources).where(eq(resources.moduleId, id)).orderBy(asc(resources.position)),
		db
			.select()
			.from(teachingContexts)
			.innerJoin(classes, eq(teachingContexts.classId, classes.id))
			.where(and(eq(teachingContexts.moduleId, id), isNull(teachingContexts.archivedAt)))
	]);
	const ids = contexts.map((v) => v.teaching_context.id);
	const schedule = ids.length
		? await db
				.select()
				.from(lessons)
				.where(inArray(lessons.contextId, ids))
				.orderBy(asc(lessons.startsAt))
		: [];
	return {
		id: record.id,
		revision: record.revision,
		title: record.title,
		description: record.description,
		objectives: record.objectives,
		sourcePath: record.sourcePath,
		preparation: record.preparation,
		resources: links.map(({ id, label, url, kind }) => ({ id, label, url, kind })),
		contexts: contexts.map(({ teaching_context: context, class: annualClass }) => ({
			id: context.id,
			classId: annualClass.id,
			expectedRevision: context.revision,
			lessons: schedule
				.filter((v) => v.contextId === context.id)
				.map(({ id, title, startsAt, endsAt, recap, toDo }) => ({
					id,
					title,
					startsAt: startsAt.toISOString(),
					endsAt: endsAt.toISOString(),
					recap,
					toDo
				}))
		}))
	};
}
async function writeModuleParts(tx: Store, moduleId: string, draft: ModuleDraft) {
	// Client-supplied durable identities must not target another module or class context.
	const resourceIds = draft.resources.map((v) => v.id);
	if (resourceIds.length) {
		const existing = await tx.select().from(resources).where(inArray(resources.id, resourceIds));
		if (existing.some((v) => v.moduleId !== moduleId)) error(422, 'Identifiant de lien invalide.');
	}
	const allCurrent = await tx
		.select()
		.from(teachingContexts)
		.where(and(eq(teachingContexts.moduleId, moduleId), isNull(teachingContexts.archivedAt)));
	if (allCurrent.some((v) => v.classId && !draft.contexts.some((c) => c.id === v.id))) conflict();
	for (const context of draft.contexts) {
		const [annualClass] = await tx.select().from(classes).where(eq(classes.id, context.classId));
		if (!annualClass) missing();
		await requireActiveYear(tx, annualClass.academicYear);
		const [existing] = await tx
			.select()
			.from(teachingContexts)
			.where(eq(teachingContexts.id, context.id));
		if (existing) {
			if (
				existing.moduleId !== moduleId ||
				existing.classId !== context.classId ||
				existing.archivedAt
			)
				error(422, 'Rattachement invalide.');
			if (existing.revision !== context.expectedRevision) conflict();
			const updated = await tx
				.update(teachingContexts)
				.set({
					className: annualClass.name,
					academicYear: annualClass.academicYear,
					revision: sql`${teachingContexts.revision} + 1`
				})
				.where(
					and(eq(teachingContexts.id, context.id), eq(teachingContexts.revision, existing.revision))
				)
				.returning({ id: teachingContexts.id });
			if (!updated.length) conflict();
		} else {
			if (context.expectedRevision !== undefined) conflict();
			const [duplicate] = await tx
				.select()
				.from(teachingContexts)
				.where(
					and(
						eq(teachingContexts.moduleId, moduleId),
						eq(teachingContexts.classId, context.classId)
					)
				);
			if (duplicate) error(409, 'Ce module est déjà rattaché à cette classe.');
			await tx.insert(teachingContexts).values({
				id: context.id,
				moduleId,
				classId: annualClass.id,
				className: annualClass.name,
				academicYear: annualClass.academicYear
			});
		}
		const lessonIds = context.lessons.map((v) => v.id);
		if (lessonIds.length) {
			const existingLessons = await tx.select().from(lessons).where(inArray(lessons.id, lessonIds));
			if (existingLessons.some((v) => v.contextId !== context.id))
				error(422, 'Identifiant de séance invalide.');
		}
		await tx
			.delete(lessons)
			.where(
				lessonIds.length
					? and(eq(lessons.contextId, context.id), notInArray(lessons.id, lessonIds))
					: eq(lessons.contextId, context.id)
			);
		for (const lesson of context.lessons)
			await tx
				.insert(lessons)
				.values({
					...lesson,
					contextId: context.id,
					startsAt: new Date(lesson.startsAt),
					endsAt: new Date(lesson.endsAt)
				})
				.onConflictDoUpdate({
					target: lessons.id,
					set: {
						title: lesson.title,
						startsAt: new Date(lesson.startsAt),
						endsAt: new Date(lesson.endsAt),
						recap: lesson.recap,
						toDo: lesson.toDo
					}
				});
	}
	await tx
		.delete(resources)
		.where(
			resourceIds.length
				? and(eq(resources.moduleId, moduleId), notInArray(resources.id, resourceIds))
				: eq(resources.moduleId, moduleId)
		);
	for (const [position, resource] of draft.resources.entries())
		await tx
			.insert(resources)
			.values({ ...resource, moduleId, position })
			.onConflictDoUpdate({
				target: resources.id,
				set: { label: resource.label, url: resource.url, kind: resource.kind, position }
			});
}
function creationFingerprint(draft: ModuleDraft) {
	return JSON.stringify({
		title: draft.title,
		description: draft.description,
		objectives: draft.objectives,
		sourcePath: draft.sourcePath,
		preparation: draft.preparation,
		resources: draft.resources,
		contexts: [...draft.contexts]
			.sort((a, b) => a.id.localeCompare(b.id))
			.map(({ id, classId, lessons }) => ({
				id,
				classId,
				lessons: [...lessons]
					.sort((a, b) => a.id.localeCompare(b.id))
					.map((v) => ({
						...v,
						startsAt: new Date(v.startsAt).toISOString(),
						endsAt: new Date(v.endsAt).toISOString()
					}))
			}))
	});
}
export async function createModule(
	db: Pick<Database, 'transaction'>,
	draft: ModuleDraft,
	id: string = crypto.randomUUID()
) {
	return db.transaction(async (tx) => {
		const [existing] = await tx.select({ id: modules.id }).from(modules).where(eq(modules.id, id));
		if (existing) {
			const saved = await getModule(tx, id);
			if (
				saved.revision !== 1 ||
				creationFingerprint(editableModule(saved)) !== creationFingerprint(draft)
			)
				error(
					409,
					'Ce brouillon a déjà été créé avec un contenu différent. Retrouvez-le dans Mes modules.'
				);
			return saved;
		}
		const { title, description, objectives, sourcePath, preparation } = draft;
		await tx
			.insert(modules)
			.values({ id, title, description, objectives, sourcePath, preparation });
		await writeModuleParts(tx, id, draft);
		return getModule(tx, id);
	});
}
export async function updateModule(
	db: Pick<Database, 'transaction'>,
	id: string,
	draft: ModuleDraft & { expectedRevision: number }
) {
	return db.transaction(async (tx) => {
		await claimModule(tx, id, draft.expectedRevision);
		const { title, description, objectives, sourcePath, preparation } = draft;
		await tx
			.update(modules)
			.set({ title, description, objectives, sourcePath, preparation })
			.where(eq(modules.id, id));
		await writeModuleParts(tx, id, draft);
		return getModule(tx, id);
	});
}
export async function getHomeData(db: Store): Promise<HomeData> {
	const [moduleList, next] = await Promise.all([
		listModules(db),
		db
			.select({
				moduleId: modules.id,
				moduleTitle: modules.title,
				className: classes.name,
				academicYear: classes.academicYear,
				title: lessons.title,
				startsAt: lessons.startsAt,
				endsAt: lessons.endsAt
			})
			.from(lessons)
			.innerJoin(teachingContexts, eq(lessons.contextId, teachingContexts.id))
			.innerJoin(classes, eq(teachingContexts.classId, classes.id))
			.innerJoin(modules, eq(teachingContexts.moduleId, modules.id))
			.where(and(isNull(teachingContexts.archivedAt), gte(lessons.endsAt, new Date())))
			.orderBy(asc(lessons.startsAt))
			.limit(1)
	]);
	return {
		modules: moduleList,
		nextLesson: next[0]
			? {
					...next[0],
					startsAt: next[0].startsAt.toISOString(),
					endsAt: next[0].endsAt.toISOString()
				}
			: null
	};
}
