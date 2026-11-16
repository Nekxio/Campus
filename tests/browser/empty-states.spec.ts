import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import type { BrowserFixture } from './support/process.js';

const fixtureSource = `<script lang="ts">
import { onMount } from 'svelte';
import { page } from '$app/state';
import TeacherHome from '#lib/components/teacher/TeacherHome.svelte';
import TeacherWorkspace from '#lib/components/teaching/TeacherWorkspace.svelte';
import ModuleLibrary from '#lib/components/teacher/ModuleLibrary.svelte';
import ClassesWorkspace from '#lib/components/teaching/ClassesWorkspace.svelte';
import GradeGrid from '#lib/components/grading/GradeGrid.svelte';
import AnnualWorkspace from '#lib/components/annual/AnnualWorkspace.svelte';
import QuizDraftWorkspace from '#lib/components/quizzes/QuizDraftWorkspace.svelte';
import RubricEditor from '#lib/components/grading/RubricEditor.svelte';
import ModuleDraftEditor from '#lib/components/teaching/ModuleDraftEditor.svelte';
import PublicationReview from '#lib/components/publication/PublicationReview.svelte';
import ProposalReview from '#lib/components/grading/ProposalReview.svelte';
import PublishedPages from '../enseignant/vue-etudiante/+page.svelte';
import { emptyModule, type ClassDetail, type ModuleDetail } from '#lib/teaching/types.js';
import type { RubricData } from '#lib/domain/grading.js';
import type { GradeWorkspaceData } from '#lib/domain/grading-selection.js';
const state = $derived(page.url.searchParams.get('state') ?? 'classes');
let ready = $state(false);
onMount(() => { ready = true; });
const emptyClass: ClassDetail = {
 id: '00000000-0000-4000-8000-000000000301', name: 'Classe fictive', academicYear: '2026-2027',
 revision: 1, studentCount: 0, moduleCount: 0, students: [], modules: []
};
const module: ModuleDetail = {
 ...emptyModule(), id: '00000000-0000-4000-8000-000000000302', revision: 1,
 title: 'Module fictif sans contenu'
};
const rubric: RubricData = { module: { id: module.id, title: module.title, revision: 1 }, assessments: [], results: [], contexts: [] };
const grading: GradeWorkspaceData = {
 academicYears: [], academicYear: null, classes: [], classId: null,
 modules: [], contexts: [], rubric: null, contextId: null, students: []
};
const active = $derived(state === 'classes' || state === 'class-roster' || state === 'annual' ? 'classes' : state === 'grading' || state === 'proposals' ? 'grading' : state === 'published' ? 'student-view' : 'modules');
const title = $derived(state === 'annual' ? 'Fin d’année' : state === 'proposals' ? 'Propositions' : active === 'classes' ? 'Classes' : active === 'grading' ? 'Notation' : active === 'student-view' ? 'Pages publiées' : 'Modules');
</script>
<span data-empty-fixture-ready={ready} hidden></span>
{#if state === 'home'}
 <TeacherHome userName="Enseignant fictif" data={{ modules: [], calendar: { month: '2026-11', lessonDates: [] }, nextLesson: null }} />
{:else}
 <TeacherWorkspace userName="Enseignant fictif" {active} {title} boundedCorrection={state === 'proposals'} parentLink={state === 'annual' ? { href: '/enseignant/classes', label: 'Mes classes' } : undefined}>
  {#if state === 'modules'}<ModuleLibrary modules={[]} />
  {:else if state === 'classes'}<ClassesWorkspace data={{ classes: [], selected: null, modules: [] }} />
  {:else if state === 'class-roster'}<ClassesWorkspace data={{ classes: [emptyClass], selected: emptyClass, modules: [] }} />
  {:else if state === 'grading'}<GradeGrid data={grading} />
  {:else if state === 'annual'}<AnnualWorkspace data={{ years: [], selected: null }} />
  {:else if state === 'published'}<PublishedPages data={{ publishedClasses: [] }} />
  {:else if state === 'publication'}<PublicationReview data={{ module: { id: module.id, title: module.title }, contexts: [], selected: null }} />
  {:else if state === 'proposals'}<ProposalReview data={{ queue: [], selected: null }} />
  {:else if state === 'quiz'}<QuizDraftWorkspace data={{ academicYear: '2026-2027', module, rubric, quizzes: [], runs: [], selectedContextId: '' }} />
  {:else if state === 'rubric'}<RubricEditor data={rubric} />
  {:else}<ModuleDraftEditor data={{ classes: [], module }} />{/if}
 </TeacherWorkspace>
{/if}`;

