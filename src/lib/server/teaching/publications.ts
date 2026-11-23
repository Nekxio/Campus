import { error, isHttpError } from '@sveltejs/kit';
import { and, asc, desc, eq, isNull, inArray } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
	modules,
	classes,
	teachingContexts,
	resources,
	lessons,
	assessments,
	rubricGroups,
	rubricLines,
	assessmentDeadlines,
	modulePublications,
	publicationReceipts,
	publicModuleLinks,
	publicClassLinks
} from '../db/schema.js';
import { importFingerprint } from '../../domain/module-import.js';
import { idSchema } from '../../domain/contracts.js';
import {
	publicationDecisionSchema,
	publicationSnapshotSchema,
	publicationReceiptSchema,
	publicClassPath,
	publicModulePath,
	type PublicationContext,
	type PublicationDecision,
	type PublicationSnapshot,
	type PublicationReviewData,
	type PublicClassData,
	type PublicModuleData
} from '../../domain/publication.js';
import { batches } from '../db/batches.js';
import { activeLessonFilter } from '../calendar/state.js';

type Store = Pick<Database, 'select'>;
const missing = (): never => error(404, 'Cette page de cours n’est pas disponible.');
const conflict = (): never =>
	error(
		409,
		'Les références ont changé. Votre vérification est conservée ; actualisez l’aperçu avant une nouvelle décision.'
	);
const contextChoice = (
	context: typeof teachingContexts.$inferSelect,
	annualClass: typeof classes.$inferSelect | null
): PublicationContext => ({
	id: context.id,
	classId: annualClass?.id ?? null,
	className: context.archivedAt ? context.className : (annualClass?.name ?? context.className),
	academicYear: context.archivedAt ? context.academicYear : (annualClass?.academicYear ?? context.academicYear),
	archived: !!context.archivedAt || !annualClass
});

const readPublicationRubric = async (db: Store, moduleId: string): Promise<PublicationSnapshot['rubric']> => {
	const rows = await db
		.select({
			assessment: { id: assessments.id, title: assessments.title, kind: assessments.kind },
			group: { id: rubricGroups.id, title: rubricGroups.title },
			line: { label: rubricLines.label, description: rubricLines.description, maxPoints: rubricLines.maxPoints }
		})
		.from(assessments)
		.leftJoin(rubricGroups, and(eq(rubricGroups.assessmentId, assessments.id), isNull(rubricGroups.retiredAt)))
		.leftJoin(
			rubricLines,
			and(
				eq(rubricLines.assessmentId, assessments.id),
				eq(rubricLines.groupId, rubricGroups.id),
				isNull(rubricLines.retiredAt)
			)
		)
		.where(and(eq(assessments.moduleId, moduleId), isNull(assessments.retiredAt)))
		.orderBy(asc(assessments.position), asc(rubricGroups.position), asc(rubricLines.position));
	const rubric: PublicationSnapshot['rubric'] = [];
	const evaluations = new Map<string, PublicationSnapshot['rubric'][number]>();
	const groups = new Map<string, PublicationSnapshot['rubric'][number]['groups'][number]>();
	for (const row of rows) {
		let assessment = evaluations.get(row.assessment.id);
		if (!assessment) {
			assessment = {
				assessmentId: row.assessment.id,
				title: row.assessment.title,
				kind: row.assessment.kind,
				groups: []
			};
			evaluations.set(row.assessment.id, assessment);
			rubric.push(assessment);
		}
		if (!row.group) continue;
		let group = groups.get(row.group.id);
		if (!group) {
			group = { title: row.group.title, lines: [] };
			groups.set(row.group.id, group);
			assessment.groups.push(group);
		}
		if (row.line) group.lines.push(row.line);
	}
	return rubric;
};

