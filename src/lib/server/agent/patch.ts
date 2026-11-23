import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { agentImports, modules } from '../db/schema.js';
import { getModule, updateModule } from '../teaching/service.js';
import { getRubric, replaceRubric } from '../teaching/grading.js';
import { editableModule } from '../../teaching/types.js';
import { moduleUpdateSchema } from '../../domain/teaching.js';
import { rubricAssessmentSchema, rubricUpdateSchema } from '../../domain/grading.js';
import { importFingerprint, type ImportReceipt } from '../../domain/module-import.js';
import {
	mergeByKey,
	mergeIdentified,
	patchModuleImportSchema,
	type ModulePatchImport
} from '../../domain/module-patch.js';
import { emptyStudentContent } from '../../domain/pedagogy.js';
import type { z } from 'zod';
import { sectionPointsRule } from '../../domain/rubric-points.js';

function checked<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
	const parsed = schema.safeParse(value);
	if (!parsed.success)
		error(
			422,
			'La modification laisse un élément incomplet ou une référence invalide. Les données précédentes sont conservées.'
		);
	return parsed.data;
}

export async function patchModule(
	db: Pick<Database, 'transaction'>,
	teacherId: string,
	value: ModulePatchImport
): Promise<ImportReceipt> {
	const input = patchModuleImportSchema.parse(value);
	const fingerprint = await importFingerprint({ action: 'patch', input });
	return db.transaction(async (tx) => {
		const [replay] = await tx
			.select()
			.from(agentImports)
			.where(and(eq(agentImports.teacherId, teacherId), eq(agentImports.requestId, input.requestId)));
		if (replay) {
			if (replay.teacherId !== teacherId || replay.fingerprint !== fingerprint)
				error(409, 'Cette demande a déjà servi pour un autre contenu.');
			return replay.receipt;
		}
		const original = await getModule(tx, input.moduleId);
		const patch = input.patch;
		const remove = input.remove ?? {};
		const previousRubric = Object.keys(remove).some((key) =>
			['assessments', 'groups', 'lines', 'results', 'deadlineAssessments'].includes(key)
		)
			? await getRubric(tx, input.moduleId)
			: undefined;
		const removable = {
			resources: original.resources.map((item) => item.id),
			lessons: original.contexts.flatMap((item) => item.lessons.map((lesson) => lesson.id)),
			exercises: original.studentContent?.exercises.map((item) => item.id) ?? [],
			dossiers: original.studentContent?.dossiers?.map((item) => item.assessmentId) ?? [],
			assessments: previousRubric?.assessments.map((item) => item.id) ?? [],
			groups: previousRubric?.assessments.flatMap((item) => item.groups.map((group) => group.id)) ?? [],
			lines: previousRubric?.assessments.flatMap((item) => item.lines.map((line) => line.id)) ?? [],
			results: previousRubric?.results.map((item) => item.id) ?? [],
			deadlineAssessments:
				previousRubric?.contexts.flatMap((item) => item.deadlines.map((deadline) => deadline.assessmentId)) ?? []
		};
		for (const key of Object.keys(remove) as (keyof typeof removable)[]) {
			if (remove[key]?.some((id) => !removable[key].includes(id)))
				error(422, 'Une suppression ne correspond plus à ce module. Relisez son état avant de reprendre.');
		}
		const content = original.studentContent ?? emptyStudentContent();
		const draft = checked(moduleUpdateSchema, {
			...editableModule(original),
			...patch,
			expectedRevision: input.expectedRevision,
			preparation: { ...original.preparation, ...patch.preparation },
			studentContent: {
				...content,
				...patch.studentContent,
				dossiers:
					patch.studentContent?.dossiers || remove.dossiers
						? mergeByKey('assessmentId', content.dossiers ?? [], patch.studentContent?.dossiers, remove.dossiers)
						: content.dossiers,
				exercises: mergeIdentified(content.exercises, patch.studentContent?.exercises, remove.exercises)
			},
			resources: mergeIdentified(original.resources, patch.resources, remove.resources),
			contexts: mergeIdentified(original.contexts, patch.contexts).map((context) => ({
				...context,
				lessons: mergeIdentified(
					original.contexts.find((old) => old.id === context.id)?.lessons ?? [],
					patch.contexts?.find((item) => item.id === context.id)?.lessons,
					remove.lessons
				)
			}))
		});
		const changesRubric = Boolean(
			input.rubric ||
			remove.assessments ||
			remove.groups ||
			remove.lines ||
			remove.results ||
			remove.deadlineAssessments
		);
		const rubricOnly =
			changesRubric &&
			Object.keys(patch).length === 0 &&
			!remove.resources &&
			!remove.lessons &&
			!remove.exercises &&
			!remove.dossiers;
		const saved = rubricOnly ? original : await updateModule(tx, input.moduleId, draft, input.rubric?.assessments);
		if (changesRubric) {
			const current = await getRubric(tx, saved.id);
			const update = input.rubric;
			if (update?.contexts?.some((context) => !current.contexts.some((item) => item.id === context.id)))
				error(422, 'Un contexte du barème ne correspond pas à ce module actif.');
			const assessments = checked(
				rubricAssessmentSchema.array(),
				mergeIdentified(current.assessments, update?.assessments, remove.assessments).map((assessment) => {
					const old = current.assessments.find((item) => item.id === assessment.id);
					const change = update?.assessments?.find((item) => item.id === assessment.id);
					return {
						...assessment,
						groups: mergeIdentified(old?.groups ?? [], change?.groups, remove.groups),
						lines: mergeIdentified(old?.lines ?? [], change?.lines, remove.lines)
					};
				})
			);
			await replaceRubric(
				tx,
				saved.id,
				checked(rubricUpdateSchema, {
					expectedRevision: rubricOnly ? input.expectedRevision : saved.revision,
					assessments,
					results: mergeIdentified(current.results, update?.results, remove.results).map((result) => {
						// An omitted rule retains section authoring: its weights follow the edited maxima.
						// A supplied rule remains an explicit replacement and is validated as submitted.
						if (
							!result.rule ||
							result.rule.kind !== 'weighted' ||
							!result.rule.sectionPoints ||
							update?.results?.find((item) => item.id === result.id)?.rule
						)
							return result;
						return {
							...result,
							rule: sectionPointsRule(
								assessments,
								result.rule.sectionPoints.quizMaxima.filter((maximum) =>
									assessments.some(
										(item) => item.id === maximum.assessmentId && item.kind === 'quiz' && item.purpose === 'graded'
									)
								)
							)
						};
					}),
					contexts: current.contexts.map((context) => ({
						id: context.id,
						expectedRevision: context.expectedRevision,
						deadlines: [
							...context.deadlines.filter(
								(deadline) =>
									!remove.deadlineAssessments?.includes(deadline.assessmentId) &&
									!update?.contexts
										?.find((item) => item.id === context.id)
										?.deadlines?.some((item) => item.assessmentId === deadline.assessmentId)
							),
							...(update?.contexts?.find((item) => item.id === context.id)?.deadlines ?? [])
						]
					}))
				})
			);
		}
		const changes = [
			...(patch.title !== undefined || patch.description !== undefined || patch.objectives !== undefined
				? ['Informations du module modifiées']
				: []),
			...(patch.preparation ? ['Préparation privée modifiée'] : []),
			...(patch.resources || remove.resources ? ['Liens étudiants modifiés'] : []),
			...(patch.studentContent || remove.exercises || remove.dossiers
				? ['Consignes ou exercices publics modifiés']
				: []),
			...(patch.contexts || remove.lessons ? ['Planning modifié'] : []),
			...(input.rubric || remove.assessments || remove.lines || remove.groups || remove.results
				? ['Grille ou calculs modifiés']
				: [])
		];
		await tx
			.update(modules)
			.set({
				needsReview: true,
				agentChanges: [...new Set([...(original.agentChanges ?? []), ...changes])]
			})
			.where(eq(modules.id, saved.id));
		const final = await getModule(tx, saved.id);
		const receipt: ImportReceipt = {
			version: 1,
			action: 'update',
			requestId: input.requestId,
			moduleId: final.id,
			revision: final.revision,
			contextRevisions: final.contexts.map((context) => ({
				id: context.id,
				revision: context.expectedRevision!
			})),
			rubricImported: !!input.rubric,
			editorPath: '/enseignant/modules/' + final.id
		};
		await tx
			.insert(agentImports)
			.values({ teacherId, requestId: input.requestId, fingerprint, moduleId: final.id, receipt });
		return receipt;
	});
}
