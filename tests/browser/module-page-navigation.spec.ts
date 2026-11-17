import { openModulePages, closeModulePages } from './support/module-navigation.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page, Route } from '@playwright/test';
import { moduleDetailSchema } from '../../src/lib/domain/teaching.js';
import type { QuizWorkspaceData } from '../../src/lib/quizzes/teacher-data.js';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';
import { showGradingContext } from './support/grading.js';

const labels = ['Préparer', 'Quiz', 'Barème', 'Notation', 'Publication'];
const navigation = (page: Page) => page.getByRole('navigation', { name: 'Pages du module', exact: true });
const breadcrumb = (page: Page) => page.getByRole('navigation', { name: 'Fil d’Ariane du module', exact: true });
const chooseSection = async (page: Page, section: string, label: string) => {
	const select = page.getByLabel('Section du module', { exact: true });
	if (await select.isVisible()) await select.selectOption(section);
	else await page.getByRole('tab', { name: label, exact: false }).click();
};
const expectCurrent = async (page: Page, label: string) => {
	const trigger = page.getByRole('button', { name: 'Changer de page du module', exact: true });
	await expect(async () => {
		if (await trigger.isVisible()) await expect(trigger).toContainText(label);
		await openModulePages(page);
		await expect(navigation(page)).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 30000 });
	await expect((await openModulePages(page)).getByRole('link')).toHaveText(labels);
	await expect(navigation(page).locator('[aria-current="page"]')).toHaveCount(1);
	await expect((await openModulePages(page)).getByRole('link', { name: label, exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(breadcrumb(page)).toHaveCount(0);
	await closeModulePages(page);
};
const expectScope = (url: URL, scope: Record<string, string>) => {
	for (const [name, value] of Object.entries(scope)) expect(url.searchParams.get(name)).toBe(value);
};
const expectTouchTarget = async (link: Locator) => {
	const bounds = await link.boundingBox();
	expect(bounds).not.toBeNull();
	expect(bounds!.width).toBeGreaterThanOrEqual(44);
	expect(bounds!.height).toBeGreaterThanOrEqual(44);
};

test('module page links distinguish the parent and retain scope through every child round trip', async ({
	page,
	app
}, info) => {
	test.setTimeout(120000);
	await activate(page, app);
	const scope = {
		classe: app.ids.currentClass,
		contexte: app.ids.publicationContext,
		section: 'planning'
	};
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.publicationModule}?${new URLSearchParams(scope)}`);
	await readyModuleEditor(page);
	await chooseSection(page, 'planning', 'Classe et planning');
	await expectCurrent(page, 'Préparer');
	await expect(page.getByRole('button', { name: 'Actions du module', exact: true })).toHaveCount(0);
	await page.evaluate(() => document.fonts.ready);
	await page.screenshot({
		path: info.outputPath('module-page-module.png'),
		fullPage: true,
		animations: 'disabled'
	});
	const writes: string[] = [];
	page.on('request', (request) => {
		const path = new URL(request.url()).pathname;
		if (!path.startsWith('/api/teaching/') || request.method() === 'GET') return;
		// The existing teacher shell runs automatic calendar synchronization on each mount.
		if (
			path === '/api/teaching/calendar' &&
			request.method() === 'POST' &&
			request.postData() === JSON.stringify({ action: 'sync', manual: false })
		)
			return;
		writes.push(request.method() + ' ' + path);
	});
	for (const [label, name] of [
		['Quiz', 'quiz'],
		['Barème', 'rubric'],
		['Notation', 'grading'],
		['Publication', 'publication']
	]) {
		const destination = (await openModulePages(page)).getByRole('link', {
			name: label,
			exact: true
		});
		await destination.focus();
		await page.keyboard.press('Enter');
		await expectCurrent(page, label);
		await page.reload();
		await expectCurrent(page, label);
		await page.evaluate(() => document.fonts.ready);
		await page.screenshot({
			path: info.outputPath(`module-page-${name}.png`),
			fullPage: true,
			animations: 'disabled'
		});
		const back = (await openModulePages(page)).getByRole('link', { name: 'Préparer', exact: true });
		await expect(back).toBeVisible();
		const target = new URL((await back.getAttribute('href'))!, app.origin);
		expect(target.pathname).toBe(`/enseignant/modules/${app.ids.publicationModule}`);
		expectScope(target, scope);
		await back.click();
		await expectCurrent(page, 'Préparer');
		expectScope(new URL(page.url()), scope);
		await expect(page.getByRole('tabpanel', { name: 'Classe et planning', exact: false })).toBeVisible();
	}
	await page.goto(
		`${app.origin}/enseignant/notation?module=${app.ids.publicationModule}&contexte=${app.ids.publicationContext}&section=unknown`
	);
	await expectCurrent(page, 'Notation');
	expect(new URL(page.url()).searchParams.has('section')).toBe(false);
	expect(writes).toEqual([]);
});

test('quiz outgoing destinations follow current selection in an explicit fictional loading simulation', async ({
	page,
	app
}, info) => {
	await activate(page, app);
	const response = await page.request.get(`${app.origin}/api/teaching/modules/${app.ids.module}`);
	expect(response.status()).toBe(200);
	const module = moduleDetailSchema.parse(await response.json());
	const initialContext = module.contexts.find((entry) => entry.id === app.ids.currentContext);
	expect(initialContext).toBeDefined();
	const selectedContextId = crypto.randomUUID();
	const selectedClassId = crypto.randomUUID();
	const oldContextId = crypto.randomUUID();
	const oldClassId = crypto.randomUUID();
	const selectedYear = '2026-2027';
	// One active class per module is the domain rule; this isolates the component's selection contract.
	const initialLabel = {
		id: app.ids.currentContext,
		expectedRevision: initialContext!.expectedRevision ?? 0,
		deadlines: [],
		classId: app.ids.currentClass,
		className: 'Initial fictional class',
		academicYear: '2026-2027'
	};
	const data: QuizWorkspaceData = {
		academicYear: selectedYear,
		module: {
			...module,
			contexts: [
				initialContext!,
				{ ...initialContext!, id: selectedContextId, classId: selectedClassId },
				{ ...initialContext!, id: oldContextId, classId: oldClassId }
			]
		},
		rubric: {
			module: { id: module.id, title: module.title, revision: module.revision },
			assessments: [],
			results: [],
			contexts: [
				initialLabel,
				{
					...initialLabel,
					id: selectedContextId,
					classId: selectedClassId,
					className: 'Selected fictional class',
					academicYear: selectedYear
				},
				{
					...initialLabel,
					id: oldContextId,
					classId: oldClassId,
					className: 'Historical fictional class',
					academicYear: '2025-2026'
				}
			]
		},
		quizzes: [],
		runs: [],
		selectedContextId: app.ids.currentContext
	};
	const directory = join(app.manifest.directory, 'src/routes/__quiz-navigation');
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(directory, '+page.svelte'),
		`<script lang="ts">
import QuizDraftWorkspace from '#lib/components/quizzes/QuizDraftWorkspace.svelte';
import type { QuizWorkspaceData } from '#lib/quizzes/teacher-data.js';
const data: QuizWorkspaceData = ${JSON.stringify(data)};
</script>
<QuizDraftWorkspace {data} />`
	);
	info.annotations.push({
		type: 'ui-loading-simulation',
		description: 'Two current choices and one excluded historical context; no additional active database context.'
	});
	await page.goto(`${app.origin}/__quiz-navigation?section=planning`);
	await expectCurrent(page, 'Quiz');
	await expect(page.getByRole('option')).toHaveCount(2);
	await expect(page.getByRole('option', { name: 'Historical fictional class', exact: true })).toHaveCount(0);
	await expect(async () => {
		await page.getByLabel('Classe', { exact: true }).selectOption(selectedContextId);
		await expect((await openModulePages(page)).getByRole('link', { name: 'Préparer', exact: true })).toHaveAttribute(
			'href',
			new RegExp(`contexte=${selectedContextId}`),
			{ timeout: 1000 }
		);
	}).toPass({ timeout: 60000 });
	for (const label of labels) {
		const target = new URL(
			(await (await openModulePages(page)).getByRole('link', { name: label, exact: true }).getAttribute('href'))!,
			app.origin
		);
		expectScope(target, {
			classe: selectedClassId,
			contexte: selectedContextId,
			annee: selectedYear,
			section: 'planning'
		});
	}
	const parent = new URL(
		(await (await openModulePages(page)).getByRole('link', { name: 'Préparer', exact: true }).getAttribute('href'))!,
		app.origin
	);
	expectScope(parent, {
		classe: selectedClassId,
		contexte: selectedContextId,
		annee: selectedYear,
		section: 'planning'
	});
});

test('module sibling and library navigation preserve a dirty draft when leaving is cancelled', async ({
	page,
	app
}) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}`);
	await readyModuleEditor(page);
	const title = page.getByLabel('Nom du module', { exact: true });
	await title.fill('Draft retained after cancelled navigation');
	await page.setViewportSize({ width: 1440, height: 900 });
	const destinations = [
		(await openModulePages(page)).getByRole('link', { name: 'Quiz', exact: true }),
		page
			.getByRole('navigation', { name: 'Navigation principale', exact: true })
			.getByRole('link', { name: 'Modules', exact: true })
	];
	for (const destination of destinations) {
		await destination.click();
		const dialog = page.getByRole('alertdialog');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
		await expect(title).toHaveValue('Draft retained after cancelled navigation');
		await expectCurrent(page, 'Préparer');
	}
});

test('module planning links stay unavailable until a pending save completes', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}`);
	await readyModuleEditor(page);
	await page.getByLabel('Nom du module', { exact: true }).fill('Fictional pending module save');
	await chooseSection(page, 'planning', 'Classe et planning');
	const deadlines = page.getByRole('link', {
		name: 'Régler les échéances des évaluations',
		exact: true
	});
	await expect(deadlines).toHaveAttribute('href', /\/bareme\?/);
	let releaseResponse = () => {};
	const responseGate = new Promise<void>((resolve) => {
		releaseResponse = resolve;
	});
	let intercepted = false;
	await page.route(`${app.origin}/enseignant/modules/${app.ids.module}?/saveModule`, async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		intercepted = true;
		await responseGate;
		await route.continue();
	});
	try {
		await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first().click();
		await expect.poll(() => intercepted).toBe(true);
		await expect(deadlines).toHaveAttribute('aria-disabled', 'true');
		await expect(deadlines).toHaveAttribute('tabindex', '-1');
		expect(await deadlines.getAttribute('href')).toBeNull();
		await deadlines.press('Enter');
		await expect(page.getByRole('alertdialog')).toHaveCount(0);
		await expect(page).toHaveURL(new RegExp(`/enseignant/modules/${app.ids.module}(?:\\?|$)`));
	} finally {
		releaseResponse();
	}
	await expect(page.getByText('Toutes les modifications sont enregistrées.', { exact: true })).toBeVisible();
	await expect(deadlines).toHaveAttribute('href', /\/bareme\?/);
	await expect(deadlines).not.toHaveAttribute('tabindex', '-1');
});

test('rubric page navigation keeps its unsaved changes when the leave confirmation is cancelled', async ({
	page,
	app
}) => {
	await activate(page, app);
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.module}/bareme?contexte=${app.ids.currentContext}&retour=module`
	);
	await expectCurrent(page, 'Barème');
	const title = page.getByLabel('Nom de la section', { exact: true }).first();
	await expect(async () => {
		await title.fill('Unsaved rubric section');
		await expect(page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).first()).toBeEnabled({
			timeout: 1000
		});
		await expect(page.getByRole('status').filter({ hasText: 'Modifications non enregistrées.' })).toBeVisible({
			timeout: 1000
		});
	}).toPass({ timeout: 60000 });
	await (await openModulePages(page)).getByRole('link', { name: 'Quiz', exact: true }).click();
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(title).toHaveValue('Unsaved rubric section');
	await expectCurrent(page, 'Barème');
});

