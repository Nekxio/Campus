import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import type { Page, TestInfo } from '@playwright/test';

const introduction =
	'Configurez les sections, les lignes du barème et les résultats calculés. Les points des étudiants se saisissent dans la correction.';
const quizHelp =
	'Une ligne par quiz Wayground · 1 question = 1 point · chaque quiz a le même poids après conversion sur 20.';

async function readyRubric(page: Page) {
	const tab = page.getByRole('tab').last();
	const select = page.getByLabel('Section du barème', { exact: true });
	await expect(async () => {
		if (await select.isVisible()) {
			const option = select.getByRole('option').last();
			await select.selectOption((await option.getAttribute('value'))!);
			await expect(page.getByRole('tabpanel').getByLabel('Nom de la section', { exact: true })).toHaveValue(
				(await option.textContent())!.trim().split(' · ')[0],
				{ timeout: 1000 }
			);
		} else {
			await tab.click();
			await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
		}
	}).toPass({ timeout: 60000 });
}

const selectQuizSection = async (page: Page) => {
	const select = page.getByLabel('Section du barème', { exact: true });
	if (await select.isVisible()) await select.selectOption({ label: 'Quiz' });
	else await page.getByRole('tab', { name: 'Quiz', exact: true }).click();
};

async function expectInterLoaded(page: Page, info: TestInfo) {
	const font = await page.evaluate(async () => {
		const faces = await document.fonts.load('400 16px "Inter Variable"', 'Campus Barème Quiz é');
		await document.fonts.ready;
		return {
			faces: faces.map((face) => ({ family: face.family, status: face.status })),
			url: performance
				.getEntriesByType('resource')
				.map((entry) => entry.name)
				.find((url) => new URL(url).pathname.endsWith('/inter-latin-wght-normal.woff2'))
		};
	});
	expect(font.faces.length).toBeGreaterThan(0);
	expect(font.faces.every((face) => face.status === 'loaded' && face.family.includes('Inter Variable'))).toBe(true);
	expect(font.url).toBeDefined();
	const asset = new URL(font.url!);
	expect(asset.origin).toBe(new URL(page.url()).origin);
	const response = await page.request.get(asset.href, { headers: { 'Cache-Control': 'no-cache' } });
	expect(response.status()).toBe(200);
	const bytes = (await response.body()).length;
	expect(bytes).toBeGreaterThan(0);
	await info.attach('inter-loaded', {
		body: JSON.stringify({
			faces: font.faces,
			path: asset.pathname,
			status: response.status(),
			bytes
		}),
		contentType: 'application/json'
	});
}

async function captureMatrix(page: Page, info: TestInfo, name: string) {
	if (info.project.name !== 'desktop') return;
	const states = [];
	for (const theme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
		await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
		for (const width of [320, 390, 1024, 1440]) {
			await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
			const faces = await page.evaluate(async () =>
				(await document.fonts.load('400 16px "Inter Variable"', 'Barème é')).map((face) => face.status)
			);
			expect(faces.length).toBeGreaterThan(0);
			expect(faces.every((status) => status === 'loaded')).toBe(true);
			const panel = page.getByRole('tabpanel');
			for (const control of [
				panel.getByLabel('Nom de la section', { exact: true }),
				panel.getByLabel('Nom du quiz 1', { exact: true }),
				panel.getByLabel('Nombre de questions du quiz 1', { exact: true }),
				panel.locator('.definition-table')
			]) {
				await expect(control).toBeVisible();
				const box = await control.boundingBox();
				expect(box).not.toBeNull();
				expect(box!.width).toBeGreaterThan(0);
				expect(box!.height).toBeGreaterThan(0);
			}
			const state = await page.evaluate(() => ({
				width: innerWidth,
				overflow: document.documentElement.scrollWidth - innerWidth,
				font: document.fonts.check('14px "Inter Variable"')
			}));
			expect(state.overflow, `${name} ${theme} ${width}`).toBeLessThanOrEqual(1);
			expect(state.font).toBe(true);
			states.push({ theme, ...state });
			await page.screenshot({
				path: info.outputPath(`${name}-${theme}-${width}.png`),
				fullPage: true
			});
		}
	}
	await info.attach(`${name}-matrix`, {
		body: JSON.stringify(states, null, 2),
		contentType: 'application/json'
	});
}

