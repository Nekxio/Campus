import { z } from 'zod';

export const mcpScopes = [
	'modules:read',
	'modules:create',
	'modules:update',
	'modules:rubric',
	'corrections:read',
	'corrections:propose',
	'quizzes:read',
	'quizzes:write',
	'roster:manage',
	'roster:update',
	'roster:delete',
	'grades:read',
	'grades:write',
	'publications:write',
	'annual:read',
	'annual:write',
	'annual:purge',
	'calendar:read',
	'calendar:write',
	'quizzes:review',
	'offline_access'
] as const;
export type McpScope = (typeof mcpScopes)[number];
export const isMcpScope = (value: string): value is McpScope => mcpScopes.some((scope) => scope === value);
export const isStudentDataScope = (scope: McpScope) =>
	scope.startsWith('roster:') ||
	scope.startsWith('corrections:') ||
	scope.startsWith('grades:') ||
	scope.startsWith('annual:');
export const defaultMcpScopes = (scopes: readonly McpScope[]) => [...new Set(scopes)];
const scopeGroups: { id: string; title: string; scopes: McpScope[] }[] = [
	{
		id: 'modules',
		title: 'Modules et barèmes',
		scopes: ['modules:read', 'modules:create', 'modules:update', 'modules:rubric']
	},
	{ id: 'quizzes', title: 'Quiz', scopes: ['quizzes:read', 'quizzes:write', 'quizzes:review'] },
	{
		id: 'roster',
		title: 'Classes et étudiants',
		scopes: ['roster:manage', 'roster:update', 'roster:delete']
	},
	{
		id: 'grading',
		title: 'Notes et corrections',
		scopes: ['grades:read', 'grades:write', 'corrections:read', 'corrections:propose']
	},
	{ id: 'publication', title: 'Publication', scopes: ['publications:write'] },
	{ id: 'annual', title: 'Années scolaires', scopes: ['annual:read', 'annual:write', 'annual:purge'] },
	{ id: 'calendar', title: 'Calendrier', scopes: ['calendar:read', 'calendar:write'] },
	{ id: 'connection', title: 'Connexion', scopes: ['offline_access'] }
];
const scopeNotices: Partial<Record<McpScope, string>> = {
	'roster:delete': 'Suppression d’étudiants',
	'publications:write': 'Publication et dépublication',
	'annual:purge': 'Purge des données annuelles'
};
export const groupMcpScopes = (requested: readonly McpScope[]) =>
	scopeGroups.flatMap((group) => {
		const scopes = group.scopes.filter((scope) => requested.includes(scope));
		return scopes.length
			? [
					{
						...group,
						scopes,
						notice: scopes
							.map((scope) => scopeNotices[scope])
							.filter(Boolean)
							.join(' · ')
					}
				]
			: [];
	});
export const scopeDetails: Record<McpScope, { title: string; description: string }> = {
	'modules:read': {
		title: 'Lire mes modules et barèmes',
		description: 'Accès aux contenus et aux classes, sans étudiants ni notes.'
	},
	'modules:create': {
		title: 'Créer des brouillons',
		description: 'Les nouveaux modules restent à relire.'
	},
	'modules:update': {
		title: 'Modifier les brouillons',
		description: 'Les changements restent privés jusqu’à votre publication.'
	},
	'modules:rubric': {
		title: 'Modifier les barèmes',
		description: 'Les points déjà enregistrés sont conservés, même si un maximum change.'
	},
	'corrections:read': {
		title: 'Lire les corrections sélectionnées',
		description: 'Accès à la liste de la classe et aux résultats de l’étudiant sélectionné.'
	},
	'corrections:propose': {
		title: 'Proposer des corrections',
		description: 'Les propositions restent privées et attendent votre décision.'
	},
	'quizzes:read': {
		title: 'Lire mes quiz',
		description: 'Accès aux questions, bonnes réponses, séances et lignes de barème, sans élèves ni notes.'
	},
	'quizzes:write': {
		title: 'Préparer mes quiz',
		description: 'Créer et modifier des quiz privés à relire, sans ouvrir de salle ni écrire de notes.'
	},
	'roster:manage': {
		title: 'Gérer mes classes et étudiants',
		description:
			'Lire une liste de classe, créer des classes et ajouter des étudiants. Aucun accès aux notes ni suppression.'
	},
	'roster:update': {
		title: 'Modifier les classes et étudiants',
		description: 'Renommer les classes et étudiants et rattacher ou copier des modules.'
	},
	'roster:delete': {
		title: 'Supprimer des étudiants',
		description: 'Supprimer un étudiant et ses données associées, avec confirmation explicite.'
	},
	'grades:read': {
		title: 'Lire les notes et exports',
		description: 'Lire les grilles complètes, commentaires, propositions et données des PDF finaux.'
	},
	'grades:write': {
		title: 'Enregistrer les notes et commentaires',
		description: 'Modifier les corrections enregistrées et décider des propositions privées.'
	},
	'publications:write': {
		title: 'Publier et dépublier les modules',
		description: 'Appliquer une décision explicite après lecture de l’aperçu et des révisions.'
	},
	'annual:read': {
		title: 'Lire les dossiers annuels',
		description: 'Consulter les bilans, historiques et aperçus de clôture des années scolaires.'
	},
	'annual:write': {
		title: 'Archiver et rouvrir les années',
		description: 'Appliquer une décision sur le dossier annuel vérifié.'
	},
	'annual:purge': {
		title: 'Clôturer et purger une année',
		description:
			'Effacer les données annuelles après confirmation de l’année, des PDF conservés et du devenir de chaque module.'
	},
	'calendar:read': {
		title: 'Lire le calendrier pédagogique',
		description: 'Consulter les associations et événements du calendrier, sans son URL privée.'
	},
	'calendar:write': {
		title: 'Gérer le calendrier pédagogique',
		description: 'Prévisualiser, connecter, synchroniser ou déconnecter un calendrier externe.'
	},
	'quizzes:review': {
		title: 'Valider les quiz préparés',
		description: 'Enregistrer un quiz relu et lever son état à vérifier.'
	},
	offline_access: {
		title: 'Renouveler la connexion',
		description: 'Pendant votre session, au maximum 8 heures.'
	}
};
export const consentDecisionSchema = z
	.strictObject({
		oauthQuery: z.string().min(1).max(12000),
		accept: z.boolean(),
		scopes: z.array(z.enum(mcpScopes)).min(1).max(mcpScopes.length)
	})
	.superRefine((value, context) => {
		if (value.accept && value.scopes.includes('corrections:propose') && !value.scopes.includes('corrections:read'))
			context.addIssue({
				code: 'custom',
				path: ['scopes'],
				message: 'La proposition nécessite la lecture des corrections.'
			});
		if (value.accept && value.scopes.includes('quizzes:write') && !value.scopes.includes('quizzes:read'))
			context.addIssue({
				code: 'custom',
				path: ['scopes'],
				message: 'La préparation nécessite la lecture des quiz.'
			});
	});
export type ConsentDecision = z.infer<typeof consentDecisionSchema>;
export const revokeConsentSchema = z.strictObject({
	id: z.string().min(1).max(128),
	reviewedVersion: z.string().min(1).max(1024)
});
export type RevokeConsent = z.infer<typeof revokeConsentSchema>;
