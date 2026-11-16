import type { Database } from '../index.js';
import { seedProposalFixtures } from './proposal-fixtures.js';
import { createModule, getModule, updateModule } from '../../teaching/service.js';
import { getRubric, replaceRubric } from '../../teaching/grading.js';
import { decidePublication, getPublicationReview } from '../../teaching/publications.js';
import { editableModule } from '../../../teaching/types.js';

// New local fictional database only; the existing grading/proposal examples remain intact.
export async function seedPublicationFixtures(db: Database) {
	const ids = await seedProposalFixtures(db);
	const contextId = crypto.randomUUID();
	const module = await createModule(db, {
		title: 'Application web · publication démo',
		description:
			'Construire une application web accessible à partir d’un brief, puis expliquer ses choix de conception et de développement. Exemple fictif.',
		objectives: [],
		sourcePath: '/fictional/private/module-folder',
		preparation: {
			framing: 'Préparation privée fictive. À ne pas publier.',
			nextSteps: 'Vérifier le prochain support.',
			sourceLinks: []
		},
		resources: [
			{
				id: crypto.randomUUID(),
				label: 'Diaporama du module · démo',
				url: 'https://example.test/course.pdf',
				kind: 'course'
			},
			{
				id: crypto.randomUUID(),
				label: 'Consigne du projet · démo',
				url: 'https://example.test/assignment.pdf',
				kind: 'instructions'
			},
			{
				id: crypto.randomUUID(),
				label: 'Barème du projet · démo',
				url: 'https://example.test/rubric.pdf',
				kind: 'rubric'
			},
			{
				id: crypto.randomUUID(),
				label: 'Documentation Svelte',
				url: 'https://svelte.dev/docs',
				kind: 'resource'
			}
		],
		contexts: [
			{
				id: contextId,
				classId: ids.currentClass,
				lessons: [
					{
						id: crypto.randomUUID(),
						title: 'Du brief à la navigation',
						startsAt: '2026-10-12T07:00:00Z',
						endsAt: '2026-10-12T10:00:00Z',
						recap: 'Nous avons travaillé le brief, les parcours et la structure de l’application.',
						toDo: 'Vérifier les parcours au clavier et préparer une première version fonctionnelle.'
					}
				]
			}
		]
	});
	const assessmentId = crypto.randomUUID(),
		groupId = crypto.randomUUID();
	const rubric = await getRubric(db, module.id);
	await replaceRubric(db, module.id, {
		expectedRevision: rubric.module.revision,
		assessments: [
			{
				id: assessmentId,
				title: 'Projet',
				kind: 'project',
				purpose: 'graded',
				groups: [{ id: groupId, title: 'Projet' }],
				lines: [
					{
						id: crypto.randomUUID(),
						groupId,
						label: 'Projet',
						description: 'Résultat fictif du projet',
						maxPoints: 20
					}
				]
			}
		],
		results: [
			{
				id: crypto.randomUUID(),
				title: 'Note du module',
				rule: { kind: 'points_ratio', assessmentIds: [assessmentId] }
			}
		],
		contexts: [
			{
				id: contextId,
				expectedRevision: rubric.contexts[0].expectedRevision,
				deadlines: [
					{
						assessmentId,
						dueAt: '2026-10-27T22:59:00Z',
						submissionInstructions:
							'Déposez le lien du dépôt GitHub dans le devoir Teams. Consultez la consigne pour les livrables attendus.'
					}
				]
			}
		]
	});
	const selected = (await getPublicationReview(db, module.id, contextId)).selected!;
	await decidePublication(db, ids.teacher, module.id, {
		requestId: crypto.randomUUID(),
		contextId,
		action: 'publish',
		expectedRevision: 0,
		moduleRevision: selected.moduleRevision,
		contextRevision: selected.contextRevision,
		classRevision: selected.classRevision,
		confirm: true
	});
	const saved = await getModule(db, module.id);
	const draft = editableModule(saved);
	draft.resources[0].url = 'https://example.test/course-version-2.pdf';
	await updateModule(db, module.id, { ...draft, expectedRevision: saved.revision });
	return { ...ids, publicationModule: module.id, publicationContext: contextId };
}
