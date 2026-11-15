import { createTursoClient } from '../src/lib/server/db/index.js';

export function operatorClient() {
	// Only explicit operator commands load credentials; tests never use this path.
	return createTursoClient(process.env.TURSO_DATABASE_URL ?? '', process.env.TURSO_AUTH_TOKEN ?? '');
}
