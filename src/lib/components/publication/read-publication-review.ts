import { idSchema } from '#lib/domain/contracts.js';
import { publicationReviewDataSchema, type PublicationReviewData } from '#lib/domain/publication.js';

const unavailable = 'Actualisation impossible. La version que vous avez examinée est conservée.';

export async function readPublicationReview(
	moduleId: string,
	contextId?: string,
	request: typeof fetch = fetch
): Promise<PublicationReviewData> {
	try {
		idSchema.parse(moduleId);
		if (contextId !== undefined) idSchema.parse(contextId);
		const query = contextId === undefined ? '' : '?' + new URLSearchParams({ contexte: contextId });
		const response = await request(`/api/teaching/modules/${moduleId}/publication${query}`, {
			method: 'GET',
			credentials: 'same-origin',
			cache: 'no-store',
			redirect: 'error',
			headers: { Accept: 'application/json' }
		});
		if (
			response.status !== 200 ||
			response.redirected ||
			response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json'
		)
			throw new Error(unavailable);
		const review = publicationReviewDataSchema.parse(await response.json());
		if (review.module.id !== moduleId || (contextId !== undefined && review.selected?.context.id !== contextId))
			throw new Error(unavailable);
		return review;
	} catch {
		throw new Error(unavailable);
	}
}
