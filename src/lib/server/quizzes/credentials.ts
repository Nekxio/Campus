import { idSchema } from '../../domain/contracts.js';

export const issueQuizCredential = (participantId: string): string => {
	idSchema.parse(participantId);
	const secret = crypto.getRandomValues(new Uint8Array(32));
	return participantId + '.' + Array.from(secret, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const readQuizCredential = (value: string | undefined) => {
	if (!value || value.length !== 101) return null;
	const [participantId, secret] = value.split('.');
	if (!idSchema.safeParse(participantId).success || !/^[a-f0-9]{64}$/.test(secret ?? '')) return null;
	return { participantId, secret };
};

export const hashQuizCredential = async (runId: string, value: string): Promise<string> => {
	idSchema.parse(runId);
	if (!readQuizCredential(value)) throw new Error('Invalid quiz credential.');
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(runId + ':' + value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};
