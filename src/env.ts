import { defineEnvVars } from '@sveltejs/kit/env';

// Validate only when a private endpoint is used; the fictional design preview stays offline.
export const variables = defineEnvVars({
	TURSO_DATABASE_URL: {
		description: 'Dedicated Coursely Turso database URL; server only.',
		schema: (value) => value ?? ''
	},
	TURSO_AUTH_TOKEN: {
		description: 'Token limited to the dedicated Coursely database; server only.',
		schema: (value) => value ?? ''
	},
	ORIGIN: {
		description: 'Exact stable app origin, HTTPS except for loopback development.',
		schema: (value) => value ?? ''
	},
	BETTER_AUTH_SECRET: {
		description: 'Private high-entropy secret of at least 32 characters.',
		schema: (value) => value ?? ''
	}
});
