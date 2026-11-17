import type { ActionResult } from '$app/forms';
import type { SuperForm } from 'sveltekit-superforms';
import { z } from 'zod';
import { TeachingRequestError } from './api.js';

const failureSchema = z.object({ message: z.string(), fields: z.record(z.string(), z.string()).optional() });

export const decodeFormAction = <T>(result: ActionResult, decode: (value: unknown) => T): T => {
	if (!result || !['success', 'failure', 'redirect', 'error'].includes(result.type))
		throw new TeachingRequestError(0, 'Réponse indisponible. Vos saisies sont conservées ; réessayez.');
	if (result.type === 'failure') {
		const failure = failureSchema.safeParse(result.data);
		throw new TeachingRequestError(
			result.status,
			failure.success ? failure.data.message : 'Enregistrement non confirmé. Réessayez.',
			failure.success ? failure.data.fields : {},
			failure.success
		);
	}
	if (result.type === 'error')
		throw new TeachingRequestError(
			result.status ?? 0,
			'Connexion interrompue. Vos saisies sont conservées ; réessayez.'
		);
	try {
		return decode(result.type === 'redirect' ? { url: result.location } : result.data?.receipt);
	} catch {
		throw new TeachingRequestError(result.status, 'Réponse indisponible. Vos saisies sont conservées ; réessayez.');
	}
};

// Existing handlers own command capture, retries and draft reconciliation. Only the
// queued submission re-enters the native form so Superforms performs the transport.
export const createFormActionTransport = <T extends Record<string, unknown>, M>(form: SuperForm<T, M>) => {
	let element: HTMLFormElement | undefined;
	let queued:
		| {
				element: HTMLFormElement;
				command: Record<string, unknown>;
				resolve: (value: ActionResult) => void;
				reject: (cause: unknown) => void;
		  }
		| undefined;
	let submitting = false;
	const enhance = (node: HTMLFormElement) => {
		element = node;
		node.enctype = 'multipart/form-data';
		node.dataset.enhanced = 'true';
		const enhanced = form.enhance(node, {
			onSubmit: (submission) => {
				const { formData, jsonData, validators, cancel } = submission;
				if (!queued || queued.element !== node) {
					cancel();
					return;
				}
				validators(false);
				for (const key of [...formData.keys()]) formData.delete(key);
				if (form.options.dataType === 'json') {
					jsonData(queued.command);
				} else {
					for (const [key, value] of Object.entries(queued.command)) {
						for (const item of Array.isArray(value) ? value : [value]) {
							if (item !== undefined && item !== null) formData.append(key, String(item));
						}
					}
				}
			},
			onResult: ({ result, formElement, cancel }) => {
				cancel();
				// Superforms shares callbacks across mounts, including for requests still in flight.
				if (element !== node || queued?.element !== formElement) return;
				const current = queued;
				queued = undefined;
				current?.resolve(result);
			},
			onError: () => {
				if (queued?.element !== node) return;
				const current = queued;
				queued = undefined;
				current?.reject(new TeachingRequestError(0, 'Connexion interrompue. Vos saisies sont conservées ; réessayez.'));
			}
		});
		return {
			destroy: () => {
				enhanced.destroy();
				delete node.dataset.enhanced;
				element = undefined;
				queued?.reject(new TeachingRequestError(0, 'Enregistrement non confirmé.'));
				queued = undefined;
			}
		};
	};
	const handleSubmit =
		<E extends SubmitEvent>(handler: (event: E) => void | Promise<void>) =>
		(event: E) => {
			if (submitting) return;
			return handler(event);
		};
	const submit = async <R>(
		path: string,
		command: Record<string, unknown>,
		decode: (value: unknown) => R
	): Promise<R> => {
		const target = element;
		if (!target || queued) throw new TeachingRequestError(0, 'Formulaire indisponible. Réessayez.');
		target.action = path;
		let rejectResult!: (cause: unknown) => void;
		const result = new Promise<ActionResult>((resolve, reject) => {
			queued = { element: target, command, resolve, reject };
			rejectResult = reject;
		});
		submitting = true;
		try {
			target.requestSubmit();
		} catch (cause) {
			rejectResult(cause);
			queued = undefined;
		} finally {
			submitting = false;
		}
		return decodeFormAction(await result, decode);
	};
	return { enhance, handleSubmit, submit };
};
