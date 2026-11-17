import { defineConfig } from 'vitest/config';

export default defineConfig({
	envDir: false,
	plugins: [
		{
			name: 'campus-unit-server-marker',
			// Superforms marks its server entry with this virtual import; Node tests are already server-only.
			resolveId: (id, importer) =>
				id === '$app/server' && importer?.replaceAll('\\', '/').endsWith('/sveltekit-superforms/dist/server/index.js')
					? '\0campus-unit-server-marker'
					: undefined,
			load: (id) => (id === '\0campus-unit-server-marker' ? 'export {};' : undefined)
		}
	],
	test: {
		environment: 'node',
		server: { deps: { inline: [/sveltekit-superforms\/dist\/server\/index\.js$/] } },
		execArgv: ['--import', new URL('./scripts/test-isolation.mjs', import.meta.url).href],
		expect: { requireAssertions: true },
		include: ['src/**/*.{test,spec}.{js,ts}'],
		exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
	}
});