const surfaces = [
	{ state: 'home', heading: 'Mon atelier', empty: 'Votre premier module', action: 'Créer un module' },
	{ state: 'modules', heading: 'Mes modules', empty: 'Aucun module créé', action: 'Créer un module' },
	{ state: 'classes', heading: 'Mes classes', empty: 'Votre première classe', action: 'Créer une classe' },
	{ state: 'class-roster', heading: 'Mes classes', empty: 'Aucun module associé', action: 'Ajouter un étudiant' },
	{ state: 'grading', heading: 'Notation', empty: 'Aucune classe disponible', action: 'Voir les classes' },
	{
		state: 'annual',
		heading: 'Fin d’année et historique',
		empty: 'Aucune année disponible',
		action: 'Voir les classes'
	},
	{
		state: 'published',
		heading: 'Pages publiées',
		empty: 'Aucune page publiée',
		action: 'Choisir un module à publier'
	},
	{
		state: 'publication',
		heading: 'Publication du module',
		empty: 'Aucune classe pour cette publication',
		action: 'Associer une classe'
	},
	{
		state: 'proposals',
		heading: 'Propositions de correction',
		empty: 'Aucune proposition à examiner',
		action: 'Corriger depuis la notation'
	},
	{ state: 'quiz', heading: 'Quiz', empty: 'Associez une classe et une séance', action: 'Préparer le planning' },
	{
		state: 'rubric',
		heading: 'Barème et calculs',
		empty: 'Définissez votre première section',
		action: 'Ajouter une section'
	},
	{
		state: 'planning',
		heading: 'Module fictif sans contenu',
		empty: 'Aucune classe associée',
		action: 'l’espace Classes',
		section: 'planning'
	},
	{
		state: 'resources',
		heading: 'Module fictif sans contenu',
		empty: 'Aucun support lié',
		action: 'Ajouter un support',
		section: 'resources'
	}
] as const;
type Surface = (typeof surfaces)[number];

const renderRoute = async (app: BrowserFixture, info: TestInfo) => {
	const relative = 'src/routes/__empty-states/+page.svelte';
	await mkdir(join(app.manifest.directory, 'src/routes/__empty-states'), { recursive: true });
	await writeFile(join(app.manifest.directory, relative), fixtureSource);
	await writeFile(
		info.outputPath('fixture-route.json'),
		JSON.stringify(
			{
				path: relative,
				sha256: createHash('sha256').update(fixtureSource).digest('hex'),
				addedAfterInitialManifest: true,
				cleanup: 'Owned app.stop removes this disposable source copy; no teaching data is deleted.'
			},
			null,
			2
		)
	);
};

const openSurface = async (page: Page, app: BrowserFixture, surface: Surface) => {
	const query = new URLSearchParams({ state: surface.state });
	if ('section' in surface) query.set('section', surface.section);
	await page.goto(`${app.origin}/__empty-states?${query}`);
	await expect(page.locator('[data-empty-fixture-ready="true"]')).toHaveCount(1);
	await expect(page.getByRole('heading', { name: surface.heading, exact: true }).first()).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
};

const actionFor = (page: Page, surface: Surface) =>
	page
		.locator('#workspace-content')
		.getByRole('link', { name: surface.action, exact: true })
		.or(page.locator('#workspace-content').getByRole('button', { name: surface.action, exact: true }))
		.first();

const verifyFocus = async (page: Page, action: Locator, label: string) => {
	await page.keyboard.press('Tab');
	await action.focus();
	await expect(action).toBeFocused();
	const focus = await action.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			visible: element.matches(':focus-visible'),
			outline: style.outlineStyle,
			width: parseFloat(style.outlineWidth)
		};
	});
	expect.soft(focus.visible, `${label}: keyboard focus`).toBe(true);
	expect.soft(focus.outline, `${label}: focus outline`).not.toBe('none');
	expect.soft(focus.width, `${label}: focus width`).toBeGreaterThanOrEqual(2);
};

