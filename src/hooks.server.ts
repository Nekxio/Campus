import type { Handle } from '@sveltejs/kit/hooks';
import { isHttpError } from '@sveltejs/kit';
import { building } from '$app/env';
import { withAuth } from '#lib/server/auth/runtime.js';

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.session = null;
	event.locals.authUnavailable = false;
	const authRoute = event.url.pathname.startsWith('/api/auth/');
	const studentRoute = ['/classes', '/modules'].some(
		(path) => event.url.pathname === path || event.url.pathname.startsWith(path + '/')
	);
	const hasSession =
		event.cookies.get('coursely.session_token') ||
		event.cookies.get('__Secure-coursely.session_token');
	if (
		!building &&
		!authRoute &&
		!studentRoute &&
		event.url.pathname !== '/mcp' &&
		!event.url.pathname.startsWith('/.well-known/') &&
		hasSession
	) {
		try {
			const { response: session, headers } = await withAuth((auth) =>
				auth.api.getSession({ headers: event.request.headers, returnHeaders: true })
			);
			event.locals.user = session?.user ?? null;
			event.locals.session = session?.session ?? null;
			for (const header of headers.getSetCookie()) {
				const { name, value, ...options } = event.cookies.parse(header);
				if (!name || value === undefined) throw new Error('Invalid authentication cookie.');
				event.cookies.set(name, value, options);
			}
		} catch (cause) {
			if (!isHttpError(cause) || cause.status !== 503) throw cause;
			event.locals.authUnavailable = true;
		}
	}
	const resolved = await resolve(event);
	const response = new Response(resolved.body, {
		status: resolved.status,
		statusText: resolved.statusText,
		headers: resolved.headers
	});
	if (
		event.url.pathname.startsWith('/api/') ||
		event.url.pathname.startsWith('/enseignant') ||
		[
			'/',
			'/connexion',
			'/activation',
			'/autoriser',
			'/mcp',
			'/.well-known/oauth-protected-resource/mcp',
			'/.well-known/oauth-authorization-server/api/auth'
		].includes(event.url.pathname) ||
		event.url.pathname.startsWith('/connexion/') ||
		hasSession
	) {
		response.headers.set('Cache-Control', 'private, no-store');
	}
	if (studentRoute) {
		response.headers.set('Cache-Control', 'no-store');
		response.headers.set('X-Robots-Tag', 'noindex, nofollow');
	}
	response.headers.set('Referrer-Policy', 'no-referrer');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'SAMEORIGIN');
	// An additional policy intersects with an existing CSP instead of replacing it.
	// Same-origin previews remain possible; every ancestor must share this origin.
	response.headers.append('Content-Security-Policy', "frame-ancestors 'self'");
	return response;
};

export const handle: Handle = handleBetterAuth;
