import { openModulePages } from './support/module-navigation.js';
import { createClient } from '@libsql/client';
import { eq, ne } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { createDatabase } from '../../src/lib/server/db/index.js';
import * as tables from '../../src/lib/server/db/schema.js';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';

const themeTrigger = (page: Page) => page.getByRole('button', { name: 'Choisir le thème', exact: true });

const openThemeMenu = async (page: Page) => {
	const trigger = themeTrigger(page);
	await expect(trigger).toHaveCount(1);
	await expect(trigger).toBeInViewport();
	await expect(async () => {
		if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
			await trigger.focus();
			await page.keyboard.press('Enter');
		}
		await expect(trigger).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 });
		await expect(page.getByRole('menu')).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await expect(page.getByRole('menu')).toHaveCSS('opacity', '1');
	return page.getByRole('menu');
};

const expectNoOverflow = async (page: Page) => {
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
};

const expectUnclipped = async (element: Locator) => {
	await expect(element).toBeVisible();
	const clipping = await element.evaluate((node) => ({
		horizontal: node.scrollWidth - node.clientWidth,
		vertical: node.scrollHeight - node.clientHeight
	}));
	expect(clipping.horizontal).toBeLessThanOrEqual(1);
	expect(clipping.vertical).toBeLessThanOrEqual(1);
};

