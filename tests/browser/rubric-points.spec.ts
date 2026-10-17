import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import type { RubricData } from '../../src/lib/domain/grading.js';
import type { Page } from '@playwright/test';

async function readyRubric(page: Page) {
	const tab = page.getByRole('tab').last();
	await expect(async () => {
		await tab.click();
		await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
	}).toPass({ timeout: 60000 });
}

test('a single newly typed quiz exposes its section maximum before any structural edit', async ({
	app,
	page
}, info) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.publicationModule}/bareme`);
	await readyRubric(page);
	// A single initially selected tab cannot prove hydration. Only the preparation step retries;
	// the section insertion and type change below each happen once.
	await expect(async () => {
		await page
			.getByRole('button', { name: 'Prévisualiser le calcul par sections', exact: true })
			.click();
		await expect(
			page.getByRole('button', { name: 'Utiliser ce calcul dans le brouillon', exact: true })
		).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await page
		.getByRole('button', { name: 'Utiliser ce calcul dans le brouillon', exact: true })
		.click();
	await page.getByRole('button', { name: 'Ajouter une section', exact: true }).click();
	const activeSection = page.getByRole('tabpanel');
	await activeSection.getByLabel('Nom de la section', { exact: true }).fill('Quiz libres fictifs');
	await activeSection.getByLabel('Type de section', { exact: true }).selectOption('quiz');
	await activeSection.getByLabel('Nom du quiz 1', { exact: true }).fill('Quiz court');
	await activeSection.getByLabel('Nombre de questions du quiz 1', { exact: true }).fill('5');
	const maximum = page.getByLabel('Maximum de la section Quiz libres fictifs (pts)', {
		exact: true
	});
	await page.screenshot({
		path: info.outputPath('single-quiz-before-maximum.png'),
		fullPage: true
	});
	await info.attach('single-quiz-semantics', {
		body: await page.locator('main').ariaSnapshot(),
		contentType: 'text/plain'
	});
	await expect(maximum).toBeVisible();
	await expect(maximum).toHaveValue('');
	await expect(activeSection.getByLabel('Nom du quiz 2', { exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).click();
	const maximumError = page.getByRole('button', {
		name: 'Quiz libres fictifs · Maximum · Choisissez un maximum entier positif pour cette section Quiz.',
		exact: true
	});
	await expect(maximumError).toBeVisible();
	await maximumError.focus();
	await page.keyboard.press('Enter');
	await expect(maximum).toBeFocused();
	await expect(maximum).toHaveAttribute('aria-invalid', 'true');
	await expect(maximum).toHaveAccessibleDescription(/maximum entier positif/);
	for (const invalid of ['0', '2.5']) {
		await maximum.fill(invalid);
		await expect(maximum).toHaveAttribute('aria-invalid', 'true');
	}
	await maximum.fill('12');
	await expect(maximum).not.toHaveAttribute('aria-invalid', 'true');
	await expect(maximumError).toHaveCount(0);
	await expect(page.getByRole('status', { name: 'Total des maxima', exact: true })).toHaveText(
		'32 pts'
	);
	await activeSection.getByLabel('Nom de la section', { exact: true }).fill('Quiz unique fictif');
	const renamedMaximum = page.getByLabel('Maximum de la section Quiz unique fictif (pts)', {
		exact: true
	});
	await expect(renamedMaximum).toHaveValue('12');
	for (const kind of ['other', 'project', 'oral']) {
		await activeSection.getByLabel('Type de section', { exact: true }).selectOption(kind);
		await expect(renamedMaximum).toHaveCount(0);
		await expect(
			activeSection.getByLabel('Maximum du critère 1 (pts)', { exact: true })
		).toHaveValue('5');
		await expect(page.getByRole('status', { name: 'Total des maxima', exact: true })).toHaveText(
			'25 pts'
		);
	}
	await activeSection.getByLabel('Type de section', { exact: true }).selectOption('quiz');
	await expect(renamedMaximum).toHaveValue('');
	await renamedMaximum.fill('12');
	await activeSection
		.getByLabel('Participation aux résultats', { exact: true })
		.selectOption('formative');
	await expect(renamedMaximum).toHaveCount(0);
	await expect(page.getByRole('status', { name: 'Total des maxima', exact: true })).toHaveText(
		'20 pts'
	);
	await activeSection
		.getByLabel('Participation aux résultats', { exact: true })
		.selectOption('graded');
	await expect(renamedMaximum).toHaveValue('12');
	const responsePromise = page.waitForResponse(
		(response) =>
			response.url().endsWith(`/modules/${app.ids.publicationModule}/rubric`) &&
			response.request().method() === 'PATCH',
		{ timeout: 15000 }
	);
	await page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).click();
	const response = await responsePromise;
	expect(response.status()).toBe(200);
	const saved = (await response.json()) as RubricData;
	const quiz = saved.assessments.find((assessment) => assessment.title === 'Quiz unique fictif')!;
	expect(quiz.lines).toHaveLength(1);
	expect(quiz.lines[0].maxPoints).toBe(5);
	expect(saved.results[0].rule).toMatchObject({
		kind: 'weighted',
		sectionPoints: { quizMaxima: [{ assessmentId: quiz.id, maxPoints: 12 }] },
		components: [
			{ assessmentIds: [saved.assessments[0].id], weight: 62.5 },
			{ assessmentIds: [quiz.id], weight: 37.5 }
		]
	});
	await page.reload();
	await readyRubric(page);
	await expect(renamedMaximum).toHaveValue('12');
	await expect(
		activeSection.getByLabel('Nombre de questions du quiz 1', { exact: true })
	).toHaveValue('5');
	await expect(page.getByRole('status', { name: 'Total des maxima', exact: true })).toHaveText(
		'32 pts'
	);
	await renamedMaximum.focus();
	await page.keyboard.press('Tab');
	await expect(renamedMaximum).not.toBeFocused();
	await expect(page.locator('body')).toHaveJSProperty(
		'scrollWidth',
		await page.locator('body').evaluate((element) => element.clientWidth)
	);
	await page.screenshot({ path: info.outputPath('single-quiz-reloaded.png'), fullPage: true });
});

test('section maxima persist, quiz maximum stays separate, and HTTP 409 retains the draft', async ({
	app,
	page,
	context
}, info) => {
	await activate(page, app);
	const created = await context.request.post(app.origin + '/api/teaching/modules', {
		headers: { Origin: app.origin, 'Idempotency-Key': crypto.randomUUID() },
		data: {
			title: 'Barème simple fictif',
			description: '',
			objectives: [],
			sourcePath: '',
			preparation: { framing: '', nextSteps: '', sourceLinks: [] },
			resources: [],
			contexts: []
		}
	});
	expect(created.status()).toBe(200);
	const module = (await created.json()) as { id: string };
	await page.goto(`${app.origin}/enseignant/modules/${module.id}/bareme`);
	const activeSection = page.getByRole('tabpanel');
	await expect(page.getByRole('heading', { name: 'Total du barème', exact: true })).toBeVisible();
	await expect(async () => {
		await page.getByRole('button', { name: 'Ajouter une section', exact: true }).first().click();
		await expect(activeSection.getByLabel('Nom de la section', { exact: true })).toBeVisible({
			timeout: 1000
		});
	}).toPass({ timeout: 60000 });
	await activeSection.getByLabel('Nom de la section', { exact: true }).fill('Dossier');
	await activeSection.getByLabel('Libellé du critère 1', { exact: true }).fill('Livrable');
	await activeSection.getByLabel('Maximum du critère 1 (pts)', { exact: true }).fill('35');
	await page.getByRole('button', { name: 'Ajouter une section', exact: true }).click();
	await activeSection.getByLabel('Nom de la section', { exact: true }).fill('Soutenance');
	await activeSection.getByLabel('Type de section', { exact: true }).selectOption('oral');
	await activeSection.getByLabel('Libellé du critère 1', { exact: true }).fill('Présentation');
	await activeSection.getByLabel('Maximum du critère 1 (pts)', { exact: true }).fill('60');
	await page.getByRole('button', { name: 'Ajouter une section', exact: true }).click();
	await activeSection.getByLabel('Nom de la section', { exact: true }).fill('Quiz');
	await activeSection.getByLabel('Type de section', { exact: true }).selectOption('quiz');
	await activeSection.getByLabel('Nom du quiz 1', { exact: true }).fill('Quiz court');
	await activeSection.getByLabel('Nombre de questions du quiz 1', { exact: true }).fill('5');
	await page.getByRole('button', { name: 'Ajouter un quiz', exact: true }).click();
	await activeSection.getByLabel('Nom du quiz 2', { exact: true }).fill('Quiz long');
	await activeSection.getByLabel('Nombre de questions du quiz 2', { exact: true }).fill('20');
	const quizMaximum = page.getByLabel('Maximum de la section Quiz (pts)', { exact: true });
	await expect(quizMaximum).toHaveValue('');
	await quizMaximum.fill('20');
	await expect(page.getByText('Vérifiez le barème', { exact: true })).toHaveCount(0);
	await expect(page.getByRole('status', { name: 'Total des maxima', exact: true })).toHaveText(
		'115 pts'
	);
	await quizMaximum.focus();
	await page.keyboard.press('Tab');
	await expect(quizMaximum).not.toBeFocused();
	await page.screenshot({ path: info.outputPath('rubric-section-maxima.png'), fullPage: true });
	await info.attach('rubric-semantics', {
		body: await page.locator('main').ariaSnapshot(),
		contentType: 'text/plain'
	});
	const savedResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith(`/modules/${module.id}/rubric`) &&
			response.request().method() === 'PATCH',
		{ timeout: 15000 }
	);
	await page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).click();
	const response = await savedResponse;
	expect(response.status()).toBe(200);
	const saved = (await response.json()) as RubricData;
	expect(saved.results[0].rule).toMatchObject({
		kind: 'weighted',
		sectionPoints: { quizMaxima: [{ maxPoints: 20 }] }
	});
	await page.reload();
	await readyRubric(page);
	await expect(quizMaximum).toHaveValue('20');
	await expect(page.getByRole('status', { name: 'Total des maxima', exact: true })).toHaveText(
		'115 pts'
	);
	const stale = await context.request.patch(
		`${app.origin}/api/teaching/modules/${module.id}/rubric`,
		{
			headers: { Origin: app.origin },
			data: {
				assessments: saved.assessments,
				results: saved.results,
				contexts: [],
				expectedRevision: saved.module.revision
			}
		}
	);
	expect(stale.status()).toBe(200);
	await quizMaximum.fill('30');
	const conflict = page.waitForResponse(
		(response) =>
			response.url().endsWith(`/modules/${module.id}/rubric`) && response.status() === 409,
		{ timeout: 15000 }
	);
	await page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).click();
	await conflict;
	await expect(page.getByText('Version à comparer', { exact: true })).toBeVisible();
	await expect(quizMaximum).toHaveValue('30');
	await expect(page.locator('body')).toHaveJSProperty(
		'scrollWidth',
		await page.locator('body').evaluate((element) => element.clientWidth)
	);
});

test('legacy independent dossiers save unchanged without automatic consolidation', async ({
	app,
	page
}, info) => {
	await activate(page, app);
	const original = await app.call<RubricData>('read-independent-rubric');
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.secondModule}/bareme`);
	await readyRubric(page);
	await expect(
		page.getByRole('heading', { name: 'Résultats configurés', exact: true })
	).toBeVisible();
	await expect(
		page.getByText(
			'Ces résultats restent indépendants. Leur configuration est conservée ci-dessous.',
			{ exact: true }
		)
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Prévisualiser le calcul par sections', exact: true })
	).toHaveCount(0);
	const disclosure = page
		.locator('summary')
		.filter({ hasText: 'Configurer les résultats existants' });
	await disclosure.focus();
	await page.keyboard.press('Enter');
	await expect(
		page.getByRole('button', { name: 'Ajouter un résultat indépendant', exact: true })
	).toBeVisible();
	const titles = await page
		.getByLabel('Nom du résultat', { exact: true })
		.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
	expect(titles).toEqual(original.results.map((result) => result.title));
	await page.screenshot({
		path: info.outputPath('rubric-independent-results.png'),
		fullPage: true
	});
	const response = page.waitForResponse(
		(item) =>
			item.url().endsWith(`/modules/${app.ids.secondModule}/rubric`) &&
			item.request().method() === 'PATCH',
		{ timeout: 15000 }
	);
	await page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).click();
	const saved = await response;
	expect(saved.status()).toBe(200);
	const results = ((await saved.json()) as RubricData).results;
	expect(results).toEqual(original.results);
	await page.reload();
	await expect(
		page.getByText(
			'Ces résultats restent indépendants. Leur configuration est conservée ci-dessous.',
			{ exact: true }
		)
	).toBeVisible();
	expect((await app.call<RubricData>('read-independent-rubric')).results).toEqual(original.results);
});
