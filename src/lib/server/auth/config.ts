export interface AuthSettings {
	ORIGIN: string;
	BETTER_AUTH_SECRET: string;
}

export function authOrigin(settings: AuthSettings) {
	const url = new URL(settings.ORIGIN);
	const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	if (
		(url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
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