const geometry = async (page: Page) =>
	page.evaluate(() => ({
		viewport: innerWidth,
		overflow: document.documentElement.scrollWidth - innerWidth,
		controls: [
			...document.querySelectorAll<HTMLElement>(
				':is(#workspace-content, [role="dialog"]) :is(a, button, input, select, summary)'
			)
		]
			.filter((element) => element.getClientRects().length > 0)
			.map((element) => {
				const box = element.getBoundingClientRect();
				return {
					text: element.getAttribute('aria-label') || element.textContent?.trim(),
					x: box.x,
					right: box.right,
					width: box.width,
					height: box.height,
					clipping: element.scrollWidth - element.clientWidth
				};
			})
	}));

const verifyGeometry = async (page: Page, label: string) => {
	const result = await geometry(page);
	expect.soft(result.overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(1);
	for (const control of result.controls) {
		expect.soft(control.x, `${label}: ${control.text} leading edge`).toBeGreaterThanOrEqual(-1);
		expect.soft(control.right, `${label}: ${control.text} trailing edge`).toBeLessThanOrEqual(result.viewport + 1);
		expect.soft(control.clipping, `${label}: ${control.text} clipped content`).toBeLessThanOrEqual(1);
	}
	return result;
};

const verifyReadingEdge = async (page: Page, label: string, alignWithHeading = false) => {
	const groups = await page.locator('#workspace-content [data-slot="empty"]').evaluateAll((elements) =>
		elements
			.filter((element) => element.getClientRects().length > 0)
			.map((element) => {
				const style = getComputedStyle(element);
				const rtl = style.direction === 'rtl';
				const box = element.getBoundingClientRect();
				const edge = rtl
					? box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth)
					: box.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
				const targets = [
					...element.querySelectorAll(
						':scope > [data-slot="empty-header"] > [data-slot="empty-title"], :scope > [data-slot="empty-header"] > [data-slot="empty-description"], :scope > [data-slot="empty-content"] > [data-slot="button"]'
					)
				];
				return {
					direction: style.direction,
					outerEdge: rtl ? box.right : box.left,
					edge,
					items: targets.map((target) => {
						const bounds = target.getBoundingClientRect();
						return { text: target.textContent?.trim(), edge: rtl ? bounds.right : bounds.left };
					})
				};
			})
	);
	for (const group of groups) {
		for (const item of group.items) {
			expect
				.soft(Math.abs(item.edge - group.edge), `${label}: ${item.text} follows the reading edge`)
				.toBeLessThanOrEqual(1);
		}
	}
	if (alignWithHeading) {
		const heading = await page.getByRole('heading', { name: 'Mes classes', exact: true }).boundingBox();
		const edge = groups[0].direction === 'rtl' ? heading!.x + heading!.width : heading!.x;
		expect
			.soft(Math.abs(groups[0].outerEdge - edge), `${label}: first-class surface follows the page heading`)
			.toBeLessThanOrEqual(1);
	}
	return groups;
};

