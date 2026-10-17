import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('error boundaries offer safe recovery without exposing server details', async ({
	app,
	page,
	context
}, testInfo) => {
	// Failure injection stays inside the disposable copy; production routes and guards stay intact.
	for (const route of ['__error-fixture', 'enseignant/__error-fixture']) {
		const directory = join(app.manifest.directory, 'src/routes', route);
		await mkdir(directory, { recursive: true });
		await writeFile(join(directory, '+page.svelte'), '<p>Unreachable fixture page</p>');
		await writeFile(
			join(directory, '+page.server.ts'),
			"export const load = () => { throw new Error('PRIVATE_ERROR_FIXTURE_MARKER'); };\n"
		);
	}
	const fallback = join(app.manifest.directory, 'src/routes/__error-fallback');
	await mkdir(fallback, { recursive: true });
	await writeFile(
		join(fallback, '+server.ts'),
		"export const GET = () => { throw new Error('PRIVATE_FALLBACK_FIXTURE_MARKER'); };\n"
	);

	async function check(path: string, status: number, heading: string, name: string) {
		const response = await page.goto(app.origin + path);
		expect(response?.status()).toBe(status);
		await expect(page.getByRole('main')).toHaveCount(1);
		await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
		await expect(page.locator('meta[name="robots"][content="noindex, nofollow"]')).toHaveCount(1);
		expect(await page.content()).not.toMatch(/PRIVATE_(?:ERROR|FALLBACK)_FIXTURE_MARKER/);
		expect(await page.locator('body').innerText()).not.toMatch(
			/Internal Error|Error:|stack|libsql/i
		);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		await page.screenshot({ path: testInfo.outputPath(name + '.png'), fullPage: true });
		return response;
	}

	await check('/missing-error-page', 404, 'Cette page est introuvable', 'root-404');
	await expect(page.getByRole('link', { name: 'Réessayer', exact: true })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Retour à l’accueil', exact: true })).toHaveAttribute(
		'href',
		'/'
	);
	await page.keyboard.press('Tab');
	await expect(page.getByRole('link', { name: 'Aller au contenu', exact: true })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('main')).toBeFocused();

	const publicResponse = await check(
		'/modules/00000000-0000-4000-8000-000000000000',
		404,
		'Cette page est introuvable',
		'public-404'
	);
	expect(publicResponse?.headers()['cache-control']).toBe('no-store');
	await expect(page.getByText('demandez un nouveau lien', { exact: false })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Retour à la classe', exact: true })).toHaveCount(0);
	await check(
		'/classes/00000000-0000-4000-8000-000000000000',
		404,
		'Cette page est introuvable',
		'class-404'
	);

	await check('/__error-fixture', 500, 'Cette page ne répond pas pour le moment', 'root-500');
	await Promise.all([
		page.waitForEvent('load', { timeout: 15000 }),
		page.getByRole('link', { name: 'Réessayer', exact: true }).click()
	]);
	await expect(
		page.getByRole('heading', { name: 'Cette page ne répond pas pour le moment', exact: true })
	).toBeVisible();

	await activate(page, app);
	await check(
		'/enseignant/modules/00000000-0000-4000-8000-000000000000',
		404,
		'Cet élément est introuvable',
		'teacher-404'
	);
	await expect(
		page.getByRole('link', { name: 'Retour à mon accueil', exact: true })
	).toHaveAttribute('href', '/');
	await check(
		'/enseignant/__error-fixture',
		500,
		'Cet espace ne répond pas pour le moment',
		'teacher-500'
	);
	await expect(page.getByRole('link', { name: 'Réessayer', exact: true })).toBeVisible();
	await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
	await page.reload();
	await expect(page.locator('html')).toHaveClass(/\bdark\b/);
	await page.screenshot({ path: testInfo.outputPath('teacher-500-dark.png'), fullPage: true });

	// The fatal HTML response remains useful without scripts or stylesheet downloads.
	const noScript = await context.browser()!.newContext({
		javaScriptEnabled: false,
		viewport: page.viewportSize()!
	});
	try {
		const fatal: Page = await noScript.newPage();
		const response = await fatal.goto(app.origin + '/__error-fallback');
		expect(response?.status()).toBe(500);
		await expect(
			fatal.getByRole('heading', { name: 'Coursely ne peut pas afficher cette page', exact: true })
		).toBeVisible();
		expect(await response!.text()).not.toContain('PRIVATE_FALLBACK_FIXTURE_MARKER');
		await expect(
			fatal.getByRole('link', { name: 'Retour à l’accueil', exact: true })
		).toHaveAttribute('href', '/');
		await fatal.keyboard.press('Tab');
		await expect(
			fatal.getByRole('link', { name: 'Aller au contenu principal', exact: true })
		).toBeFocused();
		await fatal.keyboard.press('Enter');
		await expect(fatal.getByRole('main')).toBeFocused();
		await fatal.screenshot({ path: testInfo.outputPath('fallback.png'), fullPage: true });
	} finally {
		await noScript.close();
	}
});
