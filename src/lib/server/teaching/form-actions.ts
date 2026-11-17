import { error, fail, isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { superValidate, type SuperValidated } from 'sveltekit-superforms/server';
import { zod4, type Infer, type InferIn } from 'sveltekit-superforms/adapters';
import type { z } from 'zod';
import { requireTeacher } from '../auth/access.js';
import { isSameOriginFormRequest } from '../auth/csrf.js';
import { withBoundedAuthRequest } from '../auth/request-body.js';

const errorFields = (errors: unknown, prefix = ''): Record<string, string> => {
	if (Array.isArray(errors)) {
		if (errors.every((value) => typeof value === 'string')) return { [prefix]: errors.join(' ') };
	}
	if (!errors || typeof errors !== 'object') return {};
	return Object.assign(
		{},
		...Object.entries(errors).map(([key, value]) =>
			errorFields(value, key === '_errors' ? prefix : prefix ? `${prefix}.${key}` : key)
		)
	);
};

export const teacherFormAction =
	<S extends z.ZodType<Record<string, unknown>>, R>(
		schema: S,
		operation: (input: Infer<S, 'zod4'>, event: RequestEvent) => Promise<R>,
		options: {
			id?: string;
			maxBytes?: number;
			native?: boolean;
			sanitizeForm?: (data: Infer<S, 'zod4'>) => void;
		} = {}
	) =>
	async (event: RequestEvent) => {
		const adapter = zod4(schema);
		let form: SuperValidated<Infer<S, 'zod4'>, string, InferIn<S, 'zod4'>> | undefined;
		const returnedForm = () => {
			if (form) options.sanitizeForm?.(form.data);
			return form;
		};
		try {
			event.setHeaders?.({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex, nofollow' });
			requireTeacher(event.locals);
			if (!isSameOriginFormRequest(event.request, event.url)) error(403, 'Origine de la requête refusée.');
			const type = event.request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
			if (type !== 'multipart/form-data' && type !== 'application/x-www-form-urlencoded')
				error(415, 'Formulaire requis.');
			const data = await withBoundedAuthRequest(event.request, options.maxBytes ?? 256000, async (request) => {
				try {
					return await request.formData();
				} catch {
					error(400, 'Formulaire invalide.');
				}
			});
			const properties = adapter.jsonSchema.properties ?? {};
			for (const key of new Set(data.keys())) {
				const values = data.getAll(key);
				if (values.some((value) => typeof value !== 'string')) error(400, 'Les fichiers ne sont pas acceptés.');
				if (key === '__superform_id') {
					if (values.length !== 1 || String(values[0]).length > 256) error(400, 'Identifiant de formulaire invalide.');
					continue;
				}
				if (!options.native) {
					if (key !== '__superform_json') error(400, 'Commande de formulaire invalide.');
					continue;
				}
				const property = properties[key];
				if (!property || typeof property === 'boolean') error(400, 'Champ de formulaire inconnu.');
				if (property.type !== 'array' && values.length !== 1) error(400, 'Champ de formulaire répété.');
				if (property.type === 'boolean' && values.some((value) => value !== 'true' && value !== 'false'))
					error(400, 'Valeur de formulaire invalide.');
			}
			if (!options.native) {
				try {
					const serialized = data.getAll('__superform_json').join('');
					if (!Array.isArray(JSON.parse(serialized))) error(400, 'Commande de formulaire invalide.');
				} catch {
					error(400, 'Commande de formulaire invalide.');
				}
			}
			form = await superValidate(data, adapter, {
				strict: true,
				allowFiles: false,
				...(options.id ? { id: options.id } : {})
			});
			if (!form.valid)
				return fail(422, {
					form: returnedForm(),
					message: 'Vérifiez les champs signalés.',
					fields: errorFields(form.errors)
				});
			const receipt = await operation(form.data, event);
			return { form: returnedForm(), receipt };
		} catch (cause) {
			if (isRedirect(cause)) throw cause;
			return fail(isHttpError(cause) ? cause.status : 503, {
				form: returnedForm(),
				message: isHttpError(cause)
					? cause.body.message
					: 'Enregistrement indisponible. Vos saisies sont conservées ; réessayez.',
				fields: {}
			});
		}
	};
