import { chmod } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../src/lib/server/db/index.js';
import * as tables from '../../src/lib/server/db/schema.js';
import { createClass, createModule } from '../../src/lib/server/teaching/service.js';
import {
	getGradeGrid,
	getRubric,
	replaceRubric,
	saveCorrection,
	saveSemesterComment
} from '../../src/lib/server/teaching/grading.js';
import { emptyModule } from '../../src/lib/teaching/types.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { readPdfText } from './support/pdf.js';
import { setGradingFilters } from './support/grading.js';

test('a new correction persists, exports both fictional students despite a filter, and retains graded points on rubric changes', async ({
	app,
	page
}, info) => {
	test.setTimeout(360000);
	page.setDefaultTimeout(10000);
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	const db = createDatabase(client);
	try {
		const year = '2026-2027';
		const className = 'Test UX — Fiabilité des corrections';
		const record = await createClass(db, {
			name: className,
			academicYear: year
		});
		const names = ['Test UX — Élise Martin', 'Test UX — Émile Durand'];
		const students = names.map((name, position) => ({
			id: crypto.randomUUID(),
			classId: record.id,
			name,
			position
		}));
		await db.insert(tables.students).values(students);
		const contextId = crypto.randomUUID();
		const module = await createModule(db, {
			...emptyModule(),
			title: 'Test UX — Étude détaillée',
			description: 'PRIVATE_RELIABILITY_DESCRIPTION_MARKER',
			contexts: [{ id: contextId, classId: record.id, lessons: [] }]
		});
		const initial = await getRubric(db, module.id);
		const groupId = crypto.randomUUID();
		const oralGroupId = crypto.randomUUID();
		let rubric = await replaceRubric(db, module.id, {
			expectedRevision: initial.module.revision,
			assessments: [
				{
					id: crypto.randomUUID(),
					title: 'Dossier',
					kind: 'other',
					purpose: 'graded',
					groups: [{ id: groupId, title: 'Analyse détaillée' }],
					lines: Array.from({ length: 20 }, (_, index) => ({
						id: crypto.randomUUID(),
						groupId,
						label: `Critère détaillé ${index + 1}`,
						description:
							'Vérifier les références, la cohérence de l’analyse et la précision des explications avec les accents français.',
						maxPoints: 1
					}))
				},
				{
					id: crypto.randomUUID(),
					title: 'Présentation',
					kind: 'oral',
					purpose: 'graded',
					groups: [{ id: oralGroupId, title: 'Présentation' }],
					lines: [
						{
							id: crypto.randomUUID(),
							groupId: oralGroupId,
							label: 'Expression orale',
							description: 'Qualité de la présentation.',
							maxPoints: 20
						}
					]
				}
			],
			results: [],
			contexts: initial.contexts.map((context) => ({
				id: context.id,
				expectedRevision: context.expectedRevision,
				deadlines: []
			}))
		});
		rubric = await replaceRubric(db, module.id, {
			expectedRevision: rubric.module.revision,
			assessments: rubric.assessments,
			results: [
				{
					id: crypto.randomUUID(),
					title: 'Note du module',
					rule: {
						kind: 'points_ratio',
						assessmentIds: rubric.assessments.map((assessment) => assessment.id)
					}
				}
			],
			contexts: rubric.contexts.map((context) => ({
				id: context.id,
				expectedRevision: context.expectedRevision,
				deadlines: []
			}))
		});
		for (const [index, assessment] of rubric.assessments.entries()) {
			await saveCorrection(db, contextId, students[1].id, assessment.id, {
				expectedRevision: 0,
				rubricRevision: rubric.module.revision,
				status: 'graded',
				submissionUrl: null,
				submittedAt: null,
				latenessDecision: 'automatic',
				scores: assessment.lines.map((line, position) => ({
					lineId: line.id,
					points: index === 0 ? (position < 16 ? 1 : 0) : 20
				}))
			});
		}
		await saveSemesterComment(db, contextId, students[0].id, {
			expectedRevision: 0,
			content: 'PRIVATE_RELIABILITY_COMMENT_MARKER'
		});
		await activate(page, app);
		const correctionURL = `${app.origin}/enseignant/notation/${contextId}/${students[0].id}`;
		await page.goto(correctionURL);
		await expect(async () => {
			await page.getByLabel('Évaluation', { exact: true }).selectOption({ label: 'Présentation' });
			await expect(page.getByLabel(/^Expression orale(?: \(optionnel\))?$/)).toBeVisible({
				timeout: 1000
			});
		}).toPass({ timeout: 60000 });
		await page.getByLabel('Évaluation', { exact: true }).selectOption({ label: 'Dossier' });
		for (let index = 0; index < 20; index++)
			await page
				.getByLabel(new RegExp(`^Critère détaillé ${index + 1}(?: \\(optionnel\\))?$`))
				.fill(index < 18 ? '1' : '0');
		await page.getByRole('button', { name: 'Modifier la remise', exact: true }).click();
		await page
			.getByLabel('Lien de la remise (optionnel)', { exact: true })
			.fill('https://example.test/private-reliability-submission');
		await page.getByLabel('Statut de l’évaluation', { exact: true }).selectOption('graded');
		await page.getByRole('button', { name: 'Enregistrer Dossier', exact: true }).press('Enter');
		await expect(page.getByText('Dossier enregistré.', { exact: true }).first()).toBeVisible();
		await page.getByLabel('Évaluation', { exact: true }).selectOption({ label: 'Présentation' });
		const lastField = page.getByLabel(/^Expression orale(?: \(optionnel\))?$/);
		await lastField.fill('16');
		await lastField.focus();
		await expect(lastField).toBeFocused();
		await page.getByLabel('Statut de l’évaluation', { exact: true }).selectOption('graded');
		const save = page.getByRole('button', { name: 'Enregistrer Présentation', exact: true });
		await save.focus();
		await expect(save).toBeInViewport({ ratio: 1 });
		await page.keyboard.press('Enter');
		await expect(page.getByText('Présentation enregistré.', { exact: true }).first()).toBeVisible();
		await page.screenshot({ path: info.outputPath('new-student-correction.png'), fullPage: true });
		await page.getByRole('link', { name: 'Retour à la grille', exact: true }).press('Enter');
		await expect(page).toHaveURL(new RegExp(`/enseignant/notation\\?.*contexte=${contextId}`));
		await page.reload();
		await page.goto(correctionURL);
		await expect(async () => {
			await page.getByLabel('Évaluation', { exact: true }).selectOption({ label: 'Présentation' });
			await expect(lastField).toHaveValue('16', { timeout: 1000 });
		}).toPass({ timeout: 60000 });
		await expect(lastField).toHaveValue('16');
		const individualDownload = page.waitForEvent('download');
		await page.getByRole('button', { name: `Télécharger le PDF individuel de ${names[0]}`, exact: true }).click();
		const individualPath = info.outputPath('individual-final.pdf');
		await (await individualDownload).saveAs(individualPath);
		await chmod(individualPath, 0o600);
		const individualText = await readPdfText(individualPath);
		for (const value of [
			names[0],
			module.title,
			className,
			'2026-2027',
			'Critère détaillé 20',
			'Expression orale',
			'17,0'
		])
			expect(individualText).toContain(value);
		expect(individualText).not.toMatch(/Émile Durand|PRIVATE_RELIABILITY|https?:\/\//);
		await page.goto(`${app.origin}/enseignant/notation?module=${module.id}&contexte=${contextId}`);
		await expect(async () => {
			await setGradingFilters(page, { search: names[0] });
			await expect(page.getByRole('status').filter({ hasText: /1 \/ 2 étudiants/ })).toBeVisible({
				timeout: 1000
			});
		}).toPass({ timeout: 60000 });
		const classDownload = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Télécharger le PDF', exact: true }).click();
		const classPath = info.outputPath('class-final.pdf');
		await (await classDownload).saveAs(classPath);
		await chmod(classPath, 0o600);
		const classText = await readPdfText(classPath);
		for (const value of [...names, 'Test UX — Fiabilité des corrections', year, '17,0', '18,0'])
			expect(classText).toContain(value);
		expect(classText).not.toMatch(/PRIVATE_RELIABILITY|https?:\/\//);
		const before = await db.select().from(tables.scores).orderBy(tables.scores.id);
		await page.goto(`${app.origin}/enseignant/modules/${module.id}/bareme`);
		const presentation = page.getByRole('tab', { name: 'Présentation', exact: false });
		await expect(async () => {
			await presentation.click();
			await expect(presentation).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
		}).toPass({ timeout: 60000 });
		const panel = page.getByRole('tabpanel');
		await panel.getByLabel('Maximum du critère 1 (pts)', { exact: true }).fill('19');
		await page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).first().click();
		await expect(page.getByText(/Barème enregistré\. Les points sont conservés/).first()).toBeVisible();
		expect(await db.select().from(tables.scores).orderBy(tables.scores.id)).toEqual(before);
		expect(
			await db.select().from(tables.corrections).where(eq(tables.corrections.assessmentId, rubric.assessments[1].id))
		).toEqual(expect.arrayContaining([expect.objectContaining({ needsReview: true })]));
		await panel.getByRole('button', { name: 'Retirer la section', exact: true }).click();
		const removal = page.getByRole('alertdialog');
		await expect(removal).toContainText('Les points déjà enregistrés seront conservés');
		await expect(removal).toContainText('Résultats à vérifier : Note du module');
		await removal.getByRole('button', { name: 'Retirer du brouillon', exact: true }).click();
		await expect(removal).not.toBeVisible();
		await expect(panel.getByLabel('Nom de la section', { exact: true })).toBeFocused();
		await page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).first().click();
		await expect(page.getByText('Barème enregistré.', { exact: true }).first()).toBeVisible();
		expect(await db.select().from(tables.scores).orderBy(tables.scores.id)).toEqual(before);
		const grid = await getGradeGrid(db, module.id, contextId);
		expect(grid.students[0].retiredScores).toEqual(expect.arrayContaining([expect.objectContaining({ points: 16 })]));
	} finally {
		client.close();
	}
});
