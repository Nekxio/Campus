import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	// Prepare lazy PDF dependencies before the first export so dev does not reload mid-download.
	optimizeDeps: { include: ['pdfmake/build/pdfmake.js', 'pdfmake/build/vfs_fonts.js'] },
	plugins: [
		tailwindcss(),
		{
			name: 'coursely-superforms-kit3',
			enforce: 'post',
			// Kit's broad $app alias is added first; this exact compatibility alias must win.
			config: () => ({
				resolve: {
					alias: [
						{
							find: /^\$app\/stores$/,
							replacement: fileURLToPath(
								new URL('./src/lib/compat/superforms-kit3.ts', import.meta.url)
							)
						}
					]
				}
			})
		},
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	]
});
