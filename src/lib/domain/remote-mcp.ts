import { z } from 'zod';

export const mcpScopes = [
	'modules:read',
	'modules:create',
	'modules:update',
	'modules:rubric',
	'corrections:read',
	'corrections:propose',
	'offline_access'
] as const;
export type McpScope = (typeof mcpScopes)[number];
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
		if (
			value.accept &&
			value.scopes.includes('corrections:propose') &&
			!value.scopes.includes('corrections:read')
		)
			context.addIssue({
				code: 'custom',
				path: ['scopes'],
				message: 'La proposition nécessite la lecture des corrections.'
			});
	});
export type ConsentDecision = z.infer<typeof consentDecisionSchema>;
export const revokeConsentSchema = z.strictObject({
	id: z.string().min(1).max(128),
	reviewedVersion: z.string().min(1).max(1024)
});
export type RevokeConsent = z.infer<typeof revokeConsentSchema>;
