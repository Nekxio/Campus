import { error, isHttpError, json, type RequestEvent } from '@sveltejs/kit';
import type { z } from 'zod';
import type { Database } from '../db/index.js';
import { requireTeacher } from '../auth/access.js';
import { withTeacherDatabase } from './database.js';
import { idSchema } from '../../domain/contracts.js';
import { validationFields } from '../../domain/teaching.js';
const MAX_BODY = 256000;
export function teachingId(value: string | undefined) {
	const parsed = idSchema.safeParse(value);
	if (!parsed.success) error(404, 'Élément introuvable.');
	return parsed.data;
}
export async function readTeachingJson(request: Request) {
	if (
		request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
	)
		error(415, 'Envoyez des données JSON.');
	if (Number(request.headers.get('content-length')) > MAX_BODY)
		error(413, 'La saisie est trop volumineuse.');
	if (!request.body) error(400, 'Saisie manquante.');
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_BODY) {
				await reader.cancel();
				error(413, 'La saisie est trop volumineuse.');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
	} catch {
		error(400, 'Saisie JSON invalide.');
	}
}
export function teachingEndpoint<S extends z.ZodType>(
	schema: S,
	operation: (db: Database, input: z.output<S>, event: RequestEvent) => Promise<unknown>
) {
	return async (event: RequestEvent) => {
		try {
			requireTeacher(event.locals);
			if (event.request.headers.get('origin') !== event.url.origin)
				error(403, 'Origine de la requête refusée.');
			const parsed = schema.safeParse(await readTeachingJson(event.request));
			if (!parsed.success)
				return json(
					{ message: 'Vérifiez les champs signalés.', fields: validationFields(parsed.error) },
					{ status: 422 }
				);
			return json(
				await withTeacherDatabase(event.locals, (db) => operation(db, parsed.data, event))
			);
		} catch (cause) {
			if (isHttpError(cause))
				return json({ message: cause.body.message }, { status: cause.status });
			return json(
				{ message: 'Enregistrement indisponible. Vos saisies sont conservées ; réessayez.' },
				{ status: 503 }
			);
		}
	};
}
