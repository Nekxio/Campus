import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { isHttpError } from '@sveltejs/kit';
import { building } from '$app/env';
import { withAuth } from '#lib/server/auth/runtime.js';
import { isSameOriginFormRequest, rejectCrossOriginForm } from '#lib/server/auth/csrf.js';
import { legalPaths } from '#lib/legal.js';
import { createServerTiming, measureServerTiming } from '#lib/server/server-timing.js';

const isStudentRoute = (pathname: string) =>
	['/classes', '/modules'].some((path) => pathname === path || pathname.startsWith(path + '/'));

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	if (isStudentRoute(event.url.pathname)) event.locals.publicClassId = null;
	const forbidden = rejectCrossOriginForm(event.request, event.url);
	if (forbidden) return forbidden;
	const timing =
		event.request.method === 'GET' &&
		(event.url.pathname === '/' ||
			event.url.pathname === '/enseignant' ||
			event.url.pathname.startsWith('/enseignant/') ||
			isStudentRoute(event.url.pathname))
			? createServerTiming()
			: undefined;
	if (timing) event.locals.serverTiming = timing;
	event.locals.user = null;
	event.locals.session = null;
	event.locals.authUnavailable = false;
	const authRoute = event.url.pathname.startsWith('/api/auth/');
	const studentRoute = isStudentRoute(event.url.pathname);
	const legalRoute = legalPaths.includes(event.url.pathname);
	const hasSession =
		event.cookies.get('coursely.session_token') || event.cookies.get('__Secure-coursely.session_token');
	if (
		!building &&
		!authRoute &&
		!studentRoute &&
		!legalRoute &&
		event.url.pathname !== '/mcp' &&
		!event.url.pathname.startsWith('/.well-known/') &&
		hasSession
	) {
		try {
			const sessionHeaders = new Headers(event.request.headers);
			if (sessionHeaders.get('origin') === 'null' && isSameOriginFormRequest(event.request, event.url))
				sessionHeaders.set('origin', event.url.origin);
			const { response: session, headers } = await measureServerTiming(timing, 'auth', () =>
				withAuth((auth) => auth.api.getSession({ headers: sessionHeaders, returnHeaders: true }))
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
	const resolved = await measureServerTiming(timing, 'resolve', () => resolve(event));
	// A WebSocket upgrade carries a runtime-owned socket that a Response clone would discard.
	if (resolved.status === 101) return resolved;
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
	}
	if (studentRoute || legalRoute) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
	if (timing) response.headers.append('Server-Timing', timing.header());
	response.headers.set('Referrer-Policy', 'no-referrer');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'SAMEORIGIN');
	// An additional policy intersects with an existing CSP instead of replacing it.
	// Same-origin previews remain possible; every ancestor must share this origin.
	response.headers.append('Content-Security-Policy', "frame-ancestors 'self'");
	return response;
};

export const handle: Handle = handleBetterAuth;

// Kit's synchronous SSR renderer cannot consume a Promise from this hook.
export const handleError: HandleServerError = ({ kind, error, event }) => {
	if (!isStudentRoute(event.url.pathname)) return;
	return {
		status: kind === 'unknown' ? 500 : error.status,
		message: 'Cette page de cours n’est pas disponible.',
		publicClassId: event.url.pathname.startsWith('/modules/') ? (event.locals.publicClassId ?? null) : null
	};
};