test('rubric copy separates configuration, quiz questions and the section contribution', async ({
	page,
	app
}, info) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.publicationModule}/bareme`);
	await readyRubric(page);
	await expectInterLoaded(page, info);
	const intro = page.getByText(introduction, { exact: true });
	await expect(intro).toBeVisible();
	expect(
		await intro.evaluate((node) =>
			Boolean(node.compareDocumentPosition(document.querySelector('#rubric-form')!) & Node.DOCUMENT_POSITION_FOLLOWING)
		)
	).toBe(true);
	await expect(async () => {
		await page.getByRole('button', { name: 'Prévisualiser le calcul par sections', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Utiliser ce calcul dans le brouillon', exact: true })).toBeVisible({
			timeout: 1000
		});
	}).toPass({ timeout: 60000 });
	await page.getByRole('button', { name: 'Utiliser ce calcul dans le brouillon', exact: true }).click();
	const writes: string[] = [];
	page.on('request', (request) => {
		if (request.method() === 'POST' && request.url().includes('?/saveRubric')) writes.push(request.url());
	});
	await page.getByRole('button', { name: 'Ajouter une section', exact: true }).click();
	const panel = page.getByRole('tabpanel');
	await expect(panel.getByRole('button', { name: 'Actions pour la section', exact: true })).toBeVisible();
	const title = 'Quiz de révision · conception et développement d’une application web accessible';
	await panel.getByLabel('Nom de la section', { exact: true }).fill(title);
	await panel.getByLabel('Type de section', { exact: true }).selectOption('quiz');

	await expect(panel.getByLabel('Nom du quiz 1', { exact: true })).toBeVisible();
	await expect(panel.getByLabel('Nombre de questions du quiz 1', { exact: true })).toBeVisible();
	const sectionFieldset = panel.locator('fieldset').first();
	await expect(sectionFieldset).toHaveCSS('display', 'block');
	await expect(sectionFieldset.locator(':scope > legend')).toHaveCount(1);
	for (const control of [
		panel.getByLabel('Nom du quiz 1', { exact: true }),
		panel.getByLabel('Nombre de questions du quiz 1', { exact: true }),
		panel.locator('.definition-table')
	]) {
		const box = await control.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.width).toBeGreaterThan(0);
		expect(box!.height).toBeGreaterThan(0);
	}
	await panel.getByLabel('Nom du quiz 1', { exact: true }).fill('Total de points');
	await panel.getByLabel('Nombre de questions du quiz 1', { exact: true }).fill('5');
	await expect(panel.getByLabel('Groupe du quiz 1', { exact: true })).toBeVisible();
	await expect(panel.getByLabel('Groupe du critère 1', { exact: true })).toHaveCount(0);
	const help = panel.getByText(quizHelp, { exact: true });
	await expect(help).toHaveCount(1);
	expect(await help.evaluate((node) => node.nextElementSibling?.classList.contains('definition-wrap'))).toBe(true);
	await expect(panel.getByRole('status', { name: `Total des questions des quiz de ${title}`, exact: true })).toHaveText(
		'5 questions au total'
	);
	await expect(panel.getByRole('status', { name: 'Maximum du groupe Critères', exact: true })).toHaveText(
		'5 questions au total'
	);
	const maximum = page.getByLabel(`Maximum de la section ${title} (pts)`, { exact: true });
	await maximum.fill('12');
	await expect(maximum).toHaveValue('12');
	await expect(maximum).toHaveAccessibleDescription(
		'Chaque quiz est normalisé, puis leur moyenne à poids égal est convertie sur ce maximum.'
	);
	await expect(page.getByRole('status', { name: 'Total des maxima', exact: true })).toHaveText('32 pts');
	await expect(
		panel.getByRole('group', { name: 'Groupes de lignes et maxima', exact: true })
	).toHaveAccessibleDescription(
		'Les groupes organisent les lignes du barème. Leurs maxima sont calculés à partir des lignes. En retirant un groupe, ses critères rejoignent le premier groupe.'
	);
	const actions = panel.getByRole('button', { name: `Actions pour ${title}`, exact: true });
	await actions.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('menuitem', { name: 'Retirer', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(actions).toBeFocused();
	await captureMatrix(page, info, 'quiz-questions-contribution');
	await page.getByRole('button', { name: 'Ajouter un groupe', exact: true }).click();
	const group = panel.getByLabel('Nom du groupe 2', { exact: true });
	await expect(group).toBeFocused();
	await group.fill('Révision fictive');
	await panel.getByLabel('Groupe du quiz 1', { exact: true }).selectOption({ label: 'Révision fictive' });
	await panel.getByRole('button', { name: 'Actions pour Révision fictive', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Retirer', exact: true }).click();
	await expect(
		page.getByText(
			'Groupe retiré du brouillon ; ses critères ont rejoint le premier groupe. Enregistrez le barème pour confirmer.',
			{ exact: true }
		)
	).toBeVisible();
	await expect(panel.getByLabel('Nom du quiz 1', { exact: true })).toHaveValue('Total de points');
	await expect(panel.getByLabel('Nombre de questions du quiz 1', { exact: true })).toHaveValue('5');
	await expect(maximum).toHaveValue('12');
	await expect(page.getByText('Modifications non enregistrées.', { exact: true })).toBeVisible();
	expect(writes).toEqual([]);
});

test('custom results name sections, exclude formative work and never use quiz question sums as denominators', async ({
	page,
	app
}, info) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}/bareme`);
	await readyRubric(page);
	await expectInterLoaded(page, info);
	await selectQuizSection(page);
	const panel = page.getByRole('tabpanel');
	await expect(panel.getByLabel('Nom du quiz 1', { exact: true })).toHaveValue('Total de points');
	await panel.getByLabel('Nombre de questions du quiz 1', { exact: true }).fill('5');
	await page.getByRole('button', { name: 'Ajouter un quiz', exact: true }).click();
	await panel.getByLabel('Nom du quiz 2', { exact: true }).fill('Quiz long fictif');
	await panel.getByLabel('Nombre de questions du quiz 2', { exact: true }).fill('20');
	await page.getByRole('button', { name: 'Ajouter une section', exact: true }).click();
	await panel.getByLabel('Nom de la section', { exact: true }).fill('Entraînement formatif');
	await panel.getByLabel('Libellé du critère 1', { exact: true }).fill('Exercice fictif');
	await expect(panel.getByLabel('Groupe du critère 1', { exact: true })).toBeVisible();
	await panel.getByLabel('Participation aux résultats', { exact: true }).selectOption('formative');
	await selectQuizSection(page);
	await expect(page.getByRole('heading', { name: 'Résultats calculés configurés', exact: true })).toBeVisible();
	const disclosure = page.locator('summary').filter({ hasText: 'Configurer les résultats existants' });
	await disclosure.focus();
	await page.keyboard.press('Enter');
	const results = page.getByRole('complementary', { name: 'Résultats indépendants', exact: true });
	const resultTitle = results.getByLabel('Nom du résultat', { exact: true });
	await expect(resultTitle).toHaveValue('Note finale');
	await resultTitle.fill('Résultat personnalisé · bilan des compétences');
	await expect(results.getByText('Résultats indépendants, ramenés sur 20.', { exact: true })).toBeVisible();
	for (const summary of await results.locator('.component-editor summary').all()) {
		await summary.focus();
		await page.keyboard.press('Enter');
	}
	const component = results.getByRole('group', {
		name: 'Sections de la composante 1',
		exact: true
	});
	await expect(component.getByRole('checkbox', { name: 'Quiz · quiz à poids égal', exact: true })).toBeChecked();
	await expect(
		component.getByRole('checkbox', { name: 'Projet · maximum brut : 100 pts', exact: true })
	).not.toBeChecked();
	await expect(
		component.getByRole('checkbox', { name: 'Entraînement formatif · formative', exact: true })
	).toBeDisabled();
	await expect(
		component.getByRole('checkbox', { name: 'Entraînement formatif · formative', exact: true })
	).not.toBeChecked();
	await expect(component).toHaveAccessibleDescription('Les sections formatives restent hors résultats.');
	await expect(
		results.getByText(
			'Chaque composante regroupe des sections, pas des groupes de critères. Elle moyenne ses notes sur 20 à poids égal. Les poids des composantes doivent totaliser 100 %.',
			{ exact: true }
		)
	).toBeVisible();
	await expect(results.getByRole('status', { name: 'Total des poids', exact: true })).toHaveText('100 %');
	await captureMatrix(page, info, 'custom-result-sections');
	await results.getByLabel('Règle de calcul', { exact: true }).selectOption('points_ratio');
	const sections = results.getByRole('group', { name: 'Sections comptabilisées', exact: true });
	await expect(sections.getByRole('checkbox', { name: 'Quiz · quiz à poids égal', exact: true })).toBeChecked();
	await expect(sections.getByRole('checkbox', { name: 'Projet · maximum brut : 100 pts', exact: true })).toBeChecked();
	await expect(
		sections.getByRole('checkbox', { name: 'Entraînement formatif · formative', exact: true })
	).toBeDisabled();
	await expect(sections).not.toContainText('/25');
	await expect(resultTitle).toHaveValue('Résultat personnalisé · bilan des compétences');
	await expect(panel.getByRole('status', { name: 'Total des questions des quiz de Quiz', exact: true })).toHaveText(
		'25 questions au total'
	);
	await info.attach('custom-results-semantics', {
		body: await results.ariaSnapshot(),
		contentType: 'text/plain'
	});
});
