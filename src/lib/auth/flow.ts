import { z } from 'zod';

export const invitationIdentitySchema = z.strictObject({
	name: z.string().min(1),
	email: z.email()
});
export type InvitationIdentity = z.infer<typeof invitationIdentitySchema>;
export type AccessMode = 'sign-in' | 'activation';
export interface AuthIssue {
	title: string;
	description: string;
	retry: boolean;
}

export class InvitationPreparationError extends Error {
	constructor(readonly status: number) {
		super('Invitation preparation failed.');
	}
}

export function readInvitationToken(hash: string) {
	return /^#(?:token=)?([a-f0-9]{64})$/.exec(hash)?.[1];
}

// Provider error text can contain implementation details. Only fixed, safe UI copy is returned.
export function authIssue(cause: unknown, mode: AccessMode): AuthIssue {
	const error = cause && typeof cause === 'object' ? cause : {};
	const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
	const status = 'status' in error && typeof error.status === 'number' ? error.status : 0;
	const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
	if (
		[
			'AUTH_CANCELLED',
			'REGISTRATION_CANCELLED',
			'ERROR_CEREMONY_ABORTED',
			'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
			'ERROR_AUTHENTICATOR_GENERAL_ERROR'
		].includes(code) ||
		['NotAllowedError', 'AbortError'].includes(name)
	)
		return {
			title: 'Demande interrompue',
			description: 'La demande a été annulée ou a expiré. Vous pouvez réessayer.',
			retry: true
		};
	if (status === 429)
		return {
			title: 'Patientez un instant',
			description: 'Trop de tentatives ont été effectuées. Attendez une minute avant de réessayer.',
			retry: true
		};
	if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED')
		return {
			title: 'Cette clé existe déjà',
			description:
				'Connectez-vous avec cette clé ou choisissez un autre emplacement pour en créer une.',
			retry: true
		};
	if (code.includes('NOT_SUPPORTED') || name === 'NotSupportedError')
		return {
			title: 'Clé d’accès indisponible',
			description: 'Ouvrez Coursely dans un navigateur compatible avec les clés d’accès.',
			retry: false
		};
	if (mode === 'activation' && [400, 403, 404, 410].includes(status))
		return {
			title: 'Invitation indisponible',
			description:
				'Ce lien est invalide, a expiré ou a déjà été utilisé. Ouvrez une nouvelle invitation, ou connectez-vous si votre clé est déjà créée.',
			retry: false
		};
	if (status >= 500 || !status)
		return {
			title: 'Connexion indisponible',
			description: 'Coursely ne peut pas vous connecter pour le moment. Réessayez dans un instant.',
			retry: true
		};
	return {
		title: 'Connexion non aboutie',
		description:
			'La clé n’a pas permis de vous connecter. Réessayez ou choisissez une autre clé d’accès.',
		retry: true
	};
}
