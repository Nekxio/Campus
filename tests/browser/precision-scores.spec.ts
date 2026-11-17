import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { createDatabase } from '../../src/lib/server/db/index.js';
import * as tables from '../../src/lib/server/db/schema.js';
import { createClass, createModule } from '../../src/lib/server/teaching/service.js';
import { getRubric, replaceRubric, saveCorrection } from '../../src/lib/server/teaching/grading.js';
import { emptyModule } from '../../src/lib/teaching/types.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { fulfillFormAction } from './support/form-actions.js';

test('criterion errors preserve drafts and distinguish empty, zero, partial and saved corrections', async ({
	app,
	page
}, info) => {
	test.setTimeout(360000);
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	const db = createDatabase(client);
	try {
		const record = await createClass(db, {
			name: 'Test UX — Précision',
			academicYear: '2026-2027'
		});
		const studentId = crypto.randomUUID();
		await db.insert(tables.students).values({ id: studentId, classId: record.id, name: 'Bilal Test', position: 0 });
		const contextId = crypto.randomUUID();
		const module = await createModule(db, {
			...emptyModule(),
			title: 'Test UX — Précision des points',
			contexts: [{ id: contextId, classId: record.id, lessons: [] }]
		});
		const initial = await getRubric(db, module.id);
		const assessmentId = crypto.randomUUID();
		const groupId = crypto.randomUUID();
		const rubric = await replaceRubric(db, module.id, {
			expectedRevision: initial.module.revision,
			assessments: [
				{
					id: assessmentId,
					title: 'Dossier',
					kind: 'other',
					purpose: 'graded',
					groups: [{ id: groupId, title: 'Critères' }],
					lines: [8, 6, 6].map((maxPoints, index) => ({
						id: crypto.randomUUID(),
						groupId,
						label: `Critère ${index + 1}`,
						description:
							index === 0
								? 'Précision de l’analyse, cohérence des références et justification complète des choix présentés.'
								: 'Vérification du travail réalisé.',
						maxPoints
					}))
				}
			],
			results: [
				{
					id: crypto.randomUUID(),
					title: 'Note du module',
					rule: { kind: 'points_ratio', assessmentIds: [assessmentId] }
				}
			],
			contexts: initial.contexts.map((context) => ({
				id: context.id,
				expectedRevision: context.expectedRevision,
				deadlines: []
			}))
		});
		const assessment = rubric.assessments[0];
		for (const points of [9, -1, 1.5]) {
			await expect(
				saveCorrection(db, contextId, studentId, assessmentId, {
					expectedRevision: 0,
					rubricRevision: rubric.module.revision,
					status: 'to_evaluate',
					submissionUrl: null,
					submittedAt: null,
					latenessDecision: 'automatic',
					scores: assessment.lines.map((line, index) => ({
						lineId: line.id,
						points: index === 0 ? points : null
					}))
				})
			).rejects.toMatchObject({ status: 422 });
		}
		await activate(page, app);
		await page.goto(`${app.origin}/enseignant/notation/${contextId}/${studentId}`);
		const score = page.getByLabel('Critère 1', { exact: true });
		const second = page.getByLabel('Critère 2', { exact: true });
		const third = page.getByLabel('Critère 3', { exact: true });
		const status = page.getByLabel('Statut de l’évaluation', { exact: true });
		await expect(async () => {
			await status.selectOption('graded');
			await expect(
				page.getByText('Corrigez les champs signalés avant d’enregistrer. Vos saisies sont conservées.', {
					exact: true
				})
			).toBeVisible({
				timeout: 1000
			});
		}).toPass({ timeout: 60000 });
		await status.selectOption('to_evaluate');
		await page.screenshot({ path: info.outputPath('empty-correction.png'), fullPage: true });
		await expect.soft(page.getByText('Aucun critère noté · 0/3 renseignés', { exact: true }).first()).toBeVisible();
		await expect.soft(page.getByText('Aucune modification en attente.', { exact: true })).toBeVisible();
		await second.fill('4');
		await score.fill('9');
		await score.press('Tab');
		await page.screenshot({ path: info.outputPath('invalid-correction.png'), fullPage: true });
		await expect(score).toHaveAttribute('aria-invalid', 'true');
		await expect(
			page
				.getByText('Saisissez un entier entre 0 et 8. La valeur saisie est conservée.', {
					exact: true
				})
				.first()
		).toBeVisible();
		await expect(score).toHaveAccessibleDescription(/Saisissez un entier entre 0 et 8/);
		await expect(page.getByText('Calcul indisponible · corrigez les points', { exact: true }).first()).toBeVisible();
		await expect(page.getByRole('button', { name: 'Enregistrer Dossier', exact: true })).toBeDisabled();
		await expect(second).toHaveValue('4');
		await status.selectOption('absent_unjustified');
		await expect(score).toBeDisabled();
		await expect(score).not.toHaveAttribute('aria-invalid', 'true');
		await expect(score).toHaveValue('9');
		await status.selectOption('to_evaluate');
		for (const invalid of ['-1', '1.5', '1,5', '1e1', '0x4', 'abc']) {
			await score.fill(invalid);
			await score.press('Tab');
			await expect(score).toHaveAttribute('aria-invalid', 'true');
			await expect(score).toHaveValue(invalid);
			await expect(second).toHaveValue('4');
		}
		await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.origin });
		await page.evaluate(() => navigator.clipboard.writeText('1,5'));
		await score.selectText();
		await score.press('ControlOrMeta+V');
		await score.press('Tab');
		await expect(score).toHaveValue('1,5');
		await expect(score).toHaveAttribute('aria-invalid', 'true');
		await expect(second).toHaveValue('4');
		await score.fill('0');
		await expect(score).not.toHaveAttribute('aria-invalid', 'true');
		await expect(page.getByText('4 / 20 pts · partiel · 2/3 renseignés', { exact: true }).first()).toBeVisible();
		await score.fill('');
		await score.press('Tab');
		await expect(score).not.toHaveAttribute('aria-invalid', 'true');
		await expect(page.getByText('4 / 20 pts · partiel · 1/3 renseignés', { exact: true }).first()).toBeVisible();
		await score.fill('8');
		await third.fill('6');
		await expect(page.getByText('18 / 20 pts · 3/3 renseignés', { exact: true }).first()).toBeVisible();
		await status.selectOption('graded');
		const save = page.getByRole('button', { name: 'Enregistrer Dossier', exact: true });
		const writeURL = `**/enseignant/notation/${contextId}/${studentId}?/saveAssessment`;
		await page.route(writeURL, (route) =>
			fulfillFormAction(route, { status: 503, message: 'Enregistrement indisponible pour ce test.' })
		);
		await save.click();
		await expect(page.getByText('Enregistrement indisponible pour ce test.', { exact: true }).first()).toBeVisible();
		await expect(score).toHaveValue('8');
		await expect(second).toHaveValue('4');
		await page.unroute(writeURL);
		await save.click();
		await expect(page.getByText('Dossier enregistré.', { exact: true }).first()).toBeVisible();
		await page.reload();
		await expect(score).toHaveValue('8');
		await expect(page.getByText('Aucune modification en attente.', { exact: true })).toBeVisible();
		for (const width of [375, 390, 1280, 1728]) {
			await page.setViewportSize({ width, height: width < 600 ? 667 : 1000 });
			for (const theme of ['light', 'dark']) {
				await page.evaluate((value) => document.documentElement.classList.toggle('dark', value === 'dark'), theme);
				await score.scrollIntoViewIfNeeded();
				await page.screenshot({
					path: info.outputPath(`correction-viewport-${width}-${theme}.png`)
				});
				await page.screenshot({
					path: info.outputPath(`correction-${width}-${theme}.png`),
					fullPage: true
				});
				await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
			}
			if (width === 1728) {
				const label = await page.locator(`label[for="${await score.getAttribute('id')}"]`).boundingBox();
				const input = await score.boundingBox();
				expect(label && input && input.x - label.x).toBeLessThan(700);
			}
		}
	} finally {
		client.close();
	}
});
