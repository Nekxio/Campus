import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import { saveTeaching, TeachingRequestError } from './api.js';

const receipt = z.object({ id: z.uuid() });
const id = '10000000-0000-4000-8000-000000000001';
afterEach(() => vi.unstubAllGlobals());

const respond = (body: unknown, status = 200) => {
	const fetch = vi.fn().mockResolvedValue(Response.json(body, { status }));
	vi.stubGlobal('fetch', fetch);
	return fetch;
};

describe('teaching action responses', () => {
	it('decodes a confirmed response before returning it and preserves the request API', async () => {
		const fetch = respond({ id, extra: true });
		const result = saveTeaching('/classes', { name: 'Fictive' }, 'PATCH', id, receipt.parse);
		expectTypeOf(result).toEqualTypeOf<Promise<{ id: string }>>();
		await expect(result).resolves.toEqual({ id });
		expect(fetch).toHaveBeenCalledExactlyOnceWith('/classes', {
			method: 'PATCH',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id },
			body: JSON.stringify({ name: 'Fictive' })
		});
	});
	it('keeps an explicitly undecoded response unknown', async () => {
		respond({ id });
		const result = saveTeaching('/classes', {}, 'POST', undefined, (payload) => payload);
		expectTypeOf(result).toEqualTypeOf<Promise<unknown>>();
		await expect(result).resolves.toEqual({ id });
	});
	it.each([{}, null, [], { id: 'invalid' }, { message: 'not a receipt' }])(
		'rejects malformed HTTP 200 without applying a baseline: %j',
		async (body) => {
			respond(body);
			const applySaved = vi.fn();
			const request = saveTeaching('/classes', {}, 'POST', id, receipt.parse).then(applySaved);
			await expect(request).rejects.toMatchObject({
				status: 200,
				decodedServerError: false,
				fields: {}
			});
			expect(applySaved).not.toHaveBeenCalled();
		}
	);
	it.each([200, 422, 401, 409, 500])(
		'keeps the actual status of invalid JSON (%i) and its ambiguous result',
		async (status) => {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{broken', { status })));
			await expect(saveTeaching('/classes', {}, 'POST', id, receipt.parse)).rejects.toMatchObject({
				status,
				decodedServerError: false
			});
		}
	);
	it.each([422, 401, 409, 500])('decodes a real HTTP %i error before attempting success validation', async (status) => {
		respond({ message: 'Échec fictif', fields: { name: 'Nom à vérifier' } }, status);
		const decoder = vi.fn(receipt.parse);
		await expect(saveTeaching('/classes', {}, 'POST', id, decoder)).rejects.toMatchObject({
			status,
			message: 'Échec fictif',
			fields: { name: 'Nom à vérifier' },
			decodedServerError: true
		});
		expect(decoder).not.toHaveBeenCalled();
	});
	it('does not mistake an undecodable error for a decoded server refusal', async () => {
		respond({}, 409);
		await expect(saveTeaching('/classes', {}, 'POST', undefined, receipt.parse)).rejects.toMatchObject({
			status: 409,
			decodedServerError: false
		});
	});
	it('retains the exact command and retry UUID after a lost response', async () => {
		const fetch = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(Response.json({ id }));
		vi.stubGlobal('fetch', fetch);
		const body = { name: 'Brouillon conservé', expectedRevision: 7 };
		await expect(saveTeaching('/classes', body, 'POST', id, receipt.parse)).rejects.toBeInstanceOf(
			TeachingRequestError
		);
		await expect(saveTeaching('/classes', body, 'POST', id, receipt.parse)).resolves.toEqual({
			id
		});
		expect(fetch.mock.calls[0]).toEqual(fetch.mock.calls[1]);
		expect(body).toEqual({ name: 'Brouillon conservé', expectedRevision: 7 });
	});
});
