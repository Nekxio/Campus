import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page, Request, Response } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

const recoveryName = 'Voir les cours de la classe';
const neutralHelp = 'Demandez le lien du cours à votre enseignant.';
const generalHelp = 'Vérifiez l’adresse de la page.';
const missingId = '00000000-0000-4000-8000-000000000000';
const privateDetails =
	/PRIVATE_[A-Z_]+_MARKER|Préparation privée fictive|teacher-browser@example|fictional\/private|coursely\.session_token/;

test('error boundaries offer safe recovery without exposing server details', async ({
	app,
	page,
	context
}, testInfo) => {
	// Every failure seam below lives only in this owned disposable fixture, never in app auth/source.
	for (const route of ['__error-fixture', 'enseignant/__error-fixture']) {
		const directory = join(app.manifest.directory, 'src/routes', route);
		await mkdir(directory, { recursive: true });
		await writeFile(join(directory, '+page.svelte'), '<p>Unreachable fixture page</p>');
		await writeFile(
			join(directory, '+page.server.ts'),
			"export const load = () => { throw new Error('PRIVATE_ERROR_FIXTURE_MARKER'); };\n"
		);
	}
	for (const route of ['__error-fallback', 'modules/__error-fallback']) {
		const directory = join(app.manifest.directory, 'src/routes', route);
		await mkdir(directory, { recursive: true });
		await writeFile(
			join(directory, '+server.ts'),
			"export const GET = () => { throw new Error('PRIVATE_FALLBACK_FIXTURE_MARKER'); };\n"
		);
	}
	const moduleDirectory = join(app.manifest.directory, 'src/routes/modules/[contextId]');
	const modulePage = join(moduleDirectory, '+page.svelte');
	await writeFile(
		modulePage,
		(await readFile(modulePage, 'utf8'))
			.replace(
				'<script lang="ts">',
				`<script lang="ts">
		import { browser } from '$app/env';
		import { page } from '$app/state';
		function renderGuard() {
			if (!browser && page.url.searchParams.get('failure') === 'ssr') throw new Error('PRIVATE_SSR_FIXTURE_MARKER');
			return '';
		}
	`
			)
			.replace('<PublicCourse {data} />', '{renderGuard()}<PublicCourse {data} />')
	);
	const moduleLoader = join(moduleDirectory, '+page.server.ts');
	await writeFile(
		moduleLoader,
		"import { error } from '@sveltejs/kit';\n" +
			(await readFile(moduleLoader, 'utf8'))
				.replace('params, setHeaders, locals', 'params, setHeaders, locals, url')
				.replace(
					'const contextId = teachingId(params.contextId);',
					"const contextId = teachingId(params.contextId);\n if (url.searchParams.get('failure') === 'early') error(503, 'PRIVATE_EARLY_FIXTURE_MARKER');"
				)
				.replace(
					'return published;',
					"if (url.searchParams.get('failure') === 'loader') throw new Error('PRIVATE_LOADER_FIXTURE_MARKER');\n return published;"
				)
	);
	await writeFile(
		join(moduleDirectory, '+page.ts'),
		`import { browser } from '$app/env';
export const load = async ({ url, data }) => {
	if (browser && url.searchParams.get('failure') === 'client') await import('./__client-failure.js');
	return data;
};`
	);
	await writeFile(
		join(moduleDirectory, '__client-failure.ts'),
		"throw new Error('PRIVATE_CLIENT_FIXTURE_MARKER');\nexport {};\n"
	);
	// Record only allowlisted fictional error markers, without changing the synchronous hook result.
	const hooks = join(app.manifest.directory, 'src/hooks.server.ts');
	const hooksSource = await readFile(hooks, 'utf8');
	expect(hooksSource).toContain('export const handleError: HandleServerError =');
	await writeFile(
		hooks,
		hooksSource.replace(
			'export const handleError: HandleServerError =',
			'const originalHandleError: HandleServerError ='
		) +
			`
export const fixtureErrors: unknown[] = [];
export const handleError: HandleServerError = (input) => {
	const result = originalHandleError(input);
	const cause = input.error;
	const message = cause instanceof Error ? cause.message : '';
	const marker = ['PRIVATE_SSR_FIXTURE_MARKER', 'PRIVATE_LOADER_FIXTURE_MARKER', 'PRIVATE_EARLY_FIXTURE_MARKER'].find((value) => message.includes(value)) ?? null;
	fixtureErrors.push({
		route: input.event.route.id,
		failure: input.event.url.searchParams.get('failure'),
		kind: input.kind,
		originalErrorName: cause instanceof Error && ['Error', 'TypeError', 'ReferenceError'].includes(cause.name) ? cause.name : 'other',
		originalErrorMarker: marker,
		missingSnapshotTitle: message.includes("Cannot read properties of undefined (reading 'title')"),
		proofAcquired: !!input.event.locals.publicClassId,
		promiseResult: result instanceof Promise
	});
	return result;
};
`
	);
	const diagnosticsRoute = join(app.manifest.directory, 'src/routes/__recovery-diagnostics');
	await mkdir(diagnosticsRoute, { recursive: true });
	await writeFile(
		join(diagnosticsRoute, '+server.ts'),
		`import { json } from '@sveltejs/kit';
import { fixtureErrors } from '../../hooks.server.js';
export const GET = () => json(fixtureErrors, { headers: { 'Cache-Control': 'no-store' } });
`
	);
	// Observe Kit's page status without changing the shipped error composition or success DTO.
	for (const route of ['modules', 'classes']) {
		const boundary = join(app.manifest.directory, 'src/routes', route, '+error.svelte');
		await writeFile(
			boundary,
			(await readFile(boundary, 'utf8')) + '\n<span hidden data-page-status={page.status}></span>\n'
		);
	}
	const links = join(app.manifest.directory, 'src/routes/__recovery-links');
	await mkdir(links, { recursive: true });
	await writeFile(
		join(links, '+page.svelte'),
		`<script>
	import { resolve } from '$app/paths';
</script>
<h1>Fictional recovery links</h1>
${['loader', 'client'].map((failure) => `<a data-sveltekit-preload-data="off" href={resolve('/modules/[contextId]', { contextId: '${app.ids.publicationContext}' }) + '?failure=${failure}'}>${failure}</a>`).join('\n')}`
	);

	const layout = join(app.manifest.directory, 'src/routes/+layout.svelte');
	await writeFile(
		layout,
		(await readFile(layout, 'utf8')).replace(
			'<script lang="ts">',
			`<script lang="ts">
			import { onMount } from 'svelte';
			onMount(() => { document.documentElement.dataset.fixtureReady = 'true'; });
		`
		)
	);
	const navigations: string[] = [];
	page.on('framenavigated', (frame) => {
		if (frame === page.mainFrame()) navigations.push(new URL(frame.url()).pathname);
	});
	page.on('requestfailed', (request) => {
		if (request.isNavigationRequest())
			navigations.push('failed: ' + new URL(request.url()).pathname + ' ' + request.failure()?.errorText);
	});
	page.on('requestfailed', (request) => {
		if (request.isNavigationRequest()) console.info('Fixture navigation diagnostics:', JSON.stringify(navigations));
	});
	const modulePath = '/modules/' + app.ids.publicationContext;
	const classPath = '/classes/' + app.ids.currentClass;
	const consoleEvents: { type: string; text: string }[] = [];
	const pageErrors: { name: string; message: string }[] = [];
	const network: { url: string; resourceType: string; status: number }[] = [];
	function publicDiagnostic(value: string) {
		return value
			.replaceAll(app.origin, '<owned-origin>')
			.replaceAll(app.manifest.directory, '<owned-fixture>')
			.replaceAll(app.ids.publicationContext, '<published-context>')
			.replaceAll(app.ids.currentClass, '<public-class>');
	}
	const onConsole = (message: import('@playwright/test').ConsoleMessage) => {
		if (consoleEvents.length < 100)
			consoleEvents.push({ type: message.type(), text: publicDiagnostic(message.text()) });
	};
	const onPageError = (cause: Error) => {
		if (pageErrors.length < 100) pageErrors.push({ name: cause.name, message: publicDiagnostic(cause.message) });
	};
	const onResponse = (response: Response) => {
		const request = response.request();
		if (request.resourceType() === 'document' || new URL(response.url()).pathname.endsWith('/__data.json')) {
			network.push({
				url: publicDiagnostic(response.url()),
				resourceType: request.resourceType(),
				status: response.status()
			});
		}
	};
	page.on('console', onConsole);
	page.on('pageerror', onPageError);
	page.on('response', onResponse);
	async function collectRecoveryEvidence(stage: string) {
		const mains = await page.locator('main').evaluateAll((elements) => elements.map((element) => element.outerHTML));
		const serverErrors = await (await context.request.get(app.origin + '/__recovery-diagnostics')).json();
		const path = testInfo.outputPath(stage + '.json');
		await writeFile(
			path,
			JSON.stringify(
				{
					observedAt: new Date().toISOString(),
					project: testInfo.project.name,
					url: publicDiagnostic(page.url()),
					mainCount: mains.length,
					mains: mains.map(publicDiagnostic),
					serverErrors,
					consoleEvents,
					pageErrors,
					network
				},
				null,
				2
			)
		);
		await testInfo.attach(stage, { path, contentType: 'application/json' });
		await page.screenshot({ path: testInfo.outputPath(stage + '.png'), fullPage: true });
	}
	async function neutral(target = page, publicPage = true) {
		await expect(target.getByRole('link', { name: recoveryName, exact: true })).toHaveCount(0);
		await expect(target.getByRole('link', { name: /Retour à (?:l’accueil|mon accueil)/ })).toHaveCount(0);
		await expect(target.getByText(publicPage ? neutralHelp : generalHelp, { exact: true })).toBeVisible();
		await expect(target.getByText(publicPage ? generalHelp : neutralHelp, { exact: true })).toHaveCount(0);
	}
	function publicHeaders(response: Response) {
		expect(response.headers()['cache-control']).toBe('no-store');
		expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow');
		expect(response.headers()['set-cookie']).toBeUndefined();
	}
	async function safe(target = page) {
		await expect(target.getByRole('main')).toHaveCount(1);
		await expect(target.getByRole('heading', { level: 1 })).toHaveCount(1);
		await expect(target.locator('meta[name="robots"][content="noindex, nofollow"]')).toHaveCount(1);
		expect(await target.content()).not.toMatch(privateDetails);
		expect(await target.locator('body').innerText()).not.toMatch(/Internal Error|Error:|stack|libsql/i);
		expect(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	}
	async function open(path: string) {
		const response = await page.goto(app.origin + path);
		await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
		return response;
	}
	async function check(path: string, status: number, heading: string, name: string) {
		const response = await open(path);
		expect(response?.status()).toBe(status);
		await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
		await safe();
		await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
		await page.screenshot({ path: testInfo.outputPath(name + '.png'), fullPage: true });
		return response!;
	}
	async function skip(target = page, name = 'Aller au contenu') {
		await target.keyboard.press('Tab');
		await expect(target.getByRole('link', { name, exact: true })).toBeFocused();
		await target.keyboard.press('Enter');
		await expect(target.getByRole('main')).toBeFocused();
	}

	await open('/__recovery-links');
	// Kit uses the universal loader's returned data, not an implicit merge with server data.
	const valid = await open(modulePath);
	expect(valid?.status()).toBe(200);
	publicHeaders(valid!);
	await expect(page.getByRole('main')).toHaveCount(1);
	await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
	await expect(
		page.getByRole('heading', { level: 1, name: 'Application web · publication démo', exact: true })
	).toBeVisible();
	expect(await valid!.text()).not.toMatch(privateDetails);
	expect(pageErrors).toEqual([]);
	const initialData = await context.request.get(app.origin + modulePath + '/__data.json');
	expect(initialData.status()).toBe(200);
	expect(await initialData.text()).not.toContain('publicClassId');
	const controlStart = network.length;
	const directoryData = page.waitForResponse(
		(response) => new URL(response.url()).pathname === classPath + '/__data.json'
	);
	await page.locator('a[href="' + classPath + '"]').click();
	expect((await directoryData).status()).toBe(200);
	await expect(page).toHaveURL(app.origin + classPath);
	await expect(page.getByRole('main')).toHaveCount(1);
	await expect(page.getByRole('link', { name: /Application web · publication démo/ })).toHaveCount(1);
	expect(network.slice(controlStart).filter((response) => response.resourceType === 'document')).toEqual([]);
	await collectRecoveryEvidence('valid-module-to-class-spa');
	await check('/missing-error-page', 404, 'Cette page est introuvable', 'root-404');
	await neutral(page, false);
	await expect(page.getByRole('link', { name: 'Réessayer', exact: true })).toHaveCount(0);
	await skip();

	// Neither a real public-class referrer/query nor a plausible class name creates evidence.
	await open(classPath);
	const unknown = await check(
		'/modules/' + missingId + '?classId=' + app.ids.currentClass + '#B3',
		404,
		'Cette page est introuvable',
		'public-404'
	);
	publicHeaders(unknown);
	expect(await unknown.text()).not.toContain('"publicClassId":"' + app.ids.currentClass + '"');
	await neutral();
	publicHeaders(await check('/classes/' + missingId, 404, 'Cette page est introuvable', 'class-404'));
	await neutral();
	publicHeaders(
		await check(modulePath + '?failure=early', 503, 'Cette page ne répond pas pour le moment', 'public-503')
	);
	await neutral();

	// The unchanged public loader must first acquire evidence through the real v2 readers.
	publicHeaders(
		await check(modulePath + '?failure=ssr', 500, 'Cette page ne répond pas pour le moment', 'public-ssr-500')
	);
	await expect(page.locator('[data-page-status]')).toHaveAttribute('data-page-status', '500');
	const ssrErrors = await (await context.request.get(app.origin + '/__recovery-diagnostics')).json();
	expect(ssrErrors).toContainEqual(
		expect.objectContaining({
			failure: 'ssr',
			kind: 'unknown',
			originalErrorName: 'Error',
			originalErrorMarker: 'PRIVATE_SSR_FIXTURE_MARKER',
			missingSnapshotTitle: false,
			proofAcquired: true,
			promiseResult: false
		})
	);
	await collectRecoveryEvidence('ssr-guard-before-recovery');
	const recovery = page.getByRole('link', { name: recoveryName, exact: true });
	await expect(recovery).toHaveAttribute('href', classPath);
	await skip();
	await page.keyboard.press('Tab');
	await expect(page.getByRole('link', { name: 'Réessayer', exact: true })).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(recovery).toBeFocused();
	expect(await recovery.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
	await expect(recovery).toHaveAttribute('data-sveltekit-reload', 'true');
	const recoveryDocument = page.waitForResponse(
		(response) => new URL(response.url()).pathname === classPath && response.request().resourceType() === 'document'
	);
	await page.keyboard.press('Enter');
	try {
		const recovered = await recoveryDocument;
		expect(recovered.status()).toBe(200);
		expect(recovered.request().method()).toBe('GET');
		publicHeaders(recovered);
		await expect(page).toHaveURL(app.origin + classPath);
		await expect(page.getByRole('main')).toHaveCount(1);
		await expect(page.getByRole('link', { name: /Application web · publication démo/ })).toHaveCount(1);
		await expect(page.getByRole('link', { name: /Application web · publication démo/ })).toBeVisible();
	} finally {
		await collectRecoveryEvidence('after-ssr-recovery');
		page.off('console', onConsole);
		page.off('pageerror', onPageError);
		page.off('response', onResponse);
	}

	await open('/__recovery-links');
	// Observe the same response Kit consumes without depending on CDP's retained response body.
	await page.evaluate((path) => {
		const observed = window as typeof window & {
			__recoveryBody?: Promise<string>;
			__restoreRecoveryFetch?: () => void;
		};
		const original = window.fetch;
		observed.__restoreRecoveryFetch = () => {
			window.fetch = original;
		};
		window.fetch = async function (...args: Parameters<typeof fetch>) {
			const response = await original.apply(this, args);
			const url = new URL(response.url);
			if (url.origin === location.origin && url.pathname === path && url.searchParams.get('failure') === 'loader') {
				observed.__recoveryBody = response.clone().text();
				void observed.__recoveryBody.catch(() => {});
				window.fetch = original;
			}
			return response;
		};
	}, modulePath + '/__data.json');
	const loaderDocuments: string[] = [];
	const onLoaderRequest = (request: Request) => {
		if (request.isNavigationRequest() && request.frame() === page.mainFrame())
			loaderDocuments.push(publicDiagnostic(request.url()));
	};
	page.on('request', onLoaderRequest);
	try {
		const dataResponse = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				url.origin === app.origin &&
				url.pathname === modulePath + '/__data.json' &&
				url.searchParams.get('failure') === 'loader' &&
				response.request().resourceType() === 'fetch'
			);
		});
		await page.getByRole('link', { name: 'loader', exact: true }).click();
		const data = await dataResponse;
		expect(data.status()).toBe(200); // Kit's native data envelope, not a successful page.
		publicHeaders(data);
		await expect(page.locator('[data-page-status]')).toHaveAttribute('data-page-status', '500');
		const envelope = JSON.parse(
			await page.evaluate(async () => {
				const body = (window as typeof window & { __recoveryBody?: Promise<string> }).__recoveryBody;
				if (!body) throw new Error('The loader response was not observed in this document.');
				return await body;
			})
		);
		expect(loaderDocuments).toEqual([]);
		expect(envelope.nodes).toContainEqual(
			expect.objectContaining({
				type: 'error',
				error: expect.objectContaining({ status: 500, publicClassId: app.ids.currentClass })
			})
		);
		expect(JSON.stringify(envelope)).not.toMatch(privateDetails);
		await expect(recovery).toHaveAttribute('href', classPath);
		await safe();
		await page.screenshot({
			path: testInfo.outputPath('public-navigation-500.png'),
			fullPage: true
		});
	} finally {
		page.off('request', onLoaderRequest);
		await page.evaluate(() => {
			const observed = window as typeof window & {
				__recoveryBody?: Promise<string>;
				__restoreRecoveryFetch?: () => void;
			};
			observed.__restoreRecoveryFetch?.();
			delete observed.__recoveryBody;
			delete observed.__restoreRecoveryFetch;
		});
	}

	await open(modulePath);
	await expect(
		page.getByRole('heading', { level: 1, name: 'Application web · publication démo', exact: true })
	).toBeVisible();
	const successData = await context.request.get(app.origin + modulePath + '/__data.json');
	expect(successData.status()).toBe(200);
	expect(await successData.text()).not.toContain('publicClassId');
	await open('/__recovery-links');
	await page.getByRole('link', { name: 'client', exact: true }).click();
	await expect(page.locator('[data-page-status]')).toHaveAttribute('data-page-status', '500');
	await neutral();
	await safe();
	await page.screenshot({ path: testInfo.outputPath('public-client-500.png'), fullPage: true });

	// One batched responsive/theme pass: incumbent layout, 320px reflow, keyboard and dark mode.
	const viewport = page.viewportSize()!;
	for (const colorScheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
		await page.setViewportSize({ width: 320, height: 844 });
		await check(
			modulePath + '?failure=ssr',
			500,
			'Cette page ne répond pas pour le moment',
			'public-320-' + colorScheme
		);
		await expect(recovery).toHaveAttribute('href', classPath);
		await expect(recovery).toBeInViewport();
		const box = await recovery.boundingBox();
		expect(box!.width).toBeGreaterThanOrEqual(24);
		expect(box!.height).toBeGreaterThanOrEqual(24);
	}
	await page.setViewportSize(viewport);
	await page.emulateMedia({ colorScheme: 'light' });
	await check('/__error-fixture', 500, 'Cette page ne répond pas pour le moment', 'root-500');
	await neutral(page, false);
	await Promise.all([
		page.waitForEvent('load', { timeout: 15000 }),
		page.getByRole('link', { name: 'Réessayer', exact: true }).click()
	]);
	await expect(
		page.getByRole('heading', { name: 'Cette page ne répond pas pour le moment', exact: true })
	).toBeVisible();

	await activate(page, app);
	const sessionBefore = await app.call('session-state');
	publicHeaders(
		await check(
			'/modules/' + missingId + '?classId=' + app.ids.currentClass,
			404,
			'Cette page est introuvable',
			'public-teacher-cookie-404'
		)
	);
	await neutral();
	expect(await app.call('session-state')).toEqual(sessionBefore);
	await expect(page.getByRole('link', { name: 'Mon atelier', exact: true })).toHaveCount(0);
	await check('/enseignant/modules/' + missingId, 404, 'Cet élément est introuvable', 'teacher-404');
	await expect(page.getByRole('link', { name: 'Retour à mon accueil', exact: true })).toHaveAttribute('href', '/');
	await check('/enseignant/__error-fixture', 500, 'Cet espace ne répond pas pour le moment', 'teacher-500');
	await expect(page.getByRole('link', { name: 'Réessayer', exact: true })).toBeVisible();
	await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
	await page.reload();
	await expect(page.locator('html')).toHaveClass(/\bdark\b/);
	await page.screenshot({ path: testInfo.outputPath('teacher-500-dark.png'), fullPage: true });

	// The fatal document remains useful without scripts/styles and with no audience proof.
	const noScript = await context.browser()!.newContext({ javaScriptEnabled: false, viewport });
	await noScript.route('**/*', (route) =>
		new URL(route.request().url()).origin === app.origin ? route.continue() : route.abort()
	);
	try {
		const fatal: Page = await noScript.newPage();
		for (const path of ['/__error-fallback', '/modules/__error-fallback']) {
			const response = await fatal.goto(app.origin + path);
			expect(response?.status()).toBe(500);
			if (path.startsWith('/modules/')) publicHeaders(response!);
			await expect(
				fatal.getByRole('heading', {
					name: 'Campus ne peut pas afficher cette page',
					exact: true
				})
			).toBeVisible();
			expect(await response!.text()).not.toMatch(privateDetails);
			await neutral(fatal, false);
			await expect(fatal.getByRole('link', { name: 'Réessayer', exact: true })).toHaveAttribute('href', '');
			await safe(fatal);
			await skip(fatal, 'Aller au contenu principal');
			await fatal.screenshot({
				path: testInfo.outputPath(path.startsWith('/modules/') ? 'public-fallback.png' : 'fallback.png'),
				fullPage: true
			});
		}
	} finally {
		await noScript.close();
	}
});