const verifySpacing = async (page: Page, state: Surface['state'], label: string) => {
	const values = await page.evaluate((state) => {
		const heading = document.querySelector('#workspace-content h1');
		const headerSelectors: Partial<Record<typeof state, string>> = {
			home: '.home-heading',
			modules: '.library-heading',
			classes: '.classes-heading',
			grading: '.grading-heading',
			annual: '.annual-workspace > div:first-child',
			published: '.published-heading'
		};
		const contentSelectors: Partial<Record<typeof state, string>> = {
			home: '.home-stage',
			modules: '.module-library > [data-slot="empty"]',
			classes: '.class-directory-layout',
			grading: '.grading-workbench',
			annual: '.annual-workspace > [data-slot="empty"]',
			published: '.published-workspace > [data-slot="empty"]',
			proposals: '#workspace-content [data-slot="empty"]'
		};
		const header = headerSelectors[state]
			? document.querySelector(headerSelectors[state]!)
			: state === 'proposals'
				? heading?.parentElement?.parentElement
				: null;
		const content = contentSelectors[state] ? document.querySelector(contentSelectors[state]!) : null;
		const description = header?.querySelector('p');
		const visibleEmpties = [...document.querySelectorAll<HTMLElement>('#workspace-content [data-slot="empty"]')].filter(
			(element) => element.getClientRects().length > 0
		);
		const resourceEmpty = state === 'resources' ? visibleEmpties[0] : null;
		const resourceAction = resourceEmpty?.parentElement?.querySelector('button');
		const empties = visibleEmpties.map((element) => {
			const title = element.querySelector('[data-slot="empty-title"]');
			const description = element.querySelector('[data-slot="empty-description"]');
			const header = element.querySelector('[data-slot="empty-header"]');
			const content = element.querySelector('[data-slot="empty-content"]');
			const media = element.querySelector('[data-slot="empty-icon"]')?.getBoundingClientRect();
			const style = getComputedStyle(element);
			return {
				title: title?.textContent,
				filled: !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor),
				media: media ? { width: media.width, height: media.height } : null,
				nested: Boolean(element.parentElement?.closest('[data-slot="work-surface"]')),
				titleDescriptionGap:
					title && description ? description.getBoundingClientRect().top - title.getBoundingClientRect().bottom : null,
				actionGap:
					header && content ? content.getBoundingClientRect().top - header.getBoundingClientRect().bottom : null,
				padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(parseFloat)
			};
		});
		return {
			width: innerWidth,
			resourceActionGap:
				resourceEmpty && resourceAction
					? resourceAction.getBoundingClientRect().top - resourceEmpty.getBoundingClientRect().bottom
					: null,
			sectionGap:
				header && content ? content.getBoundingClientRect().top - header.getBoundingClientRect().bottom : null,
			headingDescriptionGap:
				heading && description
					? description.getBoundingClientRect().top - heading.getBoundingClientRect().bottom
					: null,
			empties
		};
	}, state);
	if (['modules', 'classes', 'grading', 'annual', 'published', 'publication', 'proposals', 'quiz'].includes(state)) {
		expect.soft(values.empties, `${label}: one empty workspace panel`).toHaveLength(1);
		expect.soft(values.empties[0]?.filled, `${label}: empty workspace retains its background`).toBe(true);
		expect.soft(values.empties[0]?.media, `${label}: empty workspace shares the icon treatment`).toEqual({
			width: 40,
			height: 40
		});
	}
	if (state === 'resources')
		expect.soft(values.resourceActionGap, `${label}: resource action follows its explanation`).toBeCloseTo(16, 0);
	if (values.sectionGap !== null)
		expect
			.soft(values.sectionGap, `${label}: page sections share the responsive spacing`)
			.toBeCloseTo(values.width >= 640 ? 40 : 32, 0);
	if (values.headingDescriptionGap !== null)
		expect.soft(values.headingDescriptionGap, `${label}: title and explanation stay grouped`).toBeCloseTo(8, 0);
	for (const empty of values.empties) {
		if (empty.titleDescriptionGap !== null)
			expect.soft(empty.titleDescriptionGap, `${label}: ${empty.title} title-description gap`).toBeCloseTo(8, 0);
		if (empty.actionGap !== null)
			expect.soft(empty.actionGap, `${label}: ${empty.title} action follows the explanation`).toBeCloseTo(16, 0);
		if (empty.filled)
			for (const padding of empty.padding)
				expect
					.soft(padding, `${label}: ${empty.title} uses the shared surface inset`)
					.toBe(empty.nested ? 16 : values.width >= 768 ? 32 : 20);
	}
	return values;
};

const verifyContrast = async (page: Page, label: string) => {
	const values = await page
		.locator(
			'[data-slot="empty-title"], [data-slot="empty-description"], [data-slot="empty"] [data-slot="button"], .next-lesson.empty h2, .next-lesson.empty p'
		)
		.evaluateAll((elements) => {
			const canvas = document.createElement('canvas');
			const context = canvas.getContext('2d')!;
			const luminance = (value: string) => {
				context.clearRect(0, 0, 1, 1);
				context.fillStyle = value;
				context.fillRect(0, 0, 1, 1);
				return Array.from(context.getImageData(0, 0, 1, 1).data)
					.slice(0, 3)
					.map((channel) => {
						const unit = channel / 255;
						return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
					})
					.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
			};
			return elements
				.filter((element) => element.getClientRects().length > 0)
				.map((element) => {
					let surface: Element | null = element;
					let backgroundColor = getComputedStyle(document.body).backgroundColor;
					while (surface) {
						const value = getComputedStyle(surface).backgroundColor;
						context.clearRect(0, 0, 1, 1);
						context.fillStyle = value;
						context.fillRect(0, 0, 1, 1);
						if (context.getImageData(0, 0, 1, 1).data[3] === 255) {
							backgroundColor = value;
							break;
						}
						surface = surface.parentElement;
					}
					const style = getComputedStyle(element);
					const background = luminance(backgroundColor);
					const foreground = luminance(style.color);
					return {
						text: element.textContent?.trim(),
						ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
						minimum:
							parseFloat(style.fontSize) >= 24 ||
							(parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight) >= 700)
								? 3
								: 4.5
					};
				});
		});
	for (const value of values)
		expect.soft(value.ratio, `${label}: contrast of ${value.text}`).toBeGreaterThanOrEqual(value.minimum);
	return values;
};

