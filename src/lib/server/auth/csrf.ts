// SvelteKit's form-origin check runs before handle and cannot exempt OAuth paths.
// Keep its boundary here, before session/database work, with only a cookie-free
// native OAuth form exception. Browser JSON mutations retain their domain guards.
const mutations = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const formTypes = new Set([
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain',
	'application/x-sveltekit-formdata'
]);
const nativeForms = new Set(['/api/auth/oauth2/token', '/api/auth/oauth2/revoke', '/api/auth/oauth2/introspect']);
const browserHeaders = ['sec-fetch-site', 'sec-fetch-dest'];
const nativeActionPages = new Set(['/enseignant/compte', '/autoriser', '/enseignant/applications']);

export const isSameOriginFormRequest = (request: Request, url: URL) => {
	if (request.headers.get('origin') === url.origin) return true;
	const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
	// Chrome's no-referrer policy makes native same-origin navigation POSTs opaque.
	return (
		request.method === 'POST' &&
		nativeActionPages.has(url.pathname) &&
		(type === 'multipart/form-data' || type === 'application/x-www-form-urlencoded') &&
		request.headers.get('origin') === 'null' &&
		request.headers.get('sec-fetch-site') === 'same-origin' &&
		request.headers.get('sec-fetch-mode') === 'navigate' &&
		request.headers.get('sec-fetch-dest') === 'document'
	);
};

export const rejectCrossOriginForm = (request: Request, url: URL): Response | undefined => {
	const declaredType = request.headers.get('content-type');
	const contentType = declaredType?.split(';', 1)[0].trim().toLowerCase();
	const fetchMode = request.headers.get('sec-fetch-mode');
	if (
		!mutations.has(request.method) ||
		(declaredType && !formTypes.has(contentType!)) ||
		isSameOriginFormRequest(request, url)
	)
		return;
	if (
		request.method === 'POST' &&
		contentType === 'application/x-www-form-urlencoded' &&
		nativeForms.has(url.pathname) &&
		!request.headers.has('origin') &&
		!request.headers.has('cookie') &&
		!browserHeaders.some((name) => request.headers.has(name)) &&
		// Node Fetch adds only this mode; browser requests still carry Origin or Site/Dest.
		(fetchMode === null || fetchMode === 'cors')
	)
		return;
	return Response.json(
		{ message: `Cross-site ${request.method} form submissions are forbidden` },
		{
			status: 403,
			headers: {
				'Cache-Control': 'private, no-store',
				'X-Frame-Options': 'SAMEORIGIN',
				'Content-Security-Policy': "frame-ancestors 'self'",
				'Referrer-Policy': 'no-referrer',
				'X-Content-Type-Options': 'nosniff'
			}
		}
	);
};
