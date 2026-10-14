import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: './tests/browser',
	workers: 1,
	fullyParallel: false,
	retries: 0,
	timeout: 90000,
	expect: { timeout: 15000 },
	outputDir: '.playwright-mcp/browser-tests/results',
	reporter: [
		['list'],
		['html', { outputFolder: '.playwright-mcp/browser-tests/report', open: 'never' }]
	],
	use: {
		browserName: 'chromium',
		trace: 'off',
		video: 'off',
		screenshot: 'off',
		serviceWorkers: 'block',
		acceptDownloads: true
	},
	projects: [
		{ name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
		{
			name: 'mobile',
			use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
		}
	]
});
