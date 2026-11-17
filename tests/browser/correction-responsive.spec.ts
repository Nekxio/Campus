import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { readFormActionCommand } from './support/form-actions.js';

const summary = (page: Page) => page.getByRole('region', { name: 'Bilan des évaluations' });
const bilan = (page: Page) => page.getByRole('button', { name: 'Bilan', exact: true });
const returnToEntry = (page: Page) => page.getByRole('button', { name: 'Revenir à la saisie', exact: true });

test.beforeEach(({ page }) => page.setDefaultTimeout(15000));

const fontDiagnostics = new WeakMap<Page, () => Promise<void>>();
const jumpDiagnostics = new WeakMap<Page, unknown[]>();
test.afterEach(async ({ page }, info) => {
	await fontDiagnostics.get(page)?.();
	const jumps = jumpDiagnostics.get(page);
	if (jumps?.length) {
		await writeFile(info.outputPath('jump-geometry.json'), JSON.stringify(jumps, null, 2));
		if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('jump-failure.png') });
	}
});

function observeInter(page: Page, info: TestInfo, origin: string) {
	const responses: { url: string; resourceType: string; status: number }[] = [];
	const failures: { url: string; resourceType: string; error: string | undefined }[] = [];
	let loaded: unknown = null;
	let probe: { url: string; httpStatus: number; bytes: number; sha256: string } | null = null;
	const interFile = (url: string) => /^inter-.*\.woff2$/.test(new URL(url).pathname.split('/').at(-1) ?? '');
	page.on('response', (response) => {
		if (interFile(response.url()))
			responses.push({
				url: response.url(),
				resourceType: response.request().resourceType(),
				status: response.status()
			});
	});
	page.on('requestfailed', (request) => {
		if (interFile(request.url()))
			failures.push({
				url: request.url(),
				resourceType: request.resourceType(),
				error: request.failure()?.errorText
			});
	});
	const persist = async () => {
		await writeFile(
			info.outputPath('inter-network.json'),
			JSON.stringify(
				{
					loaded,
					probe,
					responses,
					fontResponses: responses.filter((response) => response.resourceType === 'font'),
					nonFontResponses: responses.filter((response) => response.resourceType !== 'font'),
					revalidations: responses.filter((response) => response.status === 304),
					failures
				},
				null,
				2
			)
		);
	};
	fontDiagnostics.set(page, persist);
	return async () => {
		try {
			// Like annual-summary's probe: loaded faces plus an owned HTTP read of real font bytes.
			const font = await page.evaluate(async () => {
				const loads = await Promise.all(
					[400, 500, 600, 700].map(async (weight) => ({
						weight,
						faces: (
							await document.fonts.load(`${weight} 16px "Inter Variable"`, 'Évaluation Bilan à compléter 012')
						).map((face) => ({ family: face.family, status: face.status }))
					}))
				);
				await document.fonts.ready;
				return { family: getComputedStyle(document.body).fontFamily, loads };
			});
			loaded = font;
			expect(font.family).toContain('Inter Variable');
			for (const load of font.loads) {
				expect(load.faces.length, `Inter ${load.weight}: nonempty FontFaceSet.load`).toBeGreaterThan(0);
				for (const face of load.faces) {
					expect(face.family).toContain('Inter Variable');
					expect(face.status).toBe('loaded');
				}
			}
			const fontResponses = responses.filter((response) => response.resourceType === 'font');
			expect(fontResponses.length, 'Observed actual Inter font request').toBeGreaterThan(0);
			// A .woff2?import script is a URL module, not a font download. Preserve its raw status.
			for (const response of responses)
				expect([200, 304], `${response.resourceType} ${response.url}`).toContain(response.status);
			expect(failures, 'No failed Inter requests').toEqual([]);
			const latin = fontResponses.find((response) =>
				new URL(response.url).pathname.endsWith('/inter-latin-wght-normal.woff2')
			);
			if (!latin) throw new Error('No actual request for the installed Inter Latin font.');
			expect(new URL(latin.url).origin).toBe(origin);
			const response = await page.request.get(latin.url);
			const body = await response.body();
			probe = {
				url: latin.url,
				httpStatus: response.status(),
				bytes: body.byteLength,
				sha256: createHash('sha256').update(body).digest('hex')
			};
			expect(probe.httpStatus).toBe(200);
			expect(probe.bytes).toBe(48256);
			expect(probe.sha256).toBe('3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62');
			return { ...font, probe, responses: [...responses], failures: [...failures] };
		} finally {
			await persist();
		}
	};
}

