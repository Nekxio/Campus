import { describe, expect, it, vi } from 'vitest';
import type { PublicationReviewData } from '#lib/domain/publication.js';
import { readPublicationReview } from './read-publication-review.js';

const moduleId = '00000000-0000-4000-8000-000000000001';
const contextId = '00000000-0000-4000-8000-000000000002';
const otherId = '00000000-0000-4000-8000-000000000003';
const context = {
	id: contextId,
	classId: otherId,
	className: 'B3 fictive',
	academicYear: '2026-2027',
	archived: false
};
const review: PublicationReviewData = {
	module: { id: moduleId, title: 'Module fictif' },
	contexts: [context],
	selected: {
		context,
		moduleRevision: 2,
		contextRevision: 1,
		classRevision: 1,
		publicationRevision: 0,
		draft: null,
		published: null,
		status: 'draft',
		publishedAt: null,
		unpublishedAt: null,
		changed: false,
		publicPath: '/modules/' + otherId,
		classPath: '/classes/' + otherId
	}
};
const unavailable = 'Actualisation impossible. La version que vous avez examinée est conservée.';
const endpoint = `/api/teaching/modules/${moduleId}/publication`;

function reader(response: Response = Response.json(review)) {
	return vi.fn<typeof fetch>().mockResolvedValue(response);
}

describe('Targeted private publication review read', () => {
	it('makes a fresh same-origin GET for the exact context, without a body or Kit navigation', async () => {
		const request = reader();
		expect(await readPublicationReview(moduleId, contextId, request)).toEqual(review);
		expect(request).toHaveBeenCalledExactlyOnceWith(endpoint + '?contexte=' + contextId, {
			method: 'GET',
			credentials: 'same-origin',
			cache: 'no-store',
			redirect: 'error',
			headers: { Accept: 'application/json' }
		});
	});
	it('supports an unassigned module and omits the context query entirely', async () => {
		const empty = { ...review, contexts: [], selected: null };
		const request = reader(Response.json(empty));
		expect(await readPublicationReview(moduleId, undefined, request)).toEqual(empty);
		expect(request.mock.calls[0][0]).toBe(endpoint);
	});
	it('does not cache reads or add nonces: every explicit refresh makes a new request', async () => {
		const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(review));
		await readPublicationReview(moduleId, contextId, request);
		await readPublicationReview(moduleId, contextId, request);
		expect(request).toHaveBeenCalledTimes(2);
		expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
	});
	it.each([
		['bad', contextId],
		[moduleId + '/extra', contextId],
		['https://private.invalid', contextId],
		[moduleId, 'bad'],
		[moduleId, ''],
		[moduleId, contextId + '&extra=1']
	])('rejects invalid request identities before IO (%s, %s)', async (module, context) => {
		const request = reader();
		await expect(readPublicationReview(module, context, request)).rejects.toThrow(unavailable);
		expect(request).not.toHaveBeenCalled();
	});
	it.each([204, 301, 302, 303, 400, 401, 403, 404, 409, 500, 503])(
		'rejects HTTP %s without reading or displaying its body',
		async (status) => {
			const response = new Response(status === 204 ? null : 'PRIVATE server detail', { status });
			const decode = vi.spyOn(response, 'json');
			await expect(readPublicationReview(moduleId, contextId, reader(response))).rejects.toThrow(unavailable);
			expect(decode).not.toHaveBeenCalled();
		}
	);
	it('rejects redirects even if a custom transport returns an otherwise valid response', async () => {
		const response = Response.json(review);
		Object.defineProperty(response, 'redirected', { value: true });
		await expect(readPublicationReview(moduleId, contextId, reader(response))).rejects.toThrow(unavailable);
	});
	it.each(['text/html', 'text/plain', 'application/problem+json', ''])('rejects content type %j', async (type) => {
		const response = new Response(JSON.stringify(review), { headers: { 'Content-Type': type } });
		await expect(readPublicationReview(moduleId, contextId, reader(response))).rejects.toThrow(unavailable);
	});
	it('accepts JSON with a charset parameter', async () => {
		const response = new Response(JSON.stringify(review), {
			headers: { 'Content-Type': 'application/json; charset=utf-8' }
		});
		expect(await readPublicationReview(moduleId, contextId, reader(response))).toEqual(review);
	});
	it.each(['{', '<html>PRIVATE login page</html>'])('rejects malformed JSON %j', async (body) => {
		const response = new Response(body, { headers: { 'Content-Type': 'application/json' } });
		await expect(readPublicationReview(moduleId, contextId, reader(response))).rejects.toThrow(unavailable);
	});
	it.each([
		null,
		{ module: review.module },
		{ ...review, roster: ['PRIVATE student'] },
		{ ...review, selected: { ...review.selected, moduleRevision: -1 } },
		{ ...review, module: { ...review.module, id: otherId } },
		{ ...review, contexts: [], selected: null },
		{
			...review,
			contexts: [{ ...context, id: otherId }],
			selected: { ...review.selected, context: { ...context, id: otherId } }
		}
	])('rejects missing, malformed or mismatched response data %#', async (data) => {
		await expect(readPublicationReview(moduleId, contextId, reader(Response.json(data)))).rejects.toThrow(unavailable);
	});
	it('keeps transport and decoding errors neutral', async () => {
		const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('PRIVATE network detail'));
		await expect(readPublicationReview(moduleId, contextId, request)).rejects.toThrow(unavailable);
		const response = Response.json(review);
		vi.spyOn(response, 'json').mockRejectedValue(new Error('PRIVATE body interrupted'));
		await expect(readPublicationReview(moduleId, contextId, reader(response))).rejects.toThrow(unavailable);
	});
	it('returns a detached validated value without changing the previously reviewed snapshot', async () => {
		const before = JSON.stringify(review);
		const next = await readPublicationReview(moduleId, contextId, reader());
		expect(next).not.toBe(review);
		expect(next.selected).not.toBe(review.selected);
		next.module.title = 'Nouvelle référence';
		expect(JSON.stringify(review)).toBe(before);
	});
});
