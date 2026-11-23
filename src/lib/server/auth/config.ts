export interface AuthSettings {
	ORIGIN: string;
	BETTER_AUTH_SECRET: string;
}

export const isLoopbackHostname = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

export function authOrigin(settings: AuthSettings) {
	const url = new URL(settings.ORIGIN);
	if (
		(url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== '/' ||
		settings.BETTER_AUTH_SECRET.length < 32
	) {
		throw new Error('Configurer une origine HTTPS et un secret aléatoire de 32 caractères minimum.');
	}
	return url.origin;
}