async function selectProject(page: Page) {
	// Like grading.spec: a server-rendered select can be enabled before hydration.
	await expect(async () => {
		await page.getByLabel('Évaluation', { exact: true }).selectOption({ label: 'Projet' });
		await expect(page.getByRole('textbox', { name: /^Navigation(?: \(optionnel\))?$/ })).toBeVisible({
			timeout: 1000
		});
	}).toPass({ timeout: 15000 });
}

async function setPanel(page: Page, name: string, open: boolean) {
	const trigger = page.getByRole('button', { name, exact: true });
	await expect(async () => {
		if ((await trigger.getAttribute('aria-expanded')) !== String(open)) await trigger.click();
		await expect(trigger).toHaveAttribute('aria-expanded', String(open), { timeout: 1000 });
	}).toPass({ timeout: 15000 });
}

async function stableCorrectionLayout(page: Page) {
	const samples = await page.evaluate(async () => {
		const read = () => {
			const summary = document.getElementById('correction-summary')?.getBoundingClientRect();
			return {
				width: innerWidth,
				height: innerHeight,
				scrollHeight: document.scrollingElement?.scrollHeight,
				workspaceWidth: document.getElementById('workspace-content')?.getBoundingClientRect().width,
				summaryTop: summary ? summary.top + scrollY : null,
				summaryWidth: summary?.width,
				summaryHeight: summary?.height
			};
		};
		const samples = [read()];
		let stableFrames = 0;
		for (let frame = 0; frame < 30; frame++) {
			await new Promise<void>((done) => requestAnimationFrame(() => done()));
			const current = read();
			stableFrames = JSON.stringify(current) === JSON.stringify(samples.at(-1)) ? stableFrames + 1 : 0;
			samples.push(current);
			if (stableFrames === 3) return samples;
		}
		throw new Error('Correction responsive geometry did not settle before keyboard activation.');
	});
	const jumps = jumpDiagnostics.get(page) ?? [];
	jumps.push({ phase: 'layout-before-input', samples });
	jumpDiagnostics.set(page, jumps);
}

async function belowHeader(page: Page, target: Locator) {
	await expect(target).toBeFocused();
	const geometry = await target.evaluate((node) => {
		const rect = node.getBoundingClientRect();
		const header = document.querySelector('.teacher-header')?.getBoundingClientRect();
		const headerBottom = Math.max(0, header?.bottom ?? 0);
		const root = document.scrollingElement;
		const fullyVisible = (box: DOMRect) =>
			box.top >= headerBottom && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
		const measure = (element: Element | null) => {
			if (!element) return null;
			const box = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return {
				tag: element.tagName,
				id: element.id,
				rect: box.toJSON(),
				scrollTop: element.scrollTop,
				scrollHeight: element.scrollHeight,
				clientHeight: element.clientHeight,
				maxScroll: Math.max(0, element.scrollHeight - element.clientHeight),
				overflowY: style.overflowY,
				scrollPaddingTop: style.scrollPaddingTop,
				scrollPaddingBottom: style.scrollPaddingBottom,
				scrollMarginTop: style.scrollMarginTop,
				fits: box.height <= innerHeight - headerBottom,
				fullyVisible: fullyVisible(box)
			};
		};
		const ancestors = [];
		for (let parent = node.parentElement; parent; parent = parent.parentElement) ancestors.push(measure(parent));
		const summary = document.getElementById('correction-summary');
		return {
			target: measure(node),
			top: rect.top,
			bottom: rect.bottom,
			minimumTop: rect.top + scrollY - (document.documentElement.scrollHeight - innerHeight),
			headerBottom,
			header: header?.toJSON(),
			viewport: { width: innerWidth, height: innerHeight },
			visualViewport: window.visualViewport
				? {
						height: visualViewport!.height,
						offsetTop: visualViewport!.offsetTop,
						scale: visualViewport!.scale
					}
				: null,
			scrollY,
			compatMode: document.compatMode,
			scrollingElement: measure(root),
			documentElement: measure(document.documentElement),
			body: measure(document.body),
			ancestors,
			focused: document.activeElement === node,
			activeElement: { tag: document.activeElement?.tagName, id: document.activeElement?.id },
			summary: measure(summary),
			entry: measure(document.getElementById('correction-entry')),
			summaryControls: summary
				? [...summary.querySelectorAll('button, a')]
						.filter((element) => element.getBoundingClientRect().width > 0)
						.map((element) => ({
							name: element.getAttribute('aria-label') ?? element.textContent?.trim(),
							...measure(element)
						}))
				: [],
			overflow: document.documentElement.scrollWidth - innerWidth
		};
	});
	const jumps = jumpDiagnostics.get(page) ?? [];
	jumps.push(geometry);
	jumpDiagnostics.set(page, jumps);
	expect(geometry.focused).toBe(true);
	expect(geometry.top).toBeGreaterThanOrEqual(geometry.headerBottom);
	await expect(target).toBeInViewport();
	if (geometry.target?.fits) {
		expect(geometry.target.fullyVisible, 'A jump target that fits must be completely visible').toBe(true);
		await expect(target).toBeInViewport({ ratio: 1 });
	} else {
		await expect(target.getByRole('heading', { name: 'Bilan des évaluations', exact: true })).toBeInViewport();
		await expect(returnToEntry(page)).toBeInViewport();
	}
	expect(geometry.overflow).toBeLessThanOrEqual(1);
}

