import { chmod } from 'node:fs/promises';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { readPdfText } from './support/pdf.js';
import type { RubricData } from '../../src/lib/domain/grading.js';

test('a saved section rubric opens its class grid, computes the total and exports the whole class', async ({
	page,
	context,
	app
}, info) => {
	await activate(page, app);
	const independentBefore = await app.call<RubricData>('read-independent-rubric');
	expect(independentBefore.results).toHaveLength(2);
	const contextId = crypto.randomUUID();
	const created = await context.request.post(app.origin + '/api/teaching/modules', {
		headers: { Origin: app.origin, 'Idempotency-Key': crypto.randomUUID() },
		data: {
			title: 'Intégration fictive · dossier et soutenance',
			description: '',
			objectives: [],
			sourcePath: '',
			preparation: { framing: '', nextSteps: '', sourceLinks: [] },
			resources: [],
			contexts: [{ id: contextId, classId: app.ids.currentClass, lessons: [] }]
		}
	});
	expect(created.status()).toBe(200);
	const module = (await created.json()) as { id: string };
	await page.goto(
		app.origin +
			'/enseignant/modules/' +
			module.id +
			'/bareme?retour=notation&contexte=' +
			contextId
	);
	await expect(page.getByRole('heading', { name: 'Total du barème', exact: true })).toBeVisible();
	const section = page.getByRole('tabpanel');
	await expect(async () => {
		await page.getByRole('button', { name: 'Ajouter une section', exact: true }).first().click();
		await expect(section.getByLabel('Nom de la section', { exact: true })).toBeVisible({
			timeout: 1000
		});
	}).toPass({ timeout: 60000 });
	await section.getByLabel('Nom de la section', { exact: true }).fill('Dossier');
	await section.getByLabel('Libellé du critère 1', { exact: true }).fill('Analyse');
	await section.getByLabel('Maximum du critère 1 (pts)', { exact: true }).fill('35');
	await page.getByRole('button', { name: 'Ajouter une section', exact: true }).click();
	await section.getByLabel('Nom de la section', { exact: true }).fill('Soutenance');
	await section.getByLabel('Type de section', { exact: true }).selectOption('oral');
	await section.getByLabel('Libellé du critère 1', { exact: true }).fill('Présentation');
	await section.getByLabel('Maximum du critère 1 (pts)', { exact: true }).fill('60');
	await expect(page.getByRole('status', { name: 'Total des maxima', exact: true })).toHaveText(
		'95 pts'
	);
	const savedResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith('/modules/' + module.id + '/rubric') &&
			response.request().method() === 'PATCH'
	);
	await page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).click();
	const response = await savedResponse;
	expect(response.status()).toBe(200);
	const rubric = (await response.json()) as RubricData;
	expect(rubric.assessments.map((item) => item.kind)).toEqual(['other', 'oral']);
	expect(rubric.results[0].rule).toMatchObject({
		kind: 'weighted',
		sectionPoints: { quizMaxima: [] }
	});
	await page.getByRole('button', { name: 'Retour à la grille', exact: true }).click();
	await expect(page.getByLabel('Année de travail', { exact: true })).toHaveValue('2026-2027');
	await expect(page.getByLabel('Classe et année', { exact: true })).toHaveValue(
		app.ids.currentClass
	);
	await expect(page.getByLabel('Module', { exact: true })).toHaveValue(module.id);
	const exportPanel = page.getByRole('region', { name: 'Export PDF du module', exact: true });
	await expect(exportPanel).toContainText('0/12 étudiants');
	await expect(
		exportPanel.getByRole('button', { name: 'Télécharger le PDF', exact: true })
	).toBeDisabled();
	for (const [index, studentId] of app.ids.students.entries()) {
		for (const [assessmentIndex, assessment] of rubric.assessments.entries()) {
			const saved = await context.request.patch(
				app.origin +
					'/api/teaching/contexts/' +
					contextId +
					'/students/' +
					studentId +
					'/assessments/' +
					assessment.id,
				{
					headers: { Origin: app.origin },
					data: {
						expectedRevision: 0,
						rubricRevision: rubric.module.revision,
						status: 'graded',
						submissionUrl: null,
						submittedAt: null,
						latenessDecision: 'automatic',
						scores: assessment.lines.map((line) => ({
							lineId: line.id,
							points: assessmentIndex === 0 ? 28 : 30
						}))
					}
				}
			);
			expect(saved.status()).toBe(200);
		}
		if (index === 0) {
			await page.reload();
			await expect(exportPanel).toContainText('1/12 étudiants');
			await expect(page.locator('#selected-student-summary')).toContainText('12,2 /20');
			await expect(
				exportPanel.getByRole('button', { name: 'Télécharger le PDF', exact: true })
			).toBeDisabled();
		}
	}
	await page.reload();
	await expect(exportPanel).toContainText('12/12 étudiants');
	await expect(async () => {
		await page.getByLabel('Rechercher un étudiant', { exact: true }).fill('Aline');
		await expect(page.getByText(/1 \/ 12 étudiants/)).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 15000 });
	await expect(page.locator('#selected-student-summary')).toContainText('12,2 /20');
	const downloadEvent = page.waitForEvent('download');
	await exportPanel.getByRole('button', { name: 'Télécharger le PDF', exact: true }).click();
	const download = await downloadEvent;
	const path = info.outputPath('section-rubric-whole-class.pdf');
	await download.saveAs(path);
	await chmod(path, 0o600);
	const text = await readPdfText(path);
	for (const name of ['Aline Moreau', 'Camille Demo', 'Noé Petit', 'Zoé Dupont'])
		expect(text).toContain(name);
	expect(text).toContain('12,2');
	expect(text).toContain('Dossier');
	expect(text).toContain('Soutenance');
	const independentAfter = await app.call<RubricData>('read-independent-rubric');
	expect(independentAfter.results).toEqual(independentBefore.results);
	expect(independentAfter.module.revision).toBe(independentBefore.module.revision);
	await page.screenshot({
		path: info.outputPath('section-rubric-in-class-grid.png'),
		fullPage: true,
		animations: 'disabled'
	});
});