// Rendering-only route in the owned fixture copy; production auth, source routes and data remain untouched.
test('empty teaching states retain useful actions, readable widths and keyboard access', async ({
	page,
	app
}, info) => {
	test.setTimeout(600000);
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
			for (const surface of surfaces) {
				await openSurface(page, app, surface);
				const name = `${surface.state}-${width}-${theme}`;
				await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
				await expect.soft(page.getByText(surface.empty, { exact: true }), name).toBeVisible();
				const action = actionFor(page, surface);
				await expect.soft(action, `${name}: useful action`).toBeVisible();
				if (await action.isVisible()) await verifyFocus(page, action, name);
				if (['home', 'modules', 'classes', 'published', 'rubric'].includes(surface.state))
					await expect
						.soft(
							page.locator(
								'#workspace-content [data-slot="button"].bg-primary:not(:disabled):not([aria-disabled="true"])'
							),
							`${name}: one available primary action`
						)
						.toHaveCount(1);
				if (surface.state === 'home')
					await expect.soft(page.getByRole('link', { name: 'Choisir un module', exact: true })).toHaveCount(0);
				if (surface.state === 'grading')
					await expect.soft(page.locator('#grading-context, #grading-module')).toHaveCount(0);
				if (surface.state === 'annual') {
					await expect.soft(page.locator('#annual-year')).toHaveCount(0);
					const header = page.locator('.teacher-header');
					const titleLines = await header.getByText('Fin d’année', { exact: true }).evaluate((element) => {
						return element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight);
					});
					expect.soft(titleLines, `${name}: header title remains readable`).toBeLessThanOrEqual(2);
					const back = header.getByRole('link', { name: 'Mes classes', exact: true });
					await expect.soft(back, `${name}: named parent navigation stays available`).toBeVisible();
					const bounds = await back.boundingBox();
					expect.soft(bounds?.width, `${name}: parent navigation touch width`).toBeGreaterThanOrEqual(44);
					expect.soft(bounds?.height, `${name}: parent navigation touch height`).toBeGreaterThanOrEqual(44);
				}
				if (surface.state === 'planning') await expect.soft(action).toHaveAttribute('href', '/enseignant/classes');
				if (surface.state === 'class-roster')
					await expect.soft(page.getByText('Aucun étudiant dans cette classe', { exact: true })).toBeVisible();
				if (surface.state === 'classes' && width >= 1024) {
					const workspace = await page.locator('.classes-workspace').boundingBox();
					const panel = await page.locator('.class-detail [data-slot="empty"]').boundingBox();
					expect.soft(panel!.width / workspace!.width, `${name}: empty panel uses the main width`).toBeGreaterThan(0.9);
				}
				measurements.push({
					name,
					...(await verifyGeometry(page, name)),
					readingEdges: await verifyReadingEdge(page, name, surface.state === 'classes'),
					spacing: await verifySpacing(page, surface.state, name),
					contrasts: await verifyContrast(page, name)
				});
				await page.evaluate(() => window.scrollTo(0, 0));
				await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' });
				await writeFile(info.outputPath('empty-state-geometry.json'), JSON.stringify(measurements, null, 2));
			}
		}
	}
	for (const surface of surfaces.filter((entry) =>
		['classes', 'modules', 'grading', 'annual', 'published'].includes(entry.state)
	)) {
		await page.setViewportSize({ width: info.project.name === 'mobile' ? 320 : 1440, height: 900 });
		await openSurface(page, app, surface);
		await page.evaluate(() => {
			document.documentElement.dir = 'rtl';
		});
		measurements.push({
			name: `${surface.state}-rtl`,
			...(await verifyGeometry(page, `${surface.state}: RTL mirror`)),
			readingEdges: await verifyReadingEdge(page, `${surface.state}: RTL mirror`, surface.state === 'classes')
		});
		await page.screenshot({
			path: info.outputPath(`${surface.state}-rtl.png`),
			fullPage: true,
			animations: 'disabled'
		});
		await page.evaluate(() => {
			document.documentElement.dir = 'ltr';
		});
		// Keep the effective inline size at least 320 CSS pixels; this is CSS zoom emulation, not browser zoom.
		await page.setViewportSize({ width: info.project.name === 'mobile' ? 640 : 1440, height: 900 });
		await page.evaluate(() => {
			document.documentElement.style.zoom = '2';
		});
		measurements.push({
			name: `${surface.state}-css-zoom-200`,
			...(await verifyGeometry(page, `${surface.state}: CSS zoom 200% emulation`))
		});
		await page.screenshot({
			path: info.outputPath(`${surface.state}-css-zoom-200.png`),
			fullPage: true,
			animations: 'disabled'
		});
		await page.evaluate(() => {
			document.documentElement.style.zoom = '';
		});
	}
	await page.setViewportSize({ width: info.project.name === 'mobile' ? 320 : 1440, height: 900 });
	await openSurface(
		page,
		app,
		surfaces.find((entry) => entry.state === 'classes')!
	);
	const createClass = page.getByRole('button', { name: 'Créer une classe', exact: true });
	await verifyFocus(page, createClass, 'Create first class');
	await page.keyboard.press('Enter');
	const dialog = page.getByRole('dialog', { name: 'Nouvelle classe', exact: true });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByLabel('Nom de la classe', { exact: true })).toBeVisible();
	measurements.push({ name: 'create-class-dialog', ...(await verifyGeometry(page, 'Create first class dialog')) });
	await page.screenshot({ path: info.outputPath('create-class-dialog.png'), fullPage: true, animations: 'disabled' });
	await page.keyboard.press('Escape');
	await expect(dialog).not.toBeVisible();
	await expect(createClass).toBeFocused();
	await openSurface(
		page,
		app,
		surfaces.find((entry) => entry.state === 'class-roster')!
	);
	for (const [actionName, dialogName] of [
		['Ajouter un étudiant', 'Ajouter un étudiant'],
		['Importer une liste', 'Importer les étudiants']
	] as const) {
		const action = page.getByRole('button', { name: actionName, exact: true });
		await verifyFocus(page, action, actionName);
		await page.keyboard.press('Enter');
		const rosterDialog = page.getByRole('dialog', { name: dialogName, exact: true });
		await expect(rosterDialog).toBeVisible();
		if (actionName === 'Importer une liste') {
			await expect(rosterDialog.getByRole('button', { name: 'Importer les étudiants', exact: true })).toBeVisible();
		}
		measurements.push({ name: dialogName, ...(await verifyGeometry(page, dialogName)) });
		await page.screenshot({
			path: info.outputPath(
				actionName === 'Ajouter un étudiant' ? 'roster-add-dialog.png' : 'roster-import-dialog.png'
			),
			fullPage: true,
			animations: 'disabled'
		});
		if (actionName === 'Importer une liste') {
			const names = rosterDialog.getByLabel('Liste des étudiants', { exact: true });
			await names.fill('Étudiant fictif');
			await expect(rosterDialog.getByRole('button', { name: 'Ajouter 1 étudiant', exact: true })).toBeVisible();
			await names.fill('');
			await expect(rosterDialog.getByRole('button', { name: 'Importer les étudiants', exact: true })).toBeVisible();
		}
		await page.keyboard.press('Escape');
		await expect(rosterDialog).not.toBeVisible();
		await expect(action).toBeFocused();
	}
	await openSurface(
		page,
		app,
		surfaces.find((entry) => entry.state === 'rubric')!
	);
	const addSection = page.getByRole('button', { name: 'Ajouter une section', exact: true });
	await expect(addSection).toHaveCount(1);
	await addSection.click();
	await expect(page.locator('.section-index')).toBeVisible();
	await writeFile(info.outputPath('empty-state-geometry.json'), JSON.stringify(measurements, null, 2));
	expect(errors, 'No uncaught exceptions in empty teaching states').toEqual([]);
});