async function jumpRoundTrip(page: Page) {
	const url = page.url();
	const draft = () =>
		page
			.locator(
				'#correction-form input, #correction-form select, #correction-form textarea, #semester-comment-form textarea, #assessment-status, #assessment-choice'
			)
			.evaluateAll((nodes) =>
				nodes.map((node) => {
					const field = node as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
					return { id: field.id, value: field.value, disabled: field.disabled };
				})
			);
	const before = await draft();
	// focus() + keyboard events do not wait for the sidebar's responsive layout to settle.
	await stableCorrectionLayout(page);
	await bilan(page).focus();
	await page.keyboard.press('Enter');
	await belowHeader(page, summary(page));
	await returnToEntry(page).focus();
	await page.keyboard.press('Space');
	await belowHeader(page, page.locator('#correction-entry'));
	await expect(page.getByRole('alertdialog')).toHaveCount(0);
	expect(page.url()).toBe(url);
	expect(new URL(page.url()).hash).toBe('');
	expect(await draft(), 'Internal jumps must not alter points, status, assessment or comment').toEqual(before);
}

test('local jumps preserve one draft through resize, invalid points, absence and delay decisions', async ({
	page,
	app
}, testInfo) => {
	const requireInter = observeInter(page, testInfo, app.origin);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`);
	await writeFile(testInfo.outputPath('font-readiness.json'), JSON.stringify(await requireInter(), null, 2));
	const quiz = page.getByRole('textbox', { name: /^Total de points(?: \(optionnel\))?$/ });
	await expect(quiz).toBeEnabled();
	if (testInfo.project.name === 'mobile') {
		await expect(bilan(page)).toBeInViewport();
		await quiz.focus();
		await expect(quiz).toBeFocused();
		await belowHeader(page, quiz);
	} else {
		await expect(bilan(page)).toBeHidden();
		await expect(returnToEntry(page)).toBeHidden();
	}
	await selectProject(page);
	const point = page.getByRole('textbox', { name: /^Navigation(?: \(optionnel\))?$/ });
	await expect(point).toHaveValue('4');
	await expect(point).toHaveAccessibleDescription(/Maximum : 5 points/);
	await page.getByRole('button', { name: 'Commentaire privé du semestre', exact: true }).click();
	const comment = page.getByRole('textbox', {
		name: 'Commentaire privé du semestre (optionnel)',
		exact: true
	});
	await comment.fill('Brouillon privé conservé au redimensionnement');
	await point.fill('3');
	const original = await point.elementHandle();
	const requests: string[] = [];
	page.on('request', (request) => {
		if (request.url().includes('/api/teaching/') || request.isNavigationRequest()) requests.push(request.method());
	});
	for (const width of [320, 390, 768, 1440, 390]) {
		await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
		await expect(point).toHaveValue('3');
		await expect(comment).toHaveValue('Brouillon privé conservé au redimensionnement');
		expect(await point.evaluate((node, previous) => node === previous, original)).toBe(true);
		await expect(page.locator('#correction-form')).toHaveCount(1);
		await expect(page.locator('#assessment-status')).toHaveCount(1);
		if (width < 1280) await jumpRoundTrip(page);
		else {
			await expect(bilan(page)).toBeHidden();
			await expect(returnToEntry(page)).toBeHidden();
		}
	}
	if (testInfo.project.name === 'mobile') {
		await bilan(page).tap();
		await belowHeader(page, summary(page));
		await returnToEntry(page).tap();
		await belowHeader(page, page.locator('#correction-entry'));
	}
	expect(requests).toEqual([]);
	await point.fill('');
	await jumpRoundTrip(page);
	await expect(point).toHaveValue('');
	await point.fill('0');
	await jumpRoundTrip(page);
	await expect(point).toHaveValue('0');
	await point.fill('2.5');
	await page.keyboard.press('Tab');
	await expect(point).toHaveAttribute('aria-invalid', 'true');
	await jumpRoundTrip(page);
	await expect(point).toHaveValue('2.5');
	await point.fill('9');
	await page.keyboard.press('Tab');
	await expect(point).toHaveAttribute('aria-invalid', 'true');
	await jumpRoundTrip(page);
	await expect(point).toHaveValue('9');
	await point.fill('3');
	const status = page.getByLabel('Statut de l’évaluation', { exact: true });
	for (const absence of ['absent_unjustified', 'absent_justified']) {
		await status.selectOption(absence);
		await expect(point).toBeDisabled();
		await jumpRoundTrip(page);
		await expect(point).toHaveValue('3');
		await expect(page.getByRole('region', { name: 'Contexte de la correction' })).toContainText(
			absence === 'absent_unjustified' ? 'Absence injustifiée · zéro' : 'Rattrapage à traiter'
		);
	}
	await status.selectOption('graded');
	await expect(point).toBeEnabled();
	await expect(point).toHaveValue('3');
	await page.getByRole('button', { name: 'Modifier la remise', exact: true }).click();
	await expect(page.getByLabel(/^Date de remise(?: \(optionnel\))?$/)).toHaveValue('2026-10-12T09:10');
	const delay = page.getByLabel('Décision de retard ou non-remise', { exact: true });
	const context = page.getByRole('region', { name: 'Contexte de la correction' });
	await expect(context).toContainText('2 jours · −2,0 /20');
	for (const [value, label] of [
		['exempt', 'Exception de retard accordée'],
		['refused', 'Production refusée · zéro'],
		['automatic', '2 jours · −2,0 /20']
	]) {
		await delay.selectOption(value);
		await expect(context).toContainText(label);
		await jumpRoundTrip(page);
		await expect(point).toHaveValue('3');
	}
	await expect(page.getByRole('link', { name: 'Ouvrir la remise', exact: true })).toHaveAttribute(
		'href',
		'https://example.test/fictional-submission'
	);
	await page.getByRole('button', { name: 'Modifier la remise', exact: true }).click();
	await expect(page.locator('#submission-fields')).toHaveCount(0);
	await page.getByRole('button', { name: 'Commentaire privé du semestre', exact: true }).click();
	await expect(comment).toHaveCount(0);
	await page.getByRole('button', { name: 'Commentaire privé du semestre', exact: true }).click();
	await expect(comment).toHaveValue('Brouillon privé conservé au redimensionnement');
	expect(requests).toEqual([]);
});

test('jumps retain network retry and real 409 drafts without merging the comment save', async ({
	page,
	app,
	context
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`);
	await expect(page.getByRole('textbox', { name: /^Total de points(?: \(optionnel\))?$/ })).toBeEnabled();
	await page.setViewportSize({ width: 390, height: 844 });
	await selectProject(page);
	const point = page.getByRole('textbox', { name: /^Navigation(?: \(optionnel\))?$/ });
	await point.fill('3');
	await page.getByRole('button', { name: 'Commentaire privé du semestre', exact: true }).click();
	const comment = page.getByRole('textbox', {
		name: 'Commentaire privé du semestre (optionnel)',
		exact: true
	});
	const text = 'Commentaire privé indépendant des points';
	await comment.fill(text);
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.origin });
	await page.getByRole('button', { name: 'Copier', exact: true }).click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
	await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('data-y-position', 'top');
	const endpoint = '**/enseignant/notation/*/*?/saveAssessment';
	const commands: unknown[] = [];
	await page.route(endpoint, async (route) => {
		commands.push(await readFormActionCommand(route.request()));
		if (commands.length === 1) await route.abort('failed');
		else await route.continue();
	});
	const save = page.getByRole('button', { name: 'Enregistrer Projet', exact: true });
	await save.click();
	const feedback = page.getByRole('alert').filter({ hasText: 'Vérifiez la correction' });
	await expect(feedback).toBeFocused();
	await expect(point).toHaveValue('3');
	await jumpRoundTrip(page);
	await expect(comment).toHaveValue(text);
	const saved = page.waitForResponse(
		(response) => response.url().endsWith('?/saveAssessment') && response.status() === 200
	);
	await save.click();
	await saved;
	await expect(save).toBeDisabled();
	expect(commands).toHaveLength(2);
	expect(commands[1]).toEqual(commands[0]);
	await expect(comment).toHaveValue(text);
	await expect(page.getByText('Commentaire non enregistré', { exact: true })).toBeVisible();
	const commentSaved = page.waitForResponse(
		(response) => response.url().endsWith('?/saveComment') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Enregistrer le commentaire', exact: true }).click();
	expect((await commentSaved).status()).toBe(200);
	await page.reload();
	await expect(page.getByRole('textbox', { name: /^Total de points(?: \(optionnel\))?$/ })).toBeEnabled();
	await selectProject(page);
	await expect(point).toHaveValue('3');
	await page.getByRole('button', { name: 'Commentaire privé du semestre', exact: true }).click();
	await expect(comment).toHaveValue(text);
	await point.fill('2');
	await comment.fill('Brouillon conservé pendant le conflit');
	await app.call('conflict-correction');
	const conflict = page.waitForResponse(
		(response) =>
			response.url().endsWith('?/saveAssessment') && response.request().method() === 'POST' && response.status() === 409
	);
	await save.click();
	await conflict;
	await expect(page.getByRole('alert').filter({ hasText: 'Version à actualiser' })).toBeFocused();
	await jumpRoundTrip(page);
	await expect(point).toHaveValue('2');
	await expect(comment).toHaveValue('Brouillon conservé pendant le conflit');
	await expect(save).toBeDisabled();
	await page.getByRole('button', { name: 'Recharger la version actuelle', exact: true }).click();
	await expect(page.getByRole('alertdialog', { name: 'Recharger la correction ?' })).toBeVisible();
	await page.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(point).toHaveValue('2');
	await page.getByRole('button', { name: 'Recharger la version actuelle', exact: true }).click();
	await page.getByRole('button', { name: 'Recharger et remplacer', exact: true }).click();
	await expect(page.getByRole('textbox', { name: /^Total de points(?: \(optionnel\))?$/ })).toBeEnabled();
	await selectProject(page);
	await expect(point).toHaveValue('5');
	await page.getByRole('button', { name: 'Commentaire privé du semestre', exact: true }).click();
	await expect(comment).toHaveValue(text);
	await page.getByRole('link', { name: 'Étudiant suivant', exact: true }).click();
	await expect(page).toHaveURL(`${app.origin}/enseignant/notation/${app.ids.currentContext}/${app.ids.students[1]}`);
	await page.getByRole('link', { name: 'Étudiant précédent', exact: true }).click();
	await expect(page).toHaveURL(`${app.origin}/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`);
});

