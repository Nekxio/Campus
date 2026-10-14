import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
	modules,
	classes,
	teachingContexts,
	resources,
	lessons,
	assessments,
	assessmentDeadlines,
	modulePublications,
	publicationReceipts
} from '../db/schema.js';
import { importFingerprint } from '../../domain/module-import.js';
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
	academicYear: context.archivedAt
		? context.academicYear
		: (annualClass?.academicYear ?? context.academicYear),
	archived: !!context.archivedAt || !annualClass
});

// Construct a fresh allowlist; never spread a private record into a publication.
async function projectDraft(
	db: Store,
	module: typeof modules.$inferSelect,
	context: typeof teachingContexts.$inferSelect,
	annualClass: typeof classes.$inferSelect
): Promise<PublicationSnapshot> {
	const [links, dates, notes] = await Promise.all([
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
				toDo: lessons.toDo
			})
			.from(lessons)
			.where(eq(lessons.contextId, context.id))
			.orderBy(asc(lessons.startsAt), asc(lessons.id))
	]);
	const parsed = publicationSnapshotSchema.safeParse({
		version: 2,
		title: module.title,
		description: module.description,
		objectives: module.objectives,
		className: annualClass.name,
		academicYear: annualClass.academicYear,
		resources: links,
		deadlines: dates.map(({ label, dueAt, submissionInstructions }) => ({
			label,
			dueAt: dueAt.toISOString(),
			submissionInstructions
		})),
		recap: '',
		toDo: '',
		lessonNotes: notes
			.filter((v) => v.recap.trim() || v.toDo.trim())
			.map((v) => ({
				id: v.id,
				label: v.label,
				startsAt: v.startsAt.toISOString(),
				recap: v.recap,
				toDo: v.toDo
			}))
	});
	if (!parsed.success)
		error(422, 'Le contenu étudiant doit être corrigé dans le module avant publication.');
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
	selectedContextId?: string
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
		.sort((a, b) => Number(a.archived) - Number(b.archived));
	const id = selectedContextId ?? contexts[0]?.id;
	if (selectedContextId && !contexts.some((c) => c.id === selectedContextId)) missing();
	if (!id) return { module: { id: module.id, title: module.title }, contexts, selected: null };
	const row = rows.find((v) => v.teaching_context.id === id)!;
	const context = contextChoice(row.teaching_context, row.class);
	const [publication] = await db
		.select()
		.from(modulePublications)
		.where(eq(modulePublications.contextId, id));
	const draft =
		!context.archived && row.class
			? await projectDraft(db, module, row.teaching_context, row.class)
			: null;
	const saved = publicationSnapshotSchema.safeParse(publication?.snapshot);
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
			status: !publication
				? 'draft'
				: publication.unpublishedAt
					? 'unpublished'
					: !published
						? 'legacy'
						: 'published',
			publishedAt: publication?.publishedAt.toISOString() ?? null,
			unpublishedAt: publication?.unpublishedAt?.toISOString() ?? null,
			changed:
				!!draft &&
				(!published || (await importFingerprint(draft)) !== (await importFingerprint(published))),
			publicPath: publicModulePath(id),
			classPath: !context.archived && context.classId ? publicClassPath(context.classId) : null
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
			.where(
				and(
					eq(publicationReceipts.teacherId, teacherId),
					eq(publicationReceipts.requestId, input.requestId)
				)
			);
		if (replay) {
			if (replay.fingerprint !== fingerprint) conflict();
			return publicationReceiptSchema.parse(replay.receipt);
		}
		const { module, context, annualClass } = await sourceContext(tx, moduleId, input.contextId);
		const [current] = await tx
			.select()
			.from(modulePublications)
			.where(eq(modulePublications.contextId, context.id));
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
					.where(
						and(
							eq(modulePublications.id, current.id),
							eq(modulePublications.revision, input.expectedRevision)
						)
					)
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
			if (!current || current.unpublishedAt) conflict();
			const [updated] = await tx
				.update(modulePublications)
				.set({ unpublishedAt: now, revision: input.expectedRevision + 1 })
				.where(
					and(
						eq(modulePublications.id, current.id),
						eq(modulePublications.revision, input.expectedRevision)
					)
				)
				.returning();
			if (!updated) conflict();
			publication = updated;
		}
		const receipt = publicationReceiptSchema.parse({
			requestId: input.requestId,
			contextId: context.id,
			revision: publication.revision,
			publicPath: publicModulePath(context.id),
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

export async function getPublicModule(db: Store, contextId: string): Promise<PublicModuleData> {
	const [row] = await db
		.select({
			snapshot: modulePublications.snapshot,
			publishedAt: modulePublications.publishedAt,
			classId: classes.id,
			archivedAt: teachingContexts.archivedAt
		})
		.from(modulePublications)
		.innerJoin(teachingContexts, eq(modulePublications.contextId, teachingContexts.id))
		.leftJoin(classes, eq(teachingContexts.classId, classes.id))
		.where(
			and(eq(modulePublications.contextId, contextId), isNull(modulePublications.unpublishedAt))
		);
	if (!row) missing();
	const parsed = publicationSnapshotSchema.safeParse(row.snapshot);
	if (!parsed.success) return missing();
	return {
		contextId,
		snapshot: parsed.data,
		publishedAt: row.publishedAt.toISOString(),
		classPath: row.classId && !row.archivedAt ? publicClassPath(row.classId) : null
	};
}

export async function getPublicClass(db: Store, classId: string): Promise<PublicClassData> {
	const [exists] = await db.select({ id: classes.id }).from(classes).where(eq(classes.id, classId));
	if (!exists) missing();
	const rows = await db
		.select({
			contextId: modulePublications.contextId,
			snapshot: modulePublications.snapshot,
			publishedAt: modulePublications.publishedAt,
			unpublishedAt: modulePublications.unpublishedAt
		})
		.from(modulePublications)
		.innerJoin(teachingContexts, eq(modulePublications.contextId, teachingContexts.id))
		.where(and(eq(teachingContexts.classId, classId), isNull(teachingContexts.archivedAt)))
		.orderBy(desc(modulePublications.publishedAt));
	const valid = rows.flatMap((row) => {
		const parsed = publicationSnapshotSchema.safeParse(row.snapshot);
		return parsed.success ? [{ ...row, snapshot: parsed.data }] : [];
	});
	const visible = valid.filter((row) => !row.unpublishedAt);
	const identity = visible[0]?.snapshot ?? valid[0]?.snapshot;
	return {
		classId,
		className: identity?.className ?? null,
		academicYear: identity?.academicYear ?? null,
		modules: visible
			.map((row) => ({
				contextId: row.contextId,
				title: row.snapshot.title,
				description: row.snapshot.description,
				publicPath: publicModulePath(row.contextId),
				publishedAt: row.publishedAt.toISOString()
			}))
			.sort((a, b) => a.title.localeCompare(b.title, 'fr'))
	};
}