// Construct a fresh allowlist; never spread a private record into a publication.
async function projectDraft(
	db: Store,
	module: typeof modules.$inferSelect,
	context: typeof teachingContexts.$inferSelect,
	annualClass: typeof classes.$inferSelect
): Promise<PublicationSnapshot> {
	const [links, dates, notes, rubric] = await Promise.all([
		db
			.select({
				id: resources.id,
				label: resources.label,
				url: resources.url,
				kind: resources.kind
			})
			.from(resources)
			.where(eq(resources.moduleId, module.id))
			.orderBy(asc(resources.position)),
		db
			.select({
				label: assessments.title,
				assessmentId: assessments.id,
				dueAt: assessmentDeadlines.dueAt,
				submissionInstructions: assessmentDeadlines.submissionInstructions
			})
			.from(assessmentDeadlines)
			.innerJoin(assessments, eq(assessments.id, assessmentDeadlines.assessmentId))
			.where(
				and(
					eq(assessmentDeadlines.contextId, context.id),
					eq(assessmentDeadlines.moduleId, module.id),
					eq(assessments.moduleId, module.id),
					isNull(assessments.retiredAt)
				)
			)
			.orderBy(asc(assessmentDeadlines.dueAt), asc(assessments.position)),
		db
			.select({
				id: lessons.id,
				label: lessons.title,
				startsAt: lessons.startsAt,
				recap: lessons.recap,
				toDo: lessons.toDo,
				exerciseIds: lessons.exerciseIds
			})
			.from(lessons)
			.where(and(eq(lessons.contextId, context.id), activeLessonFilter))
			.orderBy(asc(lessons.startsAt), asc(lessons.id)),
		readPublicationRubric(db, module.id)
	]);
	const visibleAssessments = new Set(rubric.map((assessment) => assessment.assessmentId));
	const parsed = publicationSnapshotSchema.safeParse({
		version: 2,
		title: module.title,
		description: module.description,
		objectives: module.objectives,
		studentContent: module.studentContent,
		rubric,
		className: annualClass.name,
		academicYear: annualClass.academicYear,
		resources: links,
		deadlines: dates
			.filter(({ assessmentId }) => visibleAssessments.has(assessmentId))
			.map(({ assessmentId, label, dueAt, submissionInstructions }) => ({
				assessmentId,
				label,
				dueAt: dueAt.toISOString(),
				submissionInstructions
			})),
		recap: '',
		toDo: '',
		lessonNotes: notes
			.filter((v) => v.recap.trim() || v.toDo.trim() || v.exerciseIds.length)
			.map((v) => ({
				id: v.id,
				label: v.label,
				startsAt: v.startsAt.toISOString(),
				recap: v.recap,
				toDo: v.toDo,
				...(v.exerciseIds.length ? { exerciseIds: v.exerciseIds } : {})
			}))
	});
	if (!parsed.success) error(422, 'Le contenu étudiant doit être corrigé dans le module avant publication.');
	return parsed.data;
}

async function sourceContext(db: Store, moduleId: string, contextId: string) {
	const [module] = await db.select().from(modules).where(eq(modules.id, moduleId));
	if (!module) missing();
	const [row] = await db
		.select()
		.from(teachingContexts)
		.leftJoin(classes, eq(teachingContexts.classId, classes.id))
		.where(and(eq(teachingContexts.id, contextId), eq(teachingContexts.moduleId, moduleId)));
	if (!row) missing();
	return { module, context: row.teaching_context, annualClass: row.class };
}

