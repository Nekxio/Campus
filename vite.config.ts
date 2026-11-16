import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { quizCloudflareAdapter } from './scripts/cloudflare-adapter.js';

export default defineConfig({
	// Calendar values must share constructor identities with linked UI dependencies.
	resolve: { dedupe: ['@internationalized/date'] },
	// Prepare lazy PDF dependencies before the first export so dev does not reload mid-download.
	optimizeDeps: { include: ['pdfmake/build/pdfmake.js', 'pdfmake/build/vfs_fonts.js'] },
	plugins: [
		tailwindcss(),
		sveltekit({
			// The mandatory server hook preserves form CSRF checks and exempts only native
			// OAuth forms. Kit otherwise rejects them before hooks in production builds.
			csrf: { trustedOrigins: ['*'] },
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			},
			adapter: quizCloudflareAdapter()
		})
	]
});
