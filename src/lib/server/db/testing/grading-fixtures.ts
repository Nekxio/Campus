import type { Database } from '../index.js';
import { eq } from 'drizzle-orm';
import * as tables from '../schema.js';
import { seedFoundationFixtures } from './fixtures.js';
import { getRubric, replaceRubric, saveCorrection, saveSemesterComment } from '../../teaching/grading.js';
import type { RubricAssessment } from '../../../domain/grading.js';

// Isolated fictional demo only. The CLI creates a new local database before calling this.
export async function seedGradingFixtures(db: Database) {
	const ids = await seedFoundationFixtures(db);
	const names = [
		'Aline Moreau',
		'Camille Demo',
		'Noé Petit',
		'Inès Durand',
		'Hugo Martin',
		'Léa Bernard',
		'Adam Caron',
		'Jade Laurent',
		'Maël Rivière',
		'Sarah Lopez',
		'Émile Roux',
		'Zoé Dupont'
	];
	for (const [index, id] of ids.students.entries())
		await db.update(tables.students).set({ name: names[index] }).where(eq(tables.students.id, id));
	await db.update(tables.modules).set({ title: 'Application web · démo' }).where(eq(tables.modules.id, ids.module));
	await db
		.update(tables.modules)
		.set({ title: 'Dossiers professionnels · démo' })
		.where(eq(tables.modules.id, ids.secondModule));
	const groupId = crypto.randomUUID(),
		qualityId = crypto.randomUUID(),
		deliveryId = crypto.randomUUID();
	const project: RubricAssessment = {
		id: ids.project,
		title: 'Projet',
		kind: 'project',
		purpose: 'graded',
		groups: [
			{ id: groupId, title: 'Fonctionnalités' },
			{ id: qualityId, title: 'Qualité' },
			{ id: deliveryId, title: 'Livraison' }
		],
		lines: [
			...[
				'Navigation',
				'Catalogue',
				'Recherche',
				'Filtres',
				'Authentification',
				'Validation',
				'Persistance',
				'Gestion des erreurs'
			].map((label, index) => ({
				id: index === 0 ? ids.firstLine : crypto.randomUUID(),
				groupId,
				label,
				description: [
					'Parcours cohérent et liens utilisables',
					'Liste et fiches des éléments',
					'Résultats pertinents et état vide',
					'Combinaison et remise à zéro',
					'Connexion et accès protégés',
					'Contrôles des données saisies',
					'Données conservées après rechargement',
					'Messages et reprise après échec'
				][index],
				maxPoints: 5
			})),
			...['Lisibilité', 'Architecture', 'Tests'].map((label) => ({
				id: crypto.randomUUID(),
				groupId: qualityId,
				label,
				description: '',
				maxPoints: 10
			})),
			...['Dépôt', 'Documentation', 'Déploiement'].map((label) => ({
				id: crypto.randomUUID(),
				groupId: deliveryId,
				label,
				description: '',
				maxPoints: 10
			}))
		]
	};
	function total(id: string, title: string, maximum: number, kind: RubricAssessment['kind']): RubricAssessment {
		const groupId = crypto.randomUUID();
		return {
			id,
			title,
			kind,
			purpose: 'graded',
			groups: [{ id: groupId, title: 'Points' }],
			lines: [
				{
					id: crypto.randomUUID(),
					groupId,
					label: 'Total de points',
					description: '',
					maxPoints: maximum
				}
			]
		};
	}
	let rubric = await getRubric(db, ids.module);
	rubric = await replaceRubric(db, ids.module, {
		expectedRevision: rubric.module.revision,
		assessments: [total(ids.quiz, 'Quiz', 15, 'quiz'), project, total(ids.oral, 'Soutenance', 120, 'oral')],
		results: [
			{
				id: rubric.results[0].id,
				title: 'Note finale',
				rule: {
					kind: 'weighted',
					components: [
						{ assessmentIds: [ids.quiz], weight: 15 },
						{ assessmentIds: [ids.project], weight: 25 },
						{ assessmentIds: [ids.oral], weight: 60 }
					]
				}
			}
		],
		contexts: rubric.contexts.map((c) => ({
			id: c.id,
			expectedRevision: c.expectedRevision,
			deadlines: [
				{
					assessmentId: ids.project,
					dueAt: '2026-10-10T21:59:00Z',
					submissionInstructions: 'Remettre le lien du dépôt GitHub.'
				}
			]
		}))
	});
	for (const [index, studentId] of ids.students.entries()) {
		if (index === 8 || index === 11) continue;
		for (const a of rubric.assessments) {
			const absent =
				index === 2 && a.id === ids.oral
					? 'absent_justified'
					: index === 9 && a.id === ids.oral
						? 'absent_unjustified'
						: null;
			const projectPoints = [4, 5, 4, 3, 5, 4, 4, 3, 8, 7, 7, 9, 9, 8];
			await saveCorrection(db, ids.currentContext, studentId, a.id, {
				expectedRevision: index === 0 && a.id === ids.project ? 1 : 0,
				rubricRevision: rubric.module.revision,
				status: absent ?? 'graded',
				submissionUrl: a.kind === 'project' ? 'https://example.test/fictional-submission' : null,
				submittedAt: a.kind === 'project' ? '2026-10-12T07:10:00Z' : null,
				latenessDecision: 'automatic',
				scores: a.lines.map((line, i) => ({
					lineId: line.id,
					points: absent
						? null
						: a.kind === 'project'
							? Math.max(0, Math.min(line.maxPoints, projectPoints[i] - (index % 3)))
							: a.kind === 'quiz'
								? 11
								: 90
				}))
			});
		}
	}
	await saveSemesterComment(db, ids.currentContext, ids.students[0], {
		expectedRevision: 0,
		content: 'Les fonctionnalités sont bien maîtrisées. Poursuivre le travail sur les tests et la gestion des erreurs.'
	});
	const independent = await getRubric(db, ids.secondModule);
	const dossiers = [
		total(crypto.randomUUID(), 'Dossier 1', 60, 'other'),
		total(crypto.randomUUID(), 'Dossier 2', 80, 'other')
	];
	await replaceRubric(db, ids.secondModule, {
		expectedRevision: independent.module.revision,
		assessments: dossiers,
		results: dossiers.map((a) => ({
			id: crypto.randomUUID(),
			title: a.title,
			rule: { kind: 'points_ratio', assessmentIds: [a.id] }
		})),
		contexts: independent.contexts.map(({ id, expectedRevision }) => ({
			id,
			expectedRevision,
			deadlines: []
		}))
	});
	return ids;
}