export async function getPublicationReview(
	db: Store,
	moduleId: string,
	selectedContextId?: string,
	academicYear?: string
): Promise<PublicationReviewData> {
	const [module] = await db.select().from(modules).where(eq(modules.id, moduleId));
	if (!module) missing();
	const rows = await db
		.select()
		.from(teachingContexts)
		.leftJoin(classes, eq(teachingContexts.classId, classes.id))
		.where(eq(teachingContexts.moduleId, moduleId))
		.orderBy(desc(teachingContexts.academicYear), asc(teachingContexts.className));
	const contexts = rows
		.map((v) => contextChoice(v.teaching_context, v.class))
		.filter(
			(context) =>
				!academicYear ||
				(context.academicYear === academicYear && !context.archived) ||
				context.id === selectedContextId
		)
		.sort((a, b) => Number(a.archived) - Number(b.archived));
	const id = selectedContextId ?? contexts[0]?.id;
	if (selectedContextId && !contexts.some((c) => c.id === selectedContextId)) missing();
	if (!id) return { module: { id: module.id, title: module.title }, contexts, selected: null };
	const row = rows.find((v) => v.teaching_context.id === id)!;
	const context = contextChoice(row.teaching_context, row.class);
	const [publication] = await db.select().from(modulePublications).where(eq(modulePublications.contextId, id));
	const [link] = await db.select().from(publicModuleLinks).where(eq(publicModuleLinks.contextId, id));
	const [classLink] = context.classId
		? await db.select().from(publicClassLinks).where(eq(publicClassLinks.classId, context.classId))
		: [];
	const retained =
		!publication && link?.publishedContextId
			? (await db.select().from(modulePublications).where(eq(modulePublications.contextId, link.publishedContextId)))[0]
			: undefined;
	const displayed = publication ?? retained;
	const draft = !context.archived && row.class ? await projectDraft(db, module, row.teaching_context, row.class) : null;
	const saved = publicationSnapshotSchema.safeParse(displayed?.snapshot);
	const published = saved.success ? saved.data : null;
	return {
		module: { id: module.id, title: module.title },
		contexts,
		selected: {
			context,
			moduleRevision: module.revision,
			contextRevision: row.teaching_context.revision,
			classRevision: row.class?.revision ?? 0,
			publicationRevision: publication?.revision ?? 0,
			draft,
			published,
			status: !displayed
				? 'draft'
				: displayed.unpublishedAt || link?.enabled === false
					? 'unpublished'
					: !published
						? 'legacy'
						: 'published',
			publishedAt: displayed?.publishedAt.toISOString() ?? null,
			unpublishedAt: displayed?.unpublishedAt?.toISOString() ?? null,
			changed: !!draft && (!published || (await importFingerprint(draft)) !== (await importFingerprint(published))),
			publicPath: publicModulePath(link?.id ?? id),
			classPath: !context.archived && context.classId ? publicClassPath(classLink?.id ?? context.classId) : null
		}
	};
}