test('global grading exposes no module navigation until selection resolves and clears it during loading', async ({
	page,
	app
}) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/notation?annee=`);
	await expect(page.getByText('Choisissez l’année de travail', { exact: true })).toBeVisible();
	await expect(navigation(page)).toHaveCount(0);
	await expect(breadcrumb(page)).toHaveCount(0);
	await page.goto(`${app.origin}/enseignant/notation?module=${app.ids.module}&contexte=${app.ids.currentContext}`);
	await expectCurrent(page, 'Notation');
	await showGradingContext(page);
	let release!: () => void;
	const held = new Promise<void>((done) => {
		release = done;
	});
	let intercepted = false;
	const matcher = (url: URL) => url.pathname.endsWith('/enseignant/notation/__data.json');
	const handler = async (route: Route) => {
		const response = await route.fetch();
		intercepted = true;
		await held;
		await route.fulfill({ response });
	};
	await page.route(matcher, handler);
	try {
		await expect(async () => {
			await page.getByLabel('Module', { exact: true }).selectOption('');
			await expect.poll(() => intercepted, { timeout: 1000 }).toBe(true);
		}).toPass({ timeout: 60000 });
		await expect(navigation(page)).toHaveCount(0);
		await expect(breadcrumb(page)).toHaveCount(0);
	} finally {
		release();
	}
	await expect.poll(() => new URL(page.url()).searchParams.get('module')).toBe('');
	await expect(page.getByLabel('Module', { exact: true })).toHaveValue('');
	await expect(navigation(page)).toHaveCount(0);
});

test('published page is a direct secure new-tab action and is absent for an unpublished module', async ({
	page,
	app
}) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}`);
	await readyModuleEditor(page);
	await expect(page.getByRole('link', { name: /Voir la page publiée/ })).toHaveCount(0);
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.publicationModule}?contexte=${app.ids.publicationContext}`
	);
	await readyModuleEditor(page);
	const published = page.getByRole('link', { name: /Voir la page publiée/ });
	await expect(published).toHaveCount(1);
	await expect(published).toHaveAttribute('href', `/modules/${app.ids.publicationContext}`);
	await expect(published).toHaveAttribute('target', '_blank');
	await expect(published).toHaveAttribute('rel', 'noopener noreferrer');
	await expect(published).toHaveAccessibleName(/nouvel onglet/);
	const popup = page.waitForEvent('popup');
	await published.click();
	const studentPage = await popup;
	await expect(studentPage).toHaveURL(`${app.origin}/modules/${app.ids.publicationContext}`);
	await studentPage.close();
});

test('the mobile page selector exposes five keyboard usable destinations with a long title', async ({
	page,
	app
}, info) => {
	await activate(page, app);
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.publicationModule}?contexte=${app.ids.publicationContext}`
	);
	await readyModuleEditor(page);
	await page
		.getByLabel('Nom du module', { exact: true })
		.fill('A very long fictional module title for checking the complete navigation on narrow phones');
	await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first().click();
	await expect(page.getByRole('status').filter({ hasText: 'Enregistré' })).toBeVisible();
	for (const width of [320, 390]) {
		await page.setViewportSize({ width, height: 844 });
		await expectCurrent(page, 'Préparer');
		await openModulePages(page);
		const geometry = await navigation(page).evaluate((node) => {
			const nav = node.getBoundingClientRect();
			const links = [...node.querySelectorAll('a')].map((link) => {
				const rect = link.getBoundingClientRect();
				return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
			});
			return {
				overflow: document.documentElement.scrollWidth - innerWidth,
				scroll: node.scrollWidth - node.clientWidth,
				contained: links.every(
					(link) =>
						link.left >= nav.left - 1 &&
						link.right <= nav.right + 1 &&
						link.top >= nav.top - 1 &&
						link.bottom <= nav.bottom + 1
				)
			};
		});
		expect(geometry.overflow).toBeLessThanOrEqual(1);
		expect(geometry.scroll).toBeLessThanOrEqual(1);
		expect(geometry.contained).toBe(true);
		for (const link of await (await openModulePages(page)).getByRole('link').all()) await expectTouchTarget(link);
		await page.screenshot({ path: info.outputPath(`module-pages-${width}.png`), fullPage: true });
		await closeModulePages(page);
	}
	await (await openModulePages(page)).getByRole('link', { name: 'Publication', exact: true }).focus();
	await page.keyboard.press('Enter');
	await expectCurrent(page, 'Publication');
});
