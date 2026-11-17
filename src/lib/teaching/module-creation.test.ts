import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyModule } from './types.js';
import { saveTeaching, TeachingRequestError } from './api.js';
import {
	captureModuleCreation,
	retainModuleCreation,
	reconcileContextRevisions,
	sameModuleDraft,
	validateModuleDetail
} from './module-creation.js';

const id = crypto.randomUUID();
const draft = () => ({ ...emptyModule(), title: 'Fictional module' });
const rawPayload = (payload: unknown) => payload;
afterEach(() => vi.unstubAllGlobals());

describe('Uncertain module creation', () => {
	it('captures immutable identities and nested content independently of later edits', () => {
		const input = draft();
		input.preparation.framing = 'Original';
		const command = captureModuleCreation(id, input);
		input.title = 'Later';
		input.preparation.framing = 'Later';
		expect(command.id).toBe(id);
		expect(command.payload.title).toBe('Fictional module');
		expect(command.payload.preparation.framing).toBe('Original');
		expect(Object.isFrozen(command.payload.preparation)).toBe(true);
		expect(sameModuleDraft(input, command.payload)).toBe(false);
	});
	it('recognizes unchanged content but keeps later invalid editable values', () => {
		const command = captureModuleCreation(id, draft());
		expect(sameModuleDraft(draft(), command.payload)).toBe(true);
		expect(sameModuleDraft({ ...draft(), title: '' }, command.payload)).toBe(false);
		const invalid = {
			...draft(),
			resources: [{ id: crypto.randomUUID(), label: 'Support', url: '', kind: 'resource' as const }]
		};
		expect(() => sameModuleDraft(invalid, command.payload)).not.toThrow();
		expect(sameModuleDraft(invalid, command.payload)).toBe(false);
	});
	it.each([400, 413, 415, 422])(
		'clears only a decoded pre-write server rejection (%s) through the real adapter',
		async (status) => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue(
					new Response(JSON.stringify({ message: 'Invalid fictional input', fields: { title: 'Required' } }), {
						status
					})
				)
			);
			const error = await saveTeaching('/api/teaching/modules', draft(), 'POST', id, rawPayload).catch(
				(cause) => cause
			);
			expect(error).toBeInstanceOf(TeachingRequestError);
			expect(retainModuleCreation(error)).toBe(false);
			if (!(error instanceof TeachingRequestError)) throw new Error('Expected request error.');
			expect(error.fields).toEqual({ title: 'Required' });
		}
	);
	it.each([400, 413, 415, 422])(
		'retains identity for JSON decoding and malformed envelopes despite status %s',
		async (status) => {
			for (const body of ['not JSON', JSON.stringify({ unrelated: true })]) {
				vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })));
				const error = await saveTeaching('/api/teaching/modules', draft(), 'POST', id, rawPayload).catch(
					(cause) => cause
				);
				expect(retainModuleCreation(error)).toBe(true);
			}
		}
	);
	it.each([409, 503])('retains decoded conflict/transient outcomes (%s)', async (status) => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Retry' }), { status })));
		const error = await saveTeaching('/api/teaching/modules', draft(), 'POST', id, rawPayload).catch((cause) => cause);
		expect(retainModuleCreation(error)).toBe(true);
	});
	it('retains identity after transport failure and sends the exact captured body on replay', async () => {
		const command = captureModuleCreation(id, draft());
		const fetch = vi
			.fn()
			.mockRejectedValueOnce(new Error('Synthetic lost response'))
			.mockResolvedValueOnce(new Response(JSON.stringify({ ...draft(), id, revision: 1 })));
		vi.stubGlobal('fetch', fetch);
		const error = await saveTeaching('/api/teaching/modules', command.payload, 'POST', command.id, rawPayload).catch(
			(cause) => cause
		);
		expect(retainModuleCreation(error)).toBe(true);
		const saved = validateModuleDetail(
			await saveTeaching('/api/teaching/modules', command.payload, 'POST', command.id, rawPayload),
			command.id
		);
		expect(saved.id).toBe(id);
		expect(fetch.mock.calls[1][1]).toEqual(fetch.mock.calls[0][1]);
	});
	it('refuses malformed success projections and well-shaped responses for another identity', async () => {
		for (const response of [
			{ ...draft(), id, revision: 1, roster: [] },
			{ ...draft(), id: crypto.randomUUID(), revision: 1 }
		]) {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(response))));
			const received = await saveTeaching('/api/teaching/modules', draft(), 'POST', id, rawPayload);
			let error: unknown;
			try {
				validateModuleDetail(received, id);
			} catch (cause) {
				error = cause;
			}
			expect(error).toBeInstanceOf(TeachingRequestError);
			expect(retainModuleCreation(error)).toBe(true);
		}
	});
	it('updates only matching context revisions, retaining stable identities and local calendar edits', () => {
		const contextId = crypto.randomUUID(),
			classId = crypto.randomUUID(),
			lessonId = crypto.randomUUID();
		const contexts = [
			{
				id: contextId,
				classId,
				lessons: [
					{
						id: lessonId,
						startsAt: '2026-10-14T10:30',
						endsAt: '2026-10-14T11:30',
						title: 'Local edit',
						recap: '',
						toDo: ''
					}
				]
			}
		];
		const saved = {
			...draft(),
			id,
			revision: 1,
			contexts: [
				{
					id: contextId,
					classId,
					expectedRevision: 1,
					lessons: [
						{
							...contexts[0].lessons[0],
							startsAt: '2026-10-14T08:00:00.000Z',
							endsAt: '2026-10-14T09:00:00.000Z'
						}
					]
				}
			]
		};
		const retained = reconcileContextRevisions(contexts, saved);
		expect(retained[0]).toEqual({ ...contexts[0], expectedRevision: 1 });
		expect(saved.contexts[0].lessons[0].startsAt).toBe('2026-10-14T08:00:00.000Z');
		expect(() => reconcileContextRevisions([{ ...contexts[0], id: crypto.randomUUID() }], saved)).toThrow(
			TeachingRequestError
		);
	});
});