export async function decidePublication(
	db: Pick<Database, 'transaction'>,
	teacherId: string,
	moduleId: string,
	raw: PublicationDecision,
	now = new Date()
) {
	const input = publicationDecisionSchema.parse(raw);
	const fingerprint = await importFingerprint({ moduleId, input });
	return db.transaction(async (tx) => {
		const [replay] = await tx
			.select()
			.from(publicationReceipts)
			.where(and(eq(publicationReceipts.teacherId, teacherId), eq(publicationReceipts.requestId, input.requestId)));
		if (replay) {
			if (replay.fingerprint !== fingerprint) conflict();
			return publicationReceiptSchema.parse(replay.receipt);
		}
		const { module, context, annualClass } = await sourceContext(tx, moduleId, input.contextId);
		let [current] = await tx.select().from(modulePublications).where(eq(modulePublications.contextId, context.id));
		if ((current?.revision ?? 0) !== input.expectedRevision) conflict();
		let publication: typeof modulePublications.$inferSelect;
		if (input.action === 'publish') {
			if (!annualClass) return conflict();
			if (
				context.archivedAt ||
				module.revision !== input.moduleRevision ||
				context.revision !== input.contextRevision ||
				annualClass.revision !== input.classRevision
			)
				conflict();
			const snapshot = await projectDraft(tx, module, context, annualClass);
			const [link] = await tx.select().from(publicModuleLinks).where(eq(publicModuleLinks.contextId, context.id));
			if (link)
				await tx
					.update(publicModuleLinks)
					.set({ enabled: true, publishedContextId: context.id })
					.where(eq(publicModuleLinks.id, link.id));
			else
				await tx.insert(publicModuleLinks).values({
					id: context.id,
					moduleId,
					contextId: context.id,
					publishedContextId: context.id
				});
			await tx
				.update(modules)
				.set({ needsReview: false, agentChanges: [], pausedAt: null })
				.where(eq(modules.id, moduleId));
			const values = {
				snapshot,
				sourceRevision: module.revision,
				sourceContextRevision: context.revision,
				sourceClassRevision: annualClass.revision,
				revision: input.expectedRevision + 1,
				publishedAt: now,
				unpublishedAt: null
			};
			if (current) {
				const [updated] = await tx
					.update(modulePublications)
					.set(values)
					.where(and(eq(modulePublications.id, current.id), eq(modulePublications.revision, input.expectedRevision)))
					.returning();
				if (!updated) conflict();
				publication = updated;
			} else {
				const [inserted] = await tx
					.insert(modulePublications)
					.values({ contextId: context.id, ...values })
					.onConflictDoNothing({ target: modulePublications.contextId })
					.returning();
				if (!inserted) conflict();
				publication = inserted;
			}
		} else {
			if (!current) {
				const [link] = await tx.select().from(publicModuleLinks).where(eq(publicModuleLinks.contextId, context.id));
				if (link?.publishedContextId)
					[current] = await tx
						.select()
						.from(modulePublications)
						.where(eq(modulePublications.contextId, link.publishedContextId));
			}
			if (!current || current.unpublishedAt) conflict();
			const [updated] = await tx
				.update(modulePublications)
				.set({ unpublishedAt: now, revision: current.revision + 1 })
				.where(and(eq(modulePublications.id, current.id), eq(modulePublications.revision, current.revision)))
				.returning();
			if (!updated) conflict();
			publication = updated;
			await tx.update(publicModuleLinks).set({ enabled: false }).where(eq(publicModuleLinks.contextId, context.id));
		}
		const [stableLink] = await tx.select().from(publicModuleLinks).where(eq(publicModuleLinks.contextId, context.id));
		const receipt = publicationReceiptSchema.parse({
			requestId: input.requestId,
			contextId: context.id,
			revision: publication.revision,
			publicPath: publicModulePath(stableLink?.id ?? context.id),
			publishedAt: publication.publishedAt.toISOString(),
			unpublishedAt: publication.unpublishedAt?.toISOString() ?? null
		});
		await tx.insert(publicationReceipts).values({
			teacherId,
			contextId: context.id,
			requestId: input.requestId,
			fingerprint,
			receipt
		});
		return receipt;
	});
}

// Validate each requested public identity once; no draft or private identity is projected.
const readPublicModules = async (db: Store, publicIds: string[]): Promise<Map<string, PublicModuleData>> => {
	const result = new Map<string, PublicModuleData>();
	for (const ids of batches([...new Set(publicIds)], 200)) {
		const links = await db
			.select({ link: publicModuleLinks, classId: teachingContexts.classId, classLinkId: publicClassLinks.id })
			.from(publicModuleLinks)
			.leftJoin(teachingContexts, eq(publicModuleLinks.contextId, teachingContexts.id))
			.leftJoin(publicClassLinks, eq(publicClassLinks.classId, teachingContexts.classId))
			.where(inArray(publicModuleLinks.id, ids));
		const linksById = new Map(links.map((row) => [row.link.id, row]));
		const candidates = ids.flatMap((id) => {
			const current = linksById.get(id);
			const link = current?.link;
			return !current || !link?.enabled || !link.publishedContextId
				? []
				: [{ id, current, contextId: link.publishedContextId }];
		});
		if (!candidates.length) continue;
		const rows = await db
			.select({
				contextId: modulePublications.contextId,
				snapshot: modulePublications.snapshot,
				publishedAt: modulePublications.publishedAt
			})
			.from(modulePublications)
			.innerJoin(teachingContexts, eq(modulePublications.contextId, teachingContexts.id))
			.innerJoin(modules, eq(teachingContexts.moduleId, modules.id))
			.where(
				and(
					inArray(
						modulePublications.contextId,
						candidates.map((item) => item.contextId)
					),
					isNull(modulePublications.unpublishedAt),
					isNull(modules.pausedAt)
				)
			);
		const publicationsByContext = new Map(rows.map((row) => [row.contextId, row]));
		for (const candidate of candidates) {
			const row = publicationsByContext.get(candidate.contextId);
			if (!row) continue;
			const parsed = publicationSnapshotSchema.safeParse(row.snapshot);
			if (!parsed.success) continue;
			const currentClassId = candidate.current.classId;
			const classLinkId = candidate.current.classLinkId;
			result.set(candidate.id, {
				contextId: candidate.id,
				snapshot: parsed.data,
				publishedAt: row.publishedAt.toISOString(),
				classPath: currentClassId ? publicClassPath(classLinkId ?? currentClassId) : null
			});
		}
	}
	return result;
};

