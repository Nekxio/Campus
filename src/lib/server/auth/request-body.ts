import { error } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';

// Activation carries one 64-hex token (76 bytes as JSON; <400 with JSON Unicode escapes).
export const ACTIVATION_BODY_LIMIT = 1024;
// Passkeys use attestation "none", without certificate chains or configured extensions.
// Allow generous room for browser WebAuthn fields as well as Better Auth's small mutation forms.
export const AUTH_BODY_LIMIT = 64 * 1024;

export async function withBoundedAuthRequest<T>(
	request: Request,
	maxBytes: number,
	operation: (request: Request) => Promise<T>
): Promise<T> {
	if (!request.body) return operation(request);
	const reader = request.body.getReader();
	const declaredSize = Number(request.headers.get('content-length'));
	let size = 0;
	let released = false;
	let failure: APIError | undefined;
	function cancel() {
		if (released) return;
		// Cancellation must not delay or replace the response if the source fails to cancel.
		void reader.cancel().catch(() => undefined);
		reader.releaseLock();
		released = true;
	}
	const body = new ReadableStream<Uint8Array>(
		{
			async pull(controller) {
				try {
					if (declaredSize > maxBytes)
						throw new APIError('PAYLOAD_TOO_LARGE', {
							message: 'La requête d’authentification est trop volumineuse.'
						});
					while (true) {
						const chunk = await reader.read();
						if (chunk.done) {
							reader.releaseLock();
							released = true;
							controller.close();
							return;
						}
						if (chunk.value.byteLength > maxBytes - size)
							throw new APIError('PAYLOAD_TOO_LARGE', {
								message: 'La requête d’authentification est trop volumineuse.'
							});
						size += chunk.value.byteLength;
						if (!chunk.value.byteLength) continue;
						controller.enqueue(chunk.value);
						return;
					}
				} catch (cause) {
					failure =
						cause instanceof APIError ? cause : new APIError('BAD_REQUEST', { message: 'Corps de requête invalide.' });
					cancel();
					controller.error(failure);
				}
			},
			cancel
		},
		// Better Auth's onRequest quota must run before the first byte is pulled.
		{ highWaterMark: 0 }
	);
	const headers = new Headers(request.headers);
	headers.delete('content-length');
	headers.delete('transfer-encoding');
	const init: RequestInit & { duplex: 'half' } = { headers, body, duplex: 'half' };
	try {
		return await operation(new Request(request, init));
	} finally {
		cancel();
		// Activation's JSON catch and parser implementations must not hide a stream failure.
		if (failure) error(failure.statusCode, failure.message);
	}
}
