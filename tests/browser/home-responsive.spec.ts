import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import type { HomeData, ModuleDetail, ModuleSummary } from '../../src/lib/teaching/types.js';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';
import { readFormActionReceipt } from './support/form-actions.js';
import type { BrowserFixture } from './support/process.js';

const calendar = { month: '2026-10', lessonDates: ['2026-10-05', '2026-10-26'] };
const module: ModuleSummary = {
	id: 'home-demo-one',
	title: 'Design d’interface',
	description: '',
	revision: 1,
	resourceCount: 0,
	classes: [{ id: 'home-class-one', name: 'B2 Demo', academicYear: '2026-2027' }]
};
const longModule: ModuleSummary = {
	...module,
	id: 'home-demo-long',
	title: 'Atelier — ' + 'InterfacesSansCoupure'.repeat(12) + ' 日本語 👩🏽‍🏫',
	resourceCount: 125,
	classes: [
		{ id: 'home-class-long', name: 'ClasseSansCoupure'.repeat(8), academicYear: '2026-2027' },
		{ id: 'home-class-old', name: 'B1 历史', academicYear: '2025-2026' }
	]
};
const many = [
	module,
	longModule,
	...Array.from({ length: 6 }, (_, index) => ({
		...module,
		id: `home-demo-extra-${index}`,
		title: `Module fictif ${index + 3}`,
		classes: []
	}))
];
const states: Record<string, HomeData> = {
	zero: { modules: [], calendar, nextLesson: null },
	one: { modules: [module], calendar, nextLesson: null },
	many: { modules: many, calendar, nextLesson: null },
	lesson: {
		modules: many,
		calendar,
		nextLesson: {
			moduleId: longModule.id,
			contextId: 'home-context-long',
			classId: 'home-class-long',
			moduleTitle: longModule.title,
			className: longModule.classes[0].name,
			academicYear: '2026-2027',
			title: 'Séance de préparation 日本語',
			startsAt: '2099-01-15T08:00:00.000Z',
			endsAt: '2099-01-15T10:00:00.000Z'
		}
	}
};

async function renderRoute(app: BrowserFixture, info: TestInfo) {
	const relative = 'src/routes/__home-responsive/+page.svelte';
	const route = join(app.manifest.directory, relative);
	const source = `<script lang="ts">
import { page } from '$app/state';
import TeacherHome from '#lib/components/teacher/TeacherHome.svelte';
import type { HomeData } from '#lib/teaching/types.js';
const states: Record<string, HomeData> = ${JSON.stringify(states)};
const data = $derived(states[page.url.searchParams.get('state') ?? 'one'] ?? states.one);
</script>
<TeacherHome userName="Enseignant fictif" {data} />`;
	await mkdir(join(app.manifest.directory, 'src/routes/__home-responsive'), { recursive: true });
	await writeFile(route, source);
	await mkdir(join(app.manifest.directory, 'src/routes/__module-library'), { recursive: true });
	await writeFile(
		join(app.manifest.directory, 'src/routes/__module-library/+page.svelte'),
		`<script lang="ts">
import { page } from '$app/state';
import ModuleLibrary from '#lib/components/teacher/ModuleLibrary.svelte';
import TeacherWorkspace from '#lib/components/teaching/TeacherWorkspace.svelte';
import type { HomeData } from '#lib/teaching/types.js';
const states: Record<string, HomeData> = ${JSON.stringify(states)};
const data = $derived(states[page.url.searchParams.get('state') ?? 'one'] ?? states.one);
</script><TeacherWorkspace userName="Enseignant fictif" active="modules" title="Modules"><ModuleLibrary modules={data.modules} /></TeacherWorkspace>`
	);
	await writeFile(
		info.outputPath('fixture-route.json'),
		JSON.stringify(
			{
				path: relative,
				sha256: createHash('sha256').update(source).digest('hex'),
				addedAfterInitialManifest: true,
				cleanup: 'Owned app.stop removes the entire disposable fixture.'
			},
			null,
			2
		)
	);
}

const intervention = (page: Page) => page.getByRole('region', { name: 'Prochaine séance' });
const month = (page: Page) => page.locator('.mobile-calendar:visible');

async function visibleKeyboardFocus(control: Locator) {
	await expect(control).toBeFocused();
	const focus = await control.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			visible: element.matches(':focus-visible'),
			outline: style.outlineStyle,
			width: parseFloat(style.outlineWidth)
		};
	});
	expect(focus.visible).toBe(true);
	expect(focus.outline).not.toBe('none');
	expect(focus.width).toBeGreaterThanOrEqual(2);
}

async function capture(page: Page, info: TestInfo, name: string) {
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.screenshot({ path: info.outputPath(`${name}-viewport.png`), animations: 'disabled' });
	await page.screenshot({
		path: info.outputPath(`${name}-page.png`),
		fullPage: true,
		animations: 'disabled'
	});
}

