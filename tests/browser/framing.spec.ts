import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './fixtures.js';

test('blocks third-party frames, permits same-origin previews and protects error responses', async ({
	app,
	page,
	context
}) => {
	const directory = join(app.manifest.directory, 'src/routes/__frame-fixture');
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(directory, '+server.ts'),
		`export const GET = () => new Response('<script>parent.postMessage("fictional-frame-loaded", "*")</script>', {
		 headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "script-src 'unsafe-inline'" }
		});`
	);
	const failure = join(app.manifest.directory, 'src/routes/__frame-error');
	await mkdir(failure, { recursive: true });
	await writeFile(
		join(failure, '+server.ts'),
		"export const GET = () => { throw new Error('fictional'); };"
	);
	for (const [path, status] of [
		['/connexion', 200],
		['/missing-frame-fixture', 404],
		['/__frame-error', 500]
	] as const) {
		await expect
			.poll(async () => (await page.request.get(app.origin + path)).status())
			.toBe(status);
		const response = await page.request.get(app.origin + path);
		expect(response.status()).toBe(status);
		expect(response.headers()['x-frame-options']).toBe('SAMEORIGIN');
		expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'self'");
	}
	const target = app.origin + '/__frame-fixture';
	await expect.poll(async () => (await page.request.get(target)).status()).toBe(200);
	const html = `<script>window.loadedFrames = 0; addEventListener('message', e => {
	 if (e.data === 'fictional-frame-loaded') window.loadedFrames++;
	});</script><iframe src="${target}"></iframe>`;
	// Fulfilled loopback parents only: no external server or production traffic.
	const sameOrigin = app.origin + '/__same-origin-parent';
	const thirdParty = 'http://127.0.0.1:47777/__third-party-parent';
	for (const url of [sameOrigin, thirdParty])
		await context.route(url, (route) => route.fulfill({ contentType: 'text/html', body: html }));
	await page.goto(sameOrigin);
	await expect
		.poll(() => page.evaluate(() => (window as Window & { loadedFrames?: number }).loadedFrames))
		.toBe(1);
	await page.goto(thirdParty);
	await expect
		.poll(() => page.frames().map((frame) => frame.url()))
		.toContain('chrome-error://chromewebdata/');
	expect(
		await page.evaluate(() => (window as Window & { loadedFrames?: number }).loadedFrames)
	).toBe(0);
});
