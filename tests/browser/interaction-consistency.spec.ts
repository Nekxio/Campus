import type { NativeQuizFixture } from '../../src/lib/server/db/testing/quiz-fixtures.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('workspace and public surfaces preserve keyboard focus in both themes', async ({ app, page }, info) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await activate(page, app);
	const quiz = await app.call<NativeQuizFixture>('native-quiz');
	const modulePath = `/enseignant/modules/${app.ids.module}`;
	const screens = [
		['home', '/'],
		['modules', '/enseignant/modules'],
		['classes', '/enseignant/classes'],
		['annual', '/enseignant/classes/annees?annee=2026-2027'],
		['module', modulePath],
		['rubric', `${modulePath}/bareme?contexte=${app.ids.currentContext}`],
		['grading', `/enseignant/notation?contexte=${app.ids.currentContext}`],
		['correction', `/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`],
		['proposals', '/enseignant/propositions'],
		['proposal', `/enseignant/propositions?proposition=${app.ids.proposals[0]}`],
		['publication', `/enseignant/modules/${app.ids.publicationModule}/publication`],
		['published-pages', '/enseignant/vue-etudiante'],
		['quiz', `/enseignant/modules/${quiz.moduleId}/quiz?contexte=${quiz.contextId}`],
		['account', '/enseignant/compte'],
		['applications', '/enseignant/applications'],
		['public-class', `/classes/${app.ids.currentClass}`],
		['public-course', `/modules/${app.ids.publicationContext}`],
		['teacher-error', '/enseignant/modules/00000000-0000-4000-8000-000000000000']
	] as const;
	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		for (const [name, path] of screens) {
			await test.step(`${name}, ${scheme}`, async () => {
				const response = await page.goto(app.origin + path);
				expect(response?.status()).toBe(name === 'teacher-error' ? 404 : 200);
				await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
				await expect(page.locator('html')).toHaveCSS('color-scheme', scheme);
				const theme = page.getByRole('button', { name: 'Choisir le thème', exact: true });
				await expect(async () => {
					if ((await theme.getAttribute('aria-expanded')) !== 'true') {
						await theme.focus();
						await page.keyboard.press('Enter');
					}
					await expect(page.getByRole('menu')).toBeVisible({ timeout: 1000 });
				}).toPass({ timeout: 15000 });
				await page.keyboard.press('Escape');
				await expect(theme).toBeFocused();
				await expect
					.poll(() =>
						theme.evaluate((element) => {
							const style = getComputedStyle(element);
							return {
								keyboard: element.matches(':focus-visible'),
								outline: style.outlineStyle,
								width: parseFloat(style.outlineWidth)
							};
						})
					)
					.toEqual({ keyboard: true, outline: 'solid', width: 2 });
				expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
				await page.screenshot({
					path: info.outputPath(`${name}-${scheme}.png`),
					fullPage: true,
					animations: 'disabled'
				});
			});
		}
	}
	expect(errors).toEqual([]);
});

test('calendar navigation becomes disabled while the requested month loads', async ({ app, page }) => {
	await activate(page, app);
	await page.goto(app.origin + '/');
	const mobileCalendar = page.locator('.mobile-calendar > summary');
	if (await mobileCalendar.isVisible()) await mobileCalendar.click();
	const calendar = page.locator('.lesson-calendar:visible');
	await expect(calendar).toHaveCount(1);
	const next = calendar.getByRole('button', { name: 'Mois suivant', exact: true });
	const previous = calendar.getByRole('button', { name: 'Mois précédent', exact: true });
	await expect(next).toBeEnabled();
	let release = () => {};
	const held = new Promise<void>((resolve) => (release = resolve));
	await page.route('**/*mois=*', async (route) => {
		await held;
		await route.continue();
	});
	try {
		await expect(async () => {
			await next.focus();
			await page.keyboard.press('Enter');
			await expect(calendar).toHaveAttribute('aria-busy', 'true', { timeout: 1000 });
		}).toPass({ timeout: 10000 });
		await expect(next).toBeDisabled();
		await expect(previous).toBeDisabled();
		await expect(calendar.getByRole('status')).toHaveText('Chargement des séances…');
	} finally {
		release();
	}
	await expect(calendar).toHaveAttribute('aria-busy', 'false');
	await expect(next).toBeEnabled();
	await expect(previous).toBeEnabled();
});

test('workspaces reflow at narrow and zoom-equivalent widths', async ({ app, page }, info) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await activate(page, app);
	const screens = [
		['modules', '/enseignant/modules'],
		['module', `/enseignant/modules/${app.ids.module}`],
		['classes', '/enseignant/classes'],
		['published-pages', '/enseignant/vue-etudiante'],
		['public-class', `/classes/${app.ids.currentClass}`],
		['public-course', `/modules/${app.ids.publicationContext}`]
	] as const;
	for (const width of [320, 640]) {
		await page.setViewportSize({ width, height: 900 });
		for (const [name, path] of screens) {
			await test.step(`${name} at ${width}px`, async () => {
				await page.goto(app.origin + path);
				await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
				expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
				await page.screenshot({
					path: info.outputPath(`${name}-${width}.png`),
					fullPage: true,
					animations: 'disabled'
				});
			});
		}
	}
});