async function geometry(page: Page) {
	return page.evaluate(() => {
		const box = (element: Element | null) => {
			if (!element) throw new Error('Home geometry target missing.');
			const { x, y, width, height, bottom } = element.getBoundingClientRect();
			return { x, y, width, height, bottom };
		};
		const section = document.querySelector('[aria-label="Prochaine séance"]');
		const controls = [
			...document.querySelectorAll('#workspace-content a, #workspace-content input, #workspace-content summary')
		]
			.filter((element) => element.getClientRects().length > 0)
			.map((element) => ({
				text: element.textContent?.trim() || element.getAttribute('placeholder'),
				...box(element),
				clipping: element.scrollWidth - element.clientWidth
			}));
		return {
			height: innerHeight,
			overflow: document.documentElement.scrollWidth - innerWidth,
			intervention: box(section),
			controls,
			order: [
				...document.querySelectorAll('#workspace-content h1, #workspace-content h2, #workspace-content summary')
			].map((element) => element.textContent?.trim())
		};
	});
}

// The route is a rendering fixture in the disposable copy, never a production seam or database purge.
test('home keeps zero, one, many and scheduled states readable across widths and themes', async ({
	page,
	app
}, info) => {
	await activate(page, app);
	await renderRoute(app, info);
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const measurements = [];
	const widths = info.project.name === 'mobile' ? [390, 320] : [1440, 1024];
	for (const width of widths) {
		await page.setViewportSize({ width, height: width >= 1024 ? 900 : 844 });
		for (const theme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
			for (const state of ['zero', 'one', 'many', 'lesson'] as const) {
				await page.goto(`${app.origin}/__home-responsive?state=${state}`);
				await expect(page.getByRole('heading', { name: 'Mon atelier', exact: true })).toBeVisible();
				await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
				await page.evaluate(() => document.fonts.ready);
				const name = `${state}-${width}-${theme}`;
				await capture(page, info, `${name}-closed`);
				const closed = await geometry(page);
				measurements.push({ state, width, theme, open: false, ...closed });
				expect(closed.overflow, name).toBeLessThanOrEqual(1);
				for (const control of closed.controls) {
					expect(control.x, `${name}: ${control.text}`).toBeGreaterThanOrEqual(0);
					expect(control.x + control.width, `${name}: ${control.text}`).toBeLessThanOrEqual(width + 1);
					expect(control.clipping, `${name}: ${control.text}`).toBeLessThanOrEqual(1);
				}
				if (state !== 'lesson') {
					await expect(
						intervention(page).getByRole('heading', {
							name: state === 'zero' ? 'Votre premier module' : 'Aucune séance à venir'
						})
					).toBeVisible();
					await expect(page.getByLabel('Rechercher un module', { exact: true })).toHaveCount(0);
				} else {
					await expect(intervention(page).getByRole('heading', { name: longModule.title, exact: true })).toBeVisible();
					await expect(intervention(page).locator('time')).toHaveAttribute(
						'datetime',
						states.lesson.nextLesson!.startsAt
					);
				}
				const calendarDisclosure = month(page);
				if (await calendarDisclosure.isVisible()) {
					await expect(calendarDisclosure).not.toHaveAttribute('open', '');
					await expect(page.locator('.lesson-calendar:visible')).toHaveCount(0);
					const summary = calendarDisclosure.locator('summary');
					expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
					if (info.project.name === 'mobile') await summary.tap();
					else {
						await summary.focus();
						await page.keyboard.press('Enter');
						await visibleKeyboardFocus(summary);
					}
					await expect(calendarDisclosure).toHaveAttribute('open', '');
				} else {
					await expect(page.getByRole('complementary', { name: 'Calendrier des séances' })).toBeVisible();
				}
				const visibleCalendar = page.locator('.lesson-calendar:visible');
				await expect(visibleCalendar).toHaveCount(1);
				await expect(visibleCalendar.getByRole('button', { name: 'Mois précédent', exact: true })).toBeVisible();
				await expect(visibleCalendar.getByRole('button', { name: 'Mois suivant', exact: true })).toBeVisible();
				await expect(visibleCalendar.getByText('lundi 26 octobre 2026, séance planifiée', { exact: true })).toHaveCount(
					1
				);
				await expect(visibleCalendar.getByText('Jour avec une séance', { exact: true })).toBeVisible();
				await capture(page, info, `${name}-open`);
				const opened = await geometry(page);
				measurements.push({ state, width, theme, open: true, ...opened });
				expect(opened.overflow, name).toBeLessThanOrEqual(1);
			}
		}
	}
	await writeFile(info.outputPath('home-geometry.json'), JSON.stringify(measurements, null, 2));
	expect(errors).toEqual([]);
});