test('shared commands preserve complete words, contained long actions and settled keyboard menus', async ({
	app,
	page
}) => {
	test.setTimeout(90000);
	const width = page.viewportSize()!.width;
	const longAssessment = 'Projet — Concevoir, développer et présenter une application web accessible';
	const failures: string[] = [];
	await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
	await activate(page, app);
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	const db = createDatabase(client);
	const measure = async (command: Locator) =>
		command.evaluate((node) => {
			const bounds = node.getBoundingClientRect();
			const text = [...node.childNodes].find((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
			const range = document.createRange();
			if (text) range.selectNodeContents(text);
			return {
				text: node.textContent?.trim(),
				left: bounds.left,
				right: bounds.right,
				height: bounds.height,
				textLines: text ? range.getClientRects().length : 0
			};
		});
	const checkBounds = (name: string, bounds: Awaited<ReturnType<typeof measure>>) => {
		if (bounds.left < -1 || bounds.right > width + 1 || bounds.height < 44)
			failures.push(`${name}: command bounds ${JSON.stringify(bounds)}`);
	};
	const inspectMenu = async (item: Locator) => {
		await expect(item).toBeFocused();
		await expect(item).toBeInViewport();
		await expect
			.poll(async () => {
				const bounds = await item.boundingBox();
				return (
					!!bounds &&
					bounds.x >= -1 &&
					bounds.y >= -1 &&
					bounds.x + bounds.width <= width + 1 &&
					bounds.y + bounds.height <= page.viewportSize()!.height + 1
				);
			})
			.toBe(true);
		await expect
			.poll(() =>
				item.evaluate((node) => {
					const style = getComputedStyle(node);
					return (
						node.matches(':focus-visible') &&
						((style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none')
					);
				})
			)
			.toBe(true);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toHaveCount(0);
	};
	try {
		await db
			.update(tables.modules)
			.set({
				title: 'Application web — Concevoir une navigation accessible et documenter les décisions du projet'
			})
			.where(eq(tables.modules.id, app.ids.module));
		await db
			.update(tables.assessments)
			.set({ title: longAssessment })
			.where(eq(tables.assessments.id, app.ids.project));
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
			await page.goto(app.origin + '/enseignant/modules');
			await expect(page.locator('html')).toHaveCSS('color-scheme', scheme);
			const actions = page.getByRole('link', { name: 'Préparer', exact: true });
			expect(await actions.count()).toBeGreaterThan(0);
			for (const action of await actions.all()) {
				await expect(action).toBeVisible();
				const bounds = await measure(action);
				checkBounds(`library-${scheme}`, bounds);
				if (bounds.textLines !== 1) failures.push(`library-${scheme}: opening action wraps: ${JSON.stringify(bounds)}`);
			}
			const themeMenu = await openThemeMenu(page);
			await inspectMenu(themeMenu.getByRole('menuitemradio').first());
			await page.goto(`${app.origin}/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`);
			const save = page.getByRole('button', {
				name: `Enregistrer ${longAssessment}`,
				exact: true
			});
			await expect(async () => {
				await page.getByLabel('Évaluation', { exact: true }).selectOption({ label: longAssessment });
				await expect(save).toBeVisible({ timeout: 1000 });
			}).toPass({ timeout: 15000 });
			const bounds = await measure(save);
			checkBounds(`correction-${scheme}`, bounds);
			await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}`);
			await readyModuleEditor(page);
			const moduleNavigation = await openModulePages(page);
			await expect(moduleNavigation.getByRole('link')).toHaveCount(5);
			for (const link of await moduleNavigation.getByRole('link').all()) {
				await expectUnclipped(link);
				const bounds = await measure(link);
				checkBounds(`module-navigation-${scheme}`, bounds);
			}
			const focused = moduleNavigation.getByRole('link', { name: 'Quiz', exact: true });
			await moduleNavigation.getByRole('link').first().focus();
			await page.keyboard.press('Tab');
			await expect(focused).toBeFocused();
			await expect
				.poll(() =>
					focused.evaluate((node) => {
						const style = getComputedStyle(node);
						return (
							node.matches(':focus-visible') &&
							((style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none')
						);
					})
				)
				.toBe(true);
		}
	} finally {
		client.close();
	}
	expect(failures).toEqual([]);
});

test('header theme stays reachable with closed navigation and preserves all three preferences', async ({
	app,
	page
}, info) => {
	test.setTimeout(90000);
	await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
	await activate(page, app);
	const hideNavigation = page.getByRole('button', {
		name: 'Masquer la navigation',
		exact: true
	});
	await expect(async () => {
		if (await hideNavigation.isVisible()) await hideNavigation.click();
		await expect(page.getByRole('button', { name: /^(Ouvrir|Afficher) la navigation$/ })).toBeVisible({
			timeout: 1000
		});
	}).toPass({ timeout: 60000 });

	const trigger = themeTrigger(page);
	await expect(page.locator('header').getByRole('button', { name: 'Choisir le thème' })).toHaveCount(1);
	const triggerBounds = await trigger.boundingBox();
	expect(triggerBounds).not.toBeNull();
	expect(triggerBounds!.width).toBeGreaterThanOrEqual(44);
	expect(triggerBounds!.height).toBeGreaterThanOrEqual(44);
	const menu = await openThemeMenu(page);
	await expect(menu.getByRole('menuitemradio')).toHaveCount(3);
	await expect(menu.getByRole('menuitemradio', { name: 'Thème système' })).toHaveAttribute('aria-checked', 'true');
	const menuBounds = await menu.boundingBox();
	expect(menuBounds).not.toBeNull();
	expect(menuBounds!.y).toBeGreaterThanOrEqual(triggerBounds!.y + triggerBounds!.height - 1);
	expect(Math.abs(menuBounds!.x + menuBounds!.width - triggerBounds!.x - triggerBounds!.width)).toBeLessThanOrEqual(2);
	await page.keyboard.press('Escape');
	await expect(trigger).toBeFocused();
	await expect(menu).toHaveCount(0);
	expect(await trigger.evaluate((node) => node.matches(':focus-visible'))).toBe(true);
	const focusVisible = await trigger.evaluate((node) => {
		const style = getComputedStyle(node);
		return style.outlineStyle !== 'none' || style.boxShadow !== 'none';
	});
	expect(focusVisible).toBe(true);

	for (const [name, scheme, opposite] of [
		['Thème sombre', 'dark', 'light'],
		['Thème clair', 'light', 'dark']
	] as const) {
		await openThemeMenu(page);
		await page.getByRole('menuitemradio', { name, exact: true }).click();
		await expect(page.locator('html')).toHaveCSS('color-scheme', scheme);
		await page.emulateMedia({ colorScheme: opposite });
		await expect(page.locator('html')).toHaveCSS('color-scheme', scheme);
		await page.reload();
		await expect(page.locator('html')).toHaveCSS('color-scheme', scheme);
		await openThemeMenu(page);
		await expect(page.getByRole('menuitemradio', { name, exact: true })).toHaveAttribute('aria-checked', 'true');
		await expect(page.getByRole('menuitemradio', { checked: true })).toHaveCount(1);
		await page.keyboard.press('Escape');
	}

	await openThemeMenu(page);
	await page.getByRole('menuitemradio', { name: 'Thème système', exact: true }).click();
	for (const scheme of ['dark', 'light'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		await expect(page.locator('html')).toHaveCSS('color-scheme', scheme);
	}
	await page.reload();
	await openThemeMenu(page);
	await expect(page.getByRole('menuitemradio', { name: 'Thème système', exact: true })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await page.keyboard.press('Escape');
	await expectNoOverflow(page);

	if (info.project.name === 'desktop') {
		const showNavigation = page.getByRole('button', {
			name: 'Afficher la navigation',
			exact: true
		});
		if (await showNavigation.isVisible()) await showNavigation.click();
		await expect(hideNavigation).toBeVisible();
		await expect(trigger).toHaveCount(1);
		await expect(trigger).toBeInViewport();
	}
	await page.goto(`${app.origin}/modules/${app.ids.publicationContext}`);
	await expect(page.locator('header').getByRole('button', { name: 'Choisir le thème' })).toHaveCount(1);
	await openThemeMenu(page);
	await expect(page.getByRole('menuitemradio', { name: 'Thème système', exact: true })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await page.keyboard.press('Escape');
	await expectNoOverflow(page);
});

test('publication candidates retain long titles and usable actions for six, one and zero modules', async ({
	app,
	page
}, info) => {
	test.setTimeout(90000);
	await activate(page, app);
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	const db = createDatabase(client);
	const titles = [
		'Application web — Concevoir une navigation accessible et documenter les décisions du projet',
		'Architecture et développement — Étude complète d’un service numérique destiné aux étudiants',
		'ModuleSansEspacesPourVérifierLeRetourÀLaLigneMêmeAvecUnIntituléParticulièrementLong',
		'Interfaces multilingues — 日本語 et العربية dans les ressources pédagogiques',
		'Projet collectif — Préparer les livrables, la démonstration et la présentation finale',
		'Atelier de synthèse — Relecture du parcours utilisateur et bilan des compétences acquises'
	];
	try {
		await db.update(tables.modulePublications).set({ unpublishedAt: new Date() });
		await db.update(tables.modules).set({ pausedAt: new Date() });
		const candidates = titles.map((title) => ({ id: crypto.randomUUID(), title }));
		await db.insert(tables.modules).values(candidates);
		await page.goto(`${app.origin}/enseignant/vue-etudiante`);
		await expect(page.getByText('Aucune page publiée', { exact: true })).toBeVisible();
		await page.getByRole('link', { name: 'Choisir un module à publier', exact: true }).click();
		await page.getByLabel('Rechercher un module', { exact: true }).fill('');
		const choices = page.locator('.module-index');
		await expect(choices.getByRole('listitem')).toHaveCount(9);
		if (info.project.name === 'desktop') expect((await choices.boundingBox())!.width).toBeGreaterThanOrEqual(640);
		for (const candidate of candidates) {
			const title = choices.getByText(candidate.title, { exact: true });
			const row = choices.getByRole('listitem').filter({ has: page.getByText(candidate.title, { exact: true }) });
			const action = row.getByRole('link', { name: 'Publication', exact: true });
			await expectUnclipped(title);
			await expect(action).toHaveAttribute('href', `/enseignant/modules/${candidate.id}/publication`);
			await expectUnclipped(action);
			const titleBounds = await title.boundingBox();
			const actionBounds = await action.boundingBox();
			expect(titleBounds).not.toBeNull();
			expect(actionBounds).not.toBeNull();
			if (info.project.name === 'mobile')
				expect(actionBounds!.y).toBeGreaterThanOrEqual(titleBounds!.y + titleBounds!.height - 1);
			else expect(actionBounds!.x).toBeGreaterThanOrEqual(titleBounds!.x + titleBounds!.width - 1);
		}
		await expectNoOverflow(page);
		const remaining = candidates[0];
		await db.update(tables.modules).set({ pausedAt: new Date() }).where(ne(tables.modules.id, remaining.id));
		await page.reload();
		await expect(choices.getByRole('listitem')).toHaveCount(9);
		await expectUnclipped(choices.getByText(remaining.title, { exact: true }));
		await choices
			.getByRole('listitem')
			.filter({ hasText: remaining.title })
			.getByRole('link', { name: 'Publication', exact: true })
			.focus();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(`${app.origin}/enseignant/modules/${remaining.id}/publication`);
		await expect(page.getByRole('heading', { name: 'Publication du module', exact: true })).toBeVisible();
		await db.update(tables.modules).set({ pausedAt: new Date() }).where(eq(tables.modules.id, remaining.id));
		await page.goto(`${app.origin}/enseignant/vue-etudiante`);
		await expect(choices).toHaveCount(0);
		const create = page.getByRole('link', {
			name: 'Choisir un module à publier',
			exact: true
		});
		await expect(create).toHaveAttribute('href', '/enseignant/modules');
		await expectUnclipped(create);
		await expectNoOverflow(page);
	} finally {
		client.close();
	}
});