export async function getPublicModule(db: Store, contextId: string): Promise<PublicModuleData> {
	return (await readPublicModules(db, [contextId])).get(contextId) ?? missing();
}

// Call only with the public reader's result, inside the same transaction.
export async function getPublicRecoveryClassId(db: Store, published: PublicModuleData): Promise<string | null> {
	if (!publicationSnapshotSchema.safeParse(published.snapshot).success) return null;
	if (!idSchema.safeParse(published.contextId).success || !published.classPath) return null;
	const parsed = idSchema.safeParse(published.classPath.slice('/classes/'.length));
	if (!parsed.success || published.classPath !== publicClassPath(parsed.data)) return null;
	try {
		const directory = await getPublicClass(db, parsed.data);
		return directory.modules.some((module) => module.publicPath === publicModulePath(published.contextId))
			? parsed.data
			: null;
	} catch (cause) {
		if (isHttpError(cause) && cause.status === 404) return null;
		throw cause;
	}
}

export const getPublicClass = async (db: Store, publicId: string): Promise<PublicClassData> => {
	const [classLink] = await db.select().from(publicClassLinks).where(eq(publicClassLinks.id, publicId));
	if (classLink && !classLink.classId) return missing();
	const classId = classLink?.classId ?? publicId;
	const rows = await db
		.select({
			identity: { name: classes.name, academicYear: classes.academicYear },
			contextId: teachingContexts.id,
			snapshot: modulePublications.snapshot,
			unpublishedAt: modulePublications.unpublishedAt,
			publicId: publicModuleLinks.id
		})
		.from(classes)
		.leftJoin(teachingContexts, and(eq(teachingContexts.classId, classes.id), isNull(teachingContexts.archivedAt)))
		.leftJoin(modulePublications, eq(modulePublications.contextId, teachingContexts.id))
		.leftJoin(
			publicModuleLinks,
			and(eq(publicModuleLinks.contextId, teachingContexts.id), eq(publicModuleLinks.enabled, true))
		)
		.where(eq(classes.id, classId))
		.orderBy(desc(modulePublications.publishedAt));
	const identity = rows[0]?.identity;
	if (!identity) return missing();
	const candidates = rows.flatMap((row) =>
		row.contextId && !row.unpublishedAt && publicationSnapshotSchema.safeParse(row.snapshot).success
			? [row.publicId ?? row.contextId]
			: []
	);
	const courses = await readPublicModules(db, [
		...candidates,
		...rows.flatMap((row) => (row.publicId ? [row.publicId] : []))
	]);
	return {
		classId: publicId,
		className: identity.name,
		academicYear: identity.academicYear,
		modules: [...courses.values()]
			.map((row) => ({
				contextId: row.contextId,
				title: row.snapshot.title,
				description: row.snapshot.description,
				publicPath: publicModulePath(row.contextId),
				publishedAt: row.publishedAt
			}))
			.sort((a, b) => a.title.localeCompare(b.title, 'fr'))
	};
};
