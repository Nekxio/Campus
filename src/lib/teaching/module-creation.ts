import { moduleDetailSchema, moduleDraftSchema } from '../domain/teaching.js';
import { TeachingRequestError } from './api.js';
import type { ModuleDetail, ModuleDraft } from './types.js';

export type ModuleCreationCommand = Readonly<{ id: string; payload: ModuleDraft }>;

function freeze<T>(value: T): T {
	if (value && typeof value === 'object') {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

export function captureModuleCreation(id: string, payload: ModuleDraft): ModuleCreationCommand {
	return freeze({ id, payload: structuredClone(payload) });
}

export function retainModuleCreation(error: unknown) {
	return !(
		error instanceof TeachingRequestError &&
		error.decodedServerError &&
		[400, 413, 415, 422].includes(error.status)
	);
}

export function validateModuleDetail(value: unknown, requestedId: string): ModuleDetail {
	const parsed = moduleDetailSchema.safeParse(value);
	if (!parsed.success || parsed.data.id !== requestedId)
		throw new TeachingRequestError(
			0,
			'Réponse indisponible. Vos saisies et la tentative de création sont conservées ; réessayez.'
		);
	return parsed.data;
}

export function sameModuleDraft(current: ModuleDraft, sent: ModuleDraft) {
	const parsed = moduleDraftSchema.safeParse(current);
	return parsed.success && JSON.stringify(parsed.data) === JSON.stringify(sent);
}

export function reconcileContextRevisions<
	T extends { id: string; classId: string; expectedRevision?: number }
>(current: readonly T[], saved: ModuleDetail): T[] {
	return current.map((context) => {
		const matching = saved.contexts.find((value) => value.id === context.id);
		if (
			(matching && matching.classId !== context.classId) ||
			(!matching && saved.contexts.some((value) => value.classId === context.classId))
		)
			throw new TeachingRequestError(
				409,
				'Le rattachement de classe a changé. Vos saisies sont conservées ; rechargez la version actuelle.'
			);
		return matching ? { ...context, expectedRevision: matching.expectedRevision } : { ...context };
	});
}
