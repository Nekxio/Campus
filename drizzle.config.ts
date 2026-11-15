import { defineConfig } from 'drizzle-kit';
export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'turso',
	...(process.env.TURSO_DATABASE_URL
		? {
				dbCredentials: {
					url: process.env.TURSO_DATABASE_URL,
					authToken: process.env.TURSO_AUTH_TOKEN
				}
			}
		: {}),
	verbose: true,
	strict: true
});