test('home calendar, search and destinations retain keyboard and touch access', async ({ page, app }, info) => {
	await activate(page, app);
	await renderRoute(app, info);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto(`${app.origin}/__home-responsive?state=one`);
	await page.waitForLoadState('networkidle');
	if (info.project.name === 'desktop') {
		await expect(page.getByRole('complementary', { name: 'Calendrier des séances' })).toBeVisible();
		await page.setViewportSize({ width: 390, height: 844 });
	}
	const summary = month(page).locator('summary');
	await page.keyboard.press('Tab');
	await summary.focus();
	for (const key of ['Enter', 'Space']) {
		await page.keyboard.press(key);
		await expect(month(page)).toHaveAttribute('open', '');
		await visibleKeyboardFocus(summary);
		await page.keyboard.press(key);
		await expect(month(page)).not.toHaveAttribute('open', '');
		await visibleKeyboardFocus(summary);
		await expect(page.locator('.lesson-calendar:visible')).toHaveCount(0);
	}
	if (info.project.name === 'mobile') {
		await summary.tap();
		await expect(month(page)).toHaveAttribute('open', '');
		await summary.tap();
		await expect(month(page)).not.toHaveAttribute('open', '');
	}
	await page.goto(`${app.origin}/__module-library?state=one`);
	const search = page.getByRole('searchbox', { name: 'Rechercher un module', exact: true });
	await search.fill('Introuvable');
	await expect(page.getByRole('status')).toHaveText('0 module affiché');
	await expect(page.getByText('Aucun module trouvé', { exact: true })).toBeVisible();
	await expect(page.getByText('Aucun module créé', { exact: true })).toHaveCount(0);
	const reset = page.getByRole('button', { name: 'Réinitialiser la recherche', exact: true });
	await reset.focus();
	await page.keyboard.press('Enter');
	await expect(search).toHaveValue('');
	await expect(page.getByRole('status')).toHaveText('1 module affiché');
	await search.fill('  DESIGN  ');
	await expect(page.getByRole('status')).toHaveText('1 module affiché');
	await expect(page.getByRole('heading', { name: module.title, exact: true })).toBeVisible();
	const preparation = page.getByRole('navigation', { name: `Travailler sur ${module.title}` }).getByRole('link', {
		name: 'Préparer',
		exact: true
	});
	await expect(preparation).toHaveAttribute('href', `/enseignant/modules/${module.id}?section=preparation`);
	await page.goto(`${app.origin}/__home-responsive?state=zero`);
	await expect(intervention(page).getByRole('link', { name: 'Choisir un module', exact: true })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Créer un module', exact: true })).toHaveAttribute(
		'href',
		'/enseignant/modules/nouveau'
	);
	await page.goto(`${app.origin}/__module-library?state=zero`);
	await expect(page.getByRole('link', { name: 'Créer un module', exact: true })).toHaveCount(1);
	await page.getByRole('link', { name: 'Créer un module', exact: true }).click();
	await expect(page).toHaveURL(app.origin + '/enseignant/modules/nouveau');
	await readyModuleEditor(page);
});

test('real home keeps the saved future lesson and exact class/context destinations', async ({ page, app }, info) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.publicationModule}`);
	await readyModuleEditor(page);
	const selector = page.getByLabel('Section du module', { exact: true });
	if (await selector.isVisible()) await selector.selectOption('planning');
	else await page.getByRole('tab', { name: 'Classe et planning', exact: false }).click();
	await page.getByRole('button', { name: 'Ajouter une séance', exact: true }).click();
	await page.getByLabel('Intitulé de la séance', { exact: true }).last().fill('Séance future fictive 016');
	await page.getByLabel('Début', { exact: true }).last().fill('2099-01-15T09:00');
	await page.getByLabel('Fin', { exact: true }).last().fill('2099-01-15T11:00');
	const savedResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith(`/enseignant/modules/${app.ids.publicationModule}?/saveModule`) &&
			response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first().click();
	const response = await savedResponse;
	expect(response.status()).toBe(200);
	const saved = await readFormActionReceipt<ModuleDetail>(response);
	const context = saved.contexts.find((value) =>
		value.lessons.some((lesson) => lesson.title === 'Séance future fictive 016')
	);
	expect(context).toBeDefined();
	await page.goto(app.origin + '/');
	const next = intervention(page);
	await expect(next.getByRole('heading', { name: saved.title, exact: true })).toBeVisible();
	await expect(next.getByText('Séance future fictive 016', { exact: true })).toBeVisible();
	await expect(next.getByText('B2 Demo · 2026–2027', { exact: true })).toBeVisible();
	await expect(next.locator('time')).toHaveAttribute('datetime', '2099-01-15T08:00:00.000Z');
	await expect(next.locator('time')).toContainText('09:00');
	const scope = new URLSearchParams({ classe: context!.classId, contexte: context!.id }).toString();
	const preparation = next.getByRole('link', { name: 'Ouvrir la préparation', exact: true });
	await expect(preparation).toHaveAttribute('href', `/enseignant/modules/${saved.id}?section=preparation&${scope}`);
	await expect(next.getByRole('link', { name: 'Voir le planning', exact: true })).toHaveAttribute(
		'href',
		`/enseignant/modules/${saved.id}?section=planning&${scope}`
	);
	await expect(page.getByRole('navigation', { name: 'Continuer le travail' })).toHaveCount(0);
	await capture(page, info, 'real-saved-lesson');
	await preparation.click();
	await expect(page).toHaveURL(`${app.origin}/enseignant/modules/${saved.id}?section=preparation&${scope}`);
});