test('batched correction captures retain long criteria, diagnostics, panels and the bounded desktop frame', async ({
	page,
	app
}, testInfo) => {
	test.setTimeout(360000);
	const requireInter = observeInter(page, testInfo, app.origin);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const measures: Record<string, unknown>[] = [];
	const widths = testInfo.project.name === 'mobile' ? [320, 390] : [1440];
	async function appearance(colorScheme: 'light' | 'dark') {
		await page.emulateMedia({ colorScheme });
		await expect
			.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
			.toBe(colorScheme === 'dark');
	}
	async function capture(name: string) {
		await page.evaluate(() => document.fonts.ready);
		const fonts = await requireInter();
		const state = await page.evaluate(() => ({
			width: innerWidth,
			overflow: document.documentElement.scrollWidth - innerWidth,
			firstPointTop: document.querySelector('input[inputmode="numeric"]')?.getBoundingClientRect().top,
			context: document.querySelector('.context-strip')?.getBoundingClientRect().toJSON(),
			summary: document.querySelector('.bottom-summary')?.getBoundingClientRect().toJSON(),
			body: document.querySelector('.correction-body')?.getBoundingClientRect().toJSON(),
			fields: [...document.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"]')].map((node) => ({
				height: node.getBoundingClientRect().height,
				font: getComputedStyle(node).fontSize
			}))
		}));
		expect(state.overflow, name).toBeLessThanOrEqual(1);
		if (testInfo.project.name === 'mobile')
			for (const field of state.fields) {
				expect(field.height).toBeGreaterThanOrEqual(44);
				expect(field.font).toBe('16px');
			}
		measures.push({ name, fonts, ...state });
		await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: false });
	}
	// A render-only route in the disposable copy: no fixture DB, production route or guard is changed.
	const id = (n: number) => `01200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
	const lines = Array.from({ length: 32 }, (_, index) => ({
		id: id(100 + index),
		groupId: id(3),
		label: `Critère ${index + 1} · navigation accessible et robuste`,
		description: 'Description fictive longue pour vérifier le retour à la ligne et la lecture des critères.',
		maxPoints: 5
	}));
	const students = [0, 1].map((index) => ({
		id: id(10 + index),
		name: index ? 'Autre étudiant fictif' : 'Alexandrine de la Roche · démonstration fictive',
		corrections: [
			{
				assessmentId: id(2),
				revision: 1,
				rubricRevision: 1,
				status: 'graded',
				submissionUrl: 'https://example.test/fictional-submission',
				submittedAt: '2026-10-12T07:10:00Z',
				latenessDecision: 'automatic',
				scores: lines.map((line) => ({ lineId: line.id, points: null }))
			}
		],
		comment: { revision: 1, content: 'Commentaire privé fictif, distinct de la correction.' },
		retiredScores: Array.from({ length: 40 }, (_, i) => ({
			assessmentTitle: 'Ancien projet',
			label: `Critère retiré ${i + 1}`,
			points: 8,
			maxPoints: 5
		}))
	}));
	const data = {
		contextId: id(4),
		studentId: students[0].id,
		students,
		rubric: {
			module: {
				id: id(1),
				title: 'Module fictif · interfaces accessibles et corrections détaillées',
				revision: 1
			},
			assessments: [
				{
					id: id(2),
					title: 'Projet',
					kind: 'project',
					purpose: 'graded',
					groups: [{ id: id(3), title: 'Fonctionnalités' }],
					lines
				}
			],
			results: [0, 1].map((index) => ({
				id: id(20 + index),
				title: `Résultat indépendant ${index + 1}`,
				rule: { kind: 'points_ratio', assessmentIds: [id(2)] }
			})),
			contexts: [
				{
					id: id(4),
					classId: id(5),
					expectedRevision: 1,
					className: 'Classe fictive',
					academicYear: '2026-2027',
					deadlines: [
						{
							assessmentId: id(2),
							dueAt: '2026-10-10T21:59:00Z',
							submissionInstructions: 'Remettre le lien du dépôt fictif.'
						}
					]
				}
			]
		}
	};
	const route = 'src/routes/__correction-responsive-fixture/+page.svelte';
	const source = `<script lang="ts">
