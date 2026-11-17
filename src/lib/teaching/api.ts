import { z } from 'zod';
const errorEnvelope = z.object({
	message: z.string(),
	fields: z.record(z.string(), z.string()).optional()
});

export class TeachingRequestError extends Error {
	constructor(
		public status: number,
		message: string,
		public fields: Record<string, string> = {},
		public decodedServerError = false
	) {
		super(message);
	}
}
export const saveTeaching = async <T>(
	path: string,
	body: unknown,
	method = 'POST',
	requestId: string | undefined,
	decode: (payload: unknown) => T
): Promise<T> => {
	let response: Response;
	try {
		response = await fetch(path, {
			method,
			headers: {
				'Content-Type': 'application/json',
				...(requestId ? { 'Idempotency-Key': requestId } : {})
			},
			body: JSON.stringify(body),
			credentials: 'same-origin'
		});
	} catch {
		throw new TeachingRequestError(0, 'Connexion interrompue. Vos saisies sont conservées ; réessayez.');
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new TeachingRequestError(response.status, 'Réponse indisponible. Vos saisies sont conservées ; réessayez.');
	}
	if (!response.ok) {
		const parsed = errorEnvelope.safeParse(payload);
		throw new TeachingRequestError(
			response.status,
			parsed.success ? parsed.data.message : 'Enregistrement impossible. Réessayez.',
			parsed.success ? parsed.data.fields : undefined,
			parsed.success
		);
	}
	try {
		return decode(payload);
	} catch {
		throw new TeachingRequestError(response.status, 'Réponse indisponible. Vos saisies sont conservées ; réessayez.');
	}
};
