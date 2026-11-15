import { openModulePages } from './support/module-navigation.js';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { createDatabase } from '../../src/lib/server/db/index.js';
import * as tables from '../../src/lib/server/db/schema.js';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';

const schemes = ['light', 'dark'] as const;
type Scheme = (typeof schemes)[number];
const themeTrigger = (page: Page) => page.getByRole('button', { name: 'Choisir le thème', exact: true });

const setNavigation = async (page: Page, open: boolean, mobile: boolean) => {
	const profile = page.getByRole('button', { name: /^Menu utilisateur de / });
	await expect(async () => {
		if ((await profile.isVisible()) !== open) {
			if (open) await page.getByRole('button', { name: /^(Ouvrir|Afficher) la navigation$/ }).click();
			else if (mobile) await page.keyboard.press('Escape');
			else await page.getByRole('button', { name: 'Masquer la navigation', exact: true }).click();
		}
		if (open) await expect(profile).toBeVisible({ timeout: 1000 });
		else await expect(profile).not.toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
};

const openWithKeyboard = async (page: Page, trigger: Locator, content: Locator) => {
	await expect(async () => {
		if (!(await content.isVisible())) {
			await trigger.focus();
			await page.keyboard.press('Enter');
		}
		await expect(content).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
};

test('harmonized surfaces contain their content and keep keyboard focus visible', async ({ app, page }, info) => {
	test.setTimeout(900000);
	const mobile = info.project.name === 'mobile';
	const width = mobile ? 390 : 1440;
	const failures: string[] = [];
	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	page.on('dialog', async (dialog) => {
		if (dialog.type() === 'beforeunload') await dialog.accept();
		else {
			failures.push(`Unexpected browser dialog: ${dialog.type()}`);
			await dialog.dismiss();
		}
	});
	await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
	await activate(page, app);
	expect(new URL(app.origin).hostname).toBe('localhost');
	expect(resolve(app.manifest.databasePath)).toContain(`${app.manifest.directory}/`);
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	const db = createDatabase(client);
	const longTitle = 'Application web — Concevoir une navigation accessible et documenter les décisions du projet';
	const longAssessment = 'Projet — Concevoir, développer et présenter une application web accessible';

	const inspectSurface = async (name: string, scheme: Scheme, focus = themeTrigger(page)) => {
		await expect(page.locator('h1').first()).toBeVisible();
		await expect(page.locator('html')).toHaveCSS('color-scheme', scheme);
		await page.evaluate(() => document.fonts.ready);
		await page.keyboard.press((await page.getByRole('menu').isVisible()) ? 'ArrowDown' : 'Tab');
		await focus.focus();
		await expect(focus).toBeFocused();
		await expect(focus).toBeInViewport();
		const metrics = await page.evaluate(() => {
			const active = document.activeElement as HTMLElement | null;
			const style = active ? getComputedStyle(active) : null;
			const ringProbe = document.createElement('span');
			ringProbe.style.color = 'var(--ring)';
			document.body.append(ringProbe);
			const ringColor = getComputedStyle(ringProbe).color;
			ringProbe.remove();
			const fieldBorderIndicator =
				!!style &&
				!!active?.matches('input, textarea, select') &&
				style.borderTopStyle !== 'none' &&
				parseFloat(style.borderTopWidth) > 0 &&
				style.borderTopColor === ringColor;
			const contentCommands = [
				...document.querySelectorAll<HTMLElement>(
					'main button, main [data-slot="button"], [role="dialog"] button, [role="alertdialog"] button'
				)
			]
				.filter((command) => {
					if (
						!command.getClientRects().length ||
						getComputedStyle(command).visibility !== 'visible' ||
						command.closest('[aria-hidden="true"], [inert], [data-slot="sidebar-container"]')
					)
						return false;
					for (
						let ancestor = command.parentElement;
						ancestor && ancestor !== document.body;
						ancestor = ancestor.parentElement
					) {
						if (
							['auto', 'scroll'].includes(getComputedStyle(ancestor).overflowX) &&
							ancestor.scrollWidth > ancestor.clientWidth + 1
						)
							return false;
					}
					return true;
				})
				.map((command) => {
					const commandBounds = command.getBoundingClientRect();
					return {
						name: (command.getAttribute('aria-label') || command.textContent || '').trim().replace(/\s+/g, ' '),
						left: commandBounds.left,
						right: commandBounds.right
					};
				});
			const bounds = active?.getBoundingClientRect();
			return {
				viewport: { width: innerWidth, height: innerHeight },
				overflow: document.documentElement.scrollWidth - innerWidth,
				contentCommands,
				overflowingCommands: contentCommands.filter((command) => command.left < -1 || command.right > innerWidth + 1),
				clippedHeadings: [...document.querySelectorAll<HTMLElement>('h1')]
					.filter((node) => node.getBoundingClientRect().width > 0)
					.map((node) => ({
						text: node.textContent?.trim(),
						overflow: node.scrollWidth - node.clientWidth
					}))
					.filter((item) => item.overflow > 1),
				focus: {
					name: active?.getAttribute('aria-label') || active?.textContent?.trim(),
					visible: active?.matches(':focus-visible') ?? false,
					indicator:
						!!style &&
						((style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
							style.boxShadow !== 'none' ||
							fieldBorderIndicator),
					borderColor: style?.borderTopColor,
					ringColor,
					inViewport:
						!!bounds &&
						bounds.left >= -1 &&
						bounds.right <= innerWidth + 1 &&
						bounds.top >= -1 &&
						bounds.bottom <= innerHeight + 1
				},
				interLoaded: [...document.fonts].some((font) => font.family.includes('Inter') && font.status === 'loaded')
			};
		});
		const key = `${name}-${width}-${scheme}`;
		if (metrics.overflow > 1) failures.push(`${key}: document overflow ${metrics.overflow}px`);
		for (const command of metrics.overflowingCommands)
			failures.push(`${key}: command outside viewport: ${command.name} (${command.left}..${command.right})`);
		if (
			name === 'correction' &&
			!metrics.contentCommands.some((command) => command.name === `Enregistrer ${longAssessment}`)
		)
			failures.push(`${key}: the long assessment save command was not measured`);
		if (metrics.clippedHeadings.length) failures.push(`${key}: clipped heading`);
		if (!metrics.focus.visible || !metrics.focus.indicator || !metrics.focus.inViewport)
			failures.push(`${key}: keyboard focus is not visibly in the viewport`);
		if (!metrics.interLoaded) failures.push(`${key}: Inter was not loaded`);
	};
	const visit = async (path: string) => {
		await page.goto(app.origin + path);
		await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
	};

	try {
		await db.update(tables.modules).set({ title: longTitle }).where(eq(tables.modules.id, app.ids.module));
		await db
			.update(tables.assessments)
			.set({ title: longAssessment })
			.where(eq(tables.assessments.id, app.ids.project));
		await db
			.update(tables.students)
			.set({ name: 'Aline Moreau — Étudiante au nom de démonstration particulièrement long' })
			.where(eq(tables.students.id, app.ids.students[0]));
		const modulePath = `/enseignant/modules/${app.ids.module}`;
		const rubricPath = `${modulePath}/bareme?retour=module`;
		const paths = [
			['home', '/'],
			['module', modulePath],
			['rubric', rubricPath],
			['grading', `/enseignant/notation?module=${app.ids.module}&contexte=${app.ids.currentContext}`],
			['correction', `/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`],
			['proposal', `/enseignant/propositions?proposition=${app.ids.proposals[0]}`],
			[
				'publication',
				`/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`
			],
			['annual', '/enseignant/classes/annees?annee=2026-2027'],
			['account', '/enseignant/compte'],
			['public-module', `/modules/${app.ids.publicationContext}`]
		] as const;
		for (const scheme of schemes) {
			await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
			await visit('/');
			await setNavigation(page, !mobile, mobile);
			for (const [name, path] of paths) {
				await visit(path);
				if (name === 'account')
					await expect(page.getByRole('button', { name: 'Enregistrer', exact: true })).toBeEnabled();
				if (name === 'annual')
					await expect(page.getByRole('button', { name: 'Préparer la clôture', exact: true })).toBeEnabled();
				if (name === 'module') await readyModuleEditor(page);
				if (name === 'correction')
					await expect(async () => {
						await page.getByLabel('Évaluation', { exact: true }).selectOption({ label: longAssessment });
						await expect(page.getByRole('tab', { name: 'Fonctionnalités', exact: true })).toBeVisible({
							timeout: 1000
						});
					}).toPass({ timeout: 60000 });
				await inspectSurface(name, scheme);
			}
			await visit('/');
			await setNavigation(page, mobile, mobile);
			await inspectSurface(
				mobile ? 'home-navigation-open' : 'home-navigation-closed',
				scheme,
				mobile ? page.getByRole('button', { name: /^Menu utilisateur de / }) : themeTrigger(page)
			);
			await setNavigation(page, false, mobile);
			const menu = page.getByRole('menu');
			await openWithKeyboard(page, themeTrigger(page), menu);
			await inspectSurface('theme-menu', scheme, menu.getByRole('menuitemradio').first());
			await page.keyboard.press('Escape');
			await expect(themeTrigger(page)).toBeFocused();
			await setNavigation(page, !mobile, mobile);
		}

		await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
		await visit('/enseignant/modules/nouveau');
		await inspectSurface('module-create-empty', 'light', page.getByLabel('Nom du module', { exact: true }));
		await visit(modulePath);
		await readyModuleEditor(page);
		const moduleNavigation = await openModulePages(page);
		await expect(moduleNavigation.getByRole('link')).toHaveCount(5);
		const quizLink = moduleNavigation.getByRole('link', { name: 'Quiz', exact: true });
		await moduleNavigation.getByRole('link').first().focus();
		await page.keyboard.press('Tab');
		await expect(quizLink).toBeFocused();
		await inspectSurface('module-navigation', 'light', quizLink);
		await visit(rubricPath);
		await openWithKeyboard(
			page,
			page.getByRole('tab', { name: new RegExp(`^${longAssessment}`) }),
			page.getByRole('tabpanel', { name: new RegExp(`^${longAssessment}`) })
		);
		const maximum = page.getByLabel('Maximum du critère 1 (pts)', { exact: true }).first();
		const previousMaximum = await maximum.inputValue();
		await maximum.fill('0');
		await page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).first().click();
		await expect(maximum).toHaveAttribute('aria-invalid', 'true');
		await inspectSurface('rubric-invalid', 'light', maximum);
		await maximum.fill(previousMaximum);
		await page.reload();
		await visit('/enseignant/classes/annees?annee=2026-2027');
		await openWithKeyboard(
			page,
			page.getByRole('button', { name: 'Préparer la clôture', exact: true }),
			page.getByRole('button', { name: 'Vérifier et confirmer la clôture', exact: true })
		);
		await openWithKeyboard(
			page,
			page.getByRole('button', { name: 'Vérifier et confirmer la clôture', exact: true }),
			page.getByRole('alertdialog')
		);
		await inspectSurface(
			'annual-confirmation',
			'light',
			page.getByRole('alertdialog').getByRole('button', { name: 'Annuler', exact: true })
		);
		await page.keyboard.press('Escape');
	} finally {
		client.close();
	}
	expect(failures).toEqual([]);
	expect(pageErrors).toEqual([]);
});
