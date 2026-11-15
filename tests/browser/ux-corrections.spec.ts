import { openModulePages } from './support/module-navigation.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import type { Page } from '@playwright/test';

const chooseTheme = async (page: Page, theme: 'light' | 'dark') => {
	const trigger = page.getByRole('button', { name: 'Choisir le thème', exact: true });
	const option = page.getByRole('menuitemradio', {
		name: theme === 'dark' ? 'Thème sombre' : 'Thème clair',
		exact: true
	});
	await expect(async () => {
		if (!(await option.isVisible())) {
			await trigger.focus();
			await page.keyboard.press('Enter');
		}
		await expect(option).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await option.focus();
	await page.keyboard.press('Enter');
	await expect(trigger).toBeFocused();
	await expectTheme(page, theme);
};

const expectTheme = async (page: Page, theme: 'light' | 'dark') => {
	if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
	else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
};

const expectNoOverflow = async (page: Page) => {
	expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
};

for (const theme of ['light', 'dark'] as const) {
	test(`grading preparation and empty proposals retain their teaching context (${theme})`, async ({
		page,
		app
	}, info) => {
		await page.emulateMedia({ colorScheme: theme });
		await activate(page, app);
		await chooseTheme(page, theme);
		const scope = new URLSearchParams({
			module: app.ids.module,
			classe: app.ids.currentClass,
			contexte: app.ids.currentContext
		});
		await page.goto(`${app.origin}/enseignant/notation?${scope}`);
		const preparation = (await openModulePages(page)).getByRole('link', {
			name: 'Préparer',
			exact: true
		});
		await expect(preparation).toBeVisible();
		await expectNoOverflow(page);
		await page.screenshot({
			path: info.outputPath(`notation-context-${theme}.png`),
			fullPage: true
		});
		const viewport = page.viewportSize()!;
		for (const width of info.project.name === 'desktop' ? [768, 1024, 1920] : [320]) {
			await page.setViewportSize({ ...viewport, width });
			await expectNoOverflow(page);
			if (width >= 1024) await expect(page.locator('.grading-identity')).not.toBeVisible();
			else await expect(page.locator('.grading-identity')).toBeVisible();
			await page.screenshot({
				path: info.outputPath(`notation-${width}-${theme}.png`),
				fullPage: true
			});
		}
		await page.setViewportSize(viewport);
		const destination = new URL((await preparation.getAttribute('href'))!, app.origin);
		expect(destination.pathname).toBe(`/enseignant/modules/${app.ids.module}`);
		expect(destination.searchParams.get('section')).toBe('preparation');
		expect(destination.searchParams.get('classe')).toBe(app.ids.currentClass);
		expect(destination.searchParams.get('contexte')).toBe(app.ids.currentContext);
		await preparation.focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('tabpanel', { name: 'Notes privées', exact: false })).toBeVisible();
		await page.reload();
		await expect(page.getByRole('tabpanel', { name: 'Notes privées', exact: false })).toBeVisible();
		await expectTheme(page, theme);
		await expectNoOverflow(page);
		await page.screenshot({ path: info.outputPath(`preparation-${theme}.png`), fullPage: true });
		await page.goto(
			`${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`
		);
		await expect(page.getByRole('heading', { name: 'Mise à jour de la publication', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Dépublier', exact: true })).toBeEnabled();
		await expectNoOverflow(page);
		await page.screenshot({ path: info.outputPath(`publication-${theme}.png`), fullPage: true });

		await page.goto(`${app.origin}/enseignant/propositions?contexte=${app.ids.publicationContext}`);
		await expect(page.getByText('Aucune proposition à examiner', { exact: true })).toBeVisible();
		const correct = page.getByRole('link', { name: 'Corriger depuis la notation', exact: true });
		await expect(correct).toBeVisible();
		await expectNoOverflow(page);
		await page.screenshot({ path: info.outputPath(`propositions-${theme}.png`), fullPage: true });
		await expect(page.getByRole('link', { name: 'Voir les applications connectées', exact: true })).toHaveAttribute(
			'href',
			'/enseignant/applications'
		);
		await correct.focus();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(new RegExp(`contexte=${app.ids.publicationContext}`));
		await expect(page.getByRole('heading', { name: 'Notation', exact: true })).toBeVisible();
		await expect(page.locator('#grading-module')).toHaveValue(app.ids.publicationModule);
		await page.screenshot({ path: info.outputPath(`notation-${theme}.png`), fullPage: true });
	});

	test(`home keyboard reaches the next action without a duplicated library (${theme})`, async ({ page, app }, info) => {
		await page.emulateMedia({ colorScheme: theme });
		const directory = join(app.manifest.directory, 'src/routes/__home-focus');
		await mkdir(directory, { recursive: true });
		const home = {
			modules: [
				{
					id: app.ids.module,
					title: 'Atelier fictif de conception et de préparation des interfaces',
					description: '',
					revision: 1,
					resourceCount: 0,
					classes: [{ id: app.ids.currentClass, name: 'B2 Démonstration', academicYear: '2026-2027' }]
				}
			],
			calendar: { month: '2099-01', lessonDates: ['2099-01-15'] },
			nextLesson: {
				moduleId: app.ids.module,
				classId: app.ids.currentClass,
				contextId: app.ids.currentContext,
				moduleTitle: 'Atelier fictif de conception et de préparation des interfaces',
				className: 'B2 Démonstration',
				academicYear: '2026-2027',
				title: 'Préparer la prochaine séance',
				startsAt: '2099-01-15T08:00:00.000Z',
				endsAt: '2099-01-15T10:00:00.000Z'
			}
		};
		await writeFile(
			join(directory, '+page.svelte'),
			`<script lang="ts">
import { page } from '$app/state';
import TeacherHome from '#lib/components/teacher/TeacherHome.svelte';
const fixture = ${JSON.stringify(home)};
const data = $derived({ ...fixture, nextLesson: page.url.searchParams.has('empty') ? null : fixture.nextLesson });
</script>
<TeacherHome userName="Enseignant fictif" {data} />`
		);
		await activate(page, app);
		await chooseTheme(page, theme);
		for (const empty of [false, true]) {
			await page.goto(`${app.origin}/__home-focus${empty ? '?empty' : ''}`);
			const create = page.getByRole('link', { name: 'Créer un module', exact: true });
			const next = page.getByRole('region', { name: 'Prochaine séance', exact: true });
			await expect(next).toBeVisible();
			await expect(page.getByLabel('Rechercher un module', { exact: true })).toHaveCount(0);
			await expectNoOverflow(page);
			await create.focus();
			await page.keyboard.press('Tab');
			await expect(next.getByRole('link').first()).toBeFocused();
			expect(
				await page
					.locator('[tabindex]')
					.evaluateAll((elements) => elements.some((element) => Number(element.getAttribute('tabindex')) > 0))
			).toBe(false);
			if (!empty) {
				await next.getByRole('link').first().blur();
				await page.evaluate(() => window.scrollTo(0, 0));
				await page.screenshot({ path: info.outputPath(`home-${theme}.png`), fullPage: true });
			}
		}
	});
}
