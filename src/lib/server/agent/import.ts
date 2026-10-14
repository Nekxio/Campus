import { error } from '@sveltejs/kit';
import { activeClassFilter } from '../teaching/annual-access.js';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { agentImports, classes, modules } from '../db/schema.js';
import { createModule, getModule, listModules, updateModule } from '../teaching/service.js';
import { getRubric, replaceRubric } from '../teaching/grading.js';
import {
	createModuleImportSchema,
	updateModuleImportSchema,
	importFingerprint,
	importReceiptSchema,
	type ModuleImport,
	type ImportReceipt
} from '../../domain/module-import.js';

export async function readImportContext(db: Database, moduleId?: string) {
	const [moduleList, classList] = await Promise.all([
		listModules(db),
		db
			.select({
				id: classes.id,
				name: classes.name,
				academicYear: classes.academicYear,
				revision: classes.revision
			})
			.from(classes)
			.where(activeClassFilter(db))
	]);
	const module = moduleId ? await getModule(db, moduleId) : null;
	const rubric = moduleId ? await getRubric(db, moduleId) : null;
	return {
		version: 1 as const,
		modules: moduleList.map(({ id, title, revision }) => ({ id, title, revision })),
		classes: classList,
		module,
		rubric: rubric
			? { assessments: rubric.assessments, results: rubric.results, contexts: rubric.contexts }
			: null
	};
}
export async function importModule(
	db: Database,
	teacherId: string,
	action: 'create' | 'update',
	value: ModuleImport
): Promise<ImportReceipt> {
	const parsed = (
		action === 'create' ? createModuleImportSchema : updateModuleImportSchema
	).safeParse(value);
	if (!parsed.success) error(422, 'Import invalide. Vérifiez les informations du module.');
	const input = parsed.data;
	const fingerprint = await importFingerprint({ action, input });
	return db.transaction(async (tx) => {
		const [previous] = await tx
			.select()
			.from(agentImports)
			.where(
				and(eq(agentImports.teacherId, teacherId), eq(agentImports.requestId, input.requestId))
			);
		if (previous) {
			if (previous.fingerprint !== fingerprint)
				error(409, 'Cette clé d’import a déjà servi pour un contenu différent.');
			return importReceiptSchema.parse(previous.receipt);
		}
		if (action === 'create') {
			const [existing] = await tx
				.select({ id: modules.id })
				.from(modules)
				.where(eq(modules.id, input.moduleId));
			if (existing)
				error(409, 'Ce module existe déjà. Utilisez son identifiant et une mise à jour.');
		}
		const saved =
			action === 'create'
				? await createModule(tx, input.draft, input.moduleId)
				: await updateModule(tx, input.moduleId, {
						...input.draft,
						expectedRevision: updateModuleImportSchema.parse(input).expectedRevision
					});
		if (input.rubric) {
			const current = await getRubric(tx, saved.id);
			const active = new Set(input.rubric.assessments.map((a) => a.id));
			await replaceRubric(tx, saved.id, {
				expectedRevision: saved.revision,
				assessments: input.rubric.assessments,
				results: input.rubric.results,
				contexts: saved.contexts.map((context) => ({
					id: context.id,
					expectedRevision: context.expectedRevision!,
					deadlines:
						input.rubric!.contexts.find((c) => c.id === context.id)?.deadlines ??
						current.contexts
							.find((c) => c.id === context.id)
							?.deadlines.filter((d) => active.has(d.assessmentId)) ??
						[]
				}))
			});
		}
		const final = await getModule(tx, saved.id);
		const receipt: ImportReceipt = {
			version: 1,
			requestId: input.requestId,
			action,
			moduleId: final.id,
			revision: final.revision,
			contextRevisions: final.contexts.map((c) => ({ id: c.id, revision: c.expectedRevision! })),
			rubricImported: input.rubric !== undefined,
			editorPath: '/enseignant/modules/' + final.id
		};
		await tx
			.insert(agentImports)
			.values({ teacherId, requestId: input.requestId, moduleId: final.id, fingerprint, receipt });
		return receipt;
	});
}