import TeacherWorkspace from '#lib/components/teaching/TeacherWorkspace.svelte';
import Draft from '#lib/components/grading/DetailedCorrectionDraft.svelte';
import type { DetailedCorrectionData } from '#lib/components/grading/DetailedCorrection.svelte';
const data = ${JSON.stringify(data)} satisfies DetailedCorrectionData;
</script>
<TeacherWorkspace userName="Enseignant fictif" active="grading" title="Correction fictive" boundedCorrection>
<Draft {data} student={data.students[0]} onreload={async () => {}} />
</TeacherWorkspace>`;
	await mkdir(join(app.manifest.directory, 'src/routes/__correction-responsive-fixture'));
	await writeFile(join(app.manifest.directory, route), source);
	await writeFile(
		testInfo.outputPath('render-fixture-manifest.json'),
		JSON.stringify(
			{
				added: [{ path: route, sha256: createHash('sha256').update(source).digest('hex') }],
				sourceInputs: app.manifest.files,
				limits: 'Render-only fictional long group/history; no persisted save assertions on this route.'
			},
			null,
			2
		)
	);
	// Let Kit register the disposable route before a browser document exists to reload via HMR.
	await expect
		.poll(async () => (await page.request.get(app.origin + '/__correction-responsive-fixture')).status())
		.toBe(200);
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`);
	await expect(page.getByRole('textbox', { name: /^Total de points(?: \(optionnel\))?$/ })).toBeEnabled();
	for (const width of widths) {
		await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
		for (const colorScheme of ['light', 'dark'] as const) {
			await appearance(colorScheme);
			await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
			await page.evaluate(() => window.scrollTo(0, 0));
			await capture(`normal-${width}-${colorScheme}`);
		}
	}
	await page.goto(app.origin + '/__correction-responsive-fixture');
	await expect(page.getByRole('textbox', { name: lines[0].label, exact: true })).toBeEnabled();
	await setPanel(page, 'Modifier la remise', true);
	await setPanel(page, 'Modifier la remise', false);
	for (const width of widths) {
		await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
		for (const colorScheme of ['light', 'dark'] as const) {
			await appearance(colorScheme);
			await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
			await page.evaluate(() => window.scrollTo(0, 0));
			await capture(`long-${width}-${colorScheme}`);
			for (const name of [
				'Modifier la remise',
				'Commentaire privé du semestre',
				'Critères retirés (40)',
				'Détails du bilan (2 résultats)'
			]) {
				await setPanel(page, name, true);
			}
			await expect(page.locator('#correction-diagnostics li')).toHaveCount(32);
			await expect(page.locator('#retired-score-history li')).toHaveCount(40);
			await expect(page.locator('.mobile-summary').getByText(/32 éléments à compléter/)).toHaveCount(2);
			const lastPoint = page.getByRole('textbox', { name: lines[31].label, exact: true });
			await lastPoint.focus();
			await page.keyboard.press('Tab');
			await page.keyboard.press('Shift+Tab');
			await expect(lastPoint).toBeFocused();
			await expect(lastPoint).toBeInViewport();
			if (width === 1440) {
				await expect(page.getByRole('region', { name: 'Contexte de la correction' })).toBeInViewport();
				await expect(page.getByRole('link', { name: 'Étudiant suivant', exact: true })).toBeInViewport();
				await expect(page.getByRole('button', { name: 'Enregistrer Projet', exact: true })).toBeInViewport();
				expect(await page.locator('.correction-body').evaluate((node) => getComputedStyle(node).overflowY)).toBe(
					'auto'
				);
				await expect(summary(page)).toBeInViewport({ ratio: 1 });
				expect(await page.locator('.criteria-scroll').evaluate((node) => getComputedStyle(node).overflowY)).toBe(
					'visible'
				);
			} else await jumpRoundTrip(page);
			await capture(`panels-${width}-${colorScheme}`);
			await page.locator('#submission-fields').scrollIntoViewIfNeeded();
			await capture(`submission-${width}-${colorScheme}`);
			await page.locator('#semester-comment').scrollIntoViewIfNeeded();
			await capture(`comment-${width}-${colorScheme}`);
			await page.locator('#retired-score-history').scrollIntoViewIfNeeded();
			await capture(`history-${width}-${colorScheme}`);
			for (const name of [
				'Détails du bilan (2 résultats)',
				'Critères retirés (40)',
				'Commentaire privé du semestre',
				'Modifier la remise'
			]) {
				await setPanel(page, name, false);
			}
		}
	}
	await writeFile(testInfo.outputPath('measurements.json'), JSON.stringify({ measures, errors }, null, 2));
	expect(errors).toEqual([]);
});
