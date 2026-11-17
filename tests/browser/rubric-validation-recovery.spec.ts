import { createClient } from '@libsql/client';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../../src/lib/server/db/index.js';
import * as tables from '../../src/lib/server/db/schema.js';
import { createModule } from '../../src/lib/server/teaching/service.js';
import { getRubric, replaceRubric } from '../../src/lib/server/teaching/grading.js';
import { emptyModule } from '../../src/lib/teaching/types.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

for (const { rejectNegativeFirst, retainOtherError } of [
	{ rejectNegativeFirst: true, retainOtherError: false },
	{ rejectNegativeFirst: false, retainOtherError: false },
	{ rejectNegativeFirst: true, retainOtherError: true }
]) {
	test(`rubric maximum ${rejectNegativeFirst ? '20 → refused -1 → 0' : '20 → 0'} recovers without losing the draft${retainOtherError ? ' while another field stays invalid' : ''}`, async ({
		app,
		page
	}, info) => {
		const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
		const moduleId = crypto.randomUUID();
		try {
			await createDatabase(client)
				.insert(tables.modules)
				.values({ id: moduleId, title: 'Test UX — Récupération du maximum du barème' });
		} finally {
			client.close();
		}
		await activate(page, app);
		await page.goto(`${app.origin}/enseignant/modules/${moduleId}/bareme`);
		await expect(async () => {
			await page.getByRole('button', { name: 'Ajouter une section', exact: true }).first().click();
			await expect(page.getByLabel('Nom de la section', { exact: true })).toBeFocused({
				timeout: 1000
			});
		}).toPass({ timeout: 60000 });
		const title = page.getByLabel('Nom de la section', { exact: true });
		const label = page.getByLabel('Libellé du critère 1', { exact: true });
		await title.fill('Test UX — Livrable avec références et présentation détaillée');
		await label.fill('Test UX — Qualité des références conservées');
		const kind = page.getByLabel('Type de section', { exact: true });
		const group = page.getByLabel('Nom du groupe 1', { exact: true });
		await kind.selectOption('oral');
		await group.fill('Test UX — Références');
		const maximum = page.getByLabel('Maximum du critère 1 (pts)', { exact: true });
		const total = page.getByRole('status', { name: 'Total des maxima', exact: true });
		const submit = page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).first();
		await maximum.fill('20');
		await expect(total).toHaveText('20 pts');
		await submit.click();
		await expect(page.getByText('Barème enregistré.', { exact: true }).first()).toBeVisible();
		if (rejectNegativeFirst) {
			await maximum.fill('-1');
			await maximum.press('Tab');
			await expect(submit).toBeEnabled();
			await expect(maximum).toHaveAttribute('aria-invalid', 'true');
			await expect(page.getByText('Le maximum doit être un entier positif.', { exact: true }).first()).toBeVisible();
		}
		await maximum.fill('0');
		await expect(submit).toBeEnabled();
		await expect(maximum).toHaveValue('0');
		await expect(total).toHaveText('Maximum à corriger');
		await expect(page.getByText(/^Note du module =/)).toHaveCount(0);
		await expect(page.getByText(/Note du module · Poids|Invalid input|NaN|Infinity/)).toHaveCount(0);
		await expect(page.getByText('Le maximum doit être un entier positif.', { exact: true }).first()).toBeVisible();
		await expect(title).toHaveValue('Test UX — Livrable avec références et présentation détaillée');
		await expect(label).toHaveValue('Test UX — Qualité des références conservées');
		await expect(kind).toHaveValue('oral');
		await expect(group).toHaveValue('Test UX — Références');
		const feedback = page
			.locator('[data-slot="alert"]')
			.filter({ has: page.getByText('Vérifiez le barème', { exact: true }) });
		const error = feedback.getByRole('button', { name: /· Maximum · Le maximum doit/ });
		await expect(feedback.getByRole('button')).toHaveCount(1);
		await expect(submit).toBeEnabled();
		await expect(maximum).toHaveValue('0');
		await expect(feedback.getByRole('button')).toHaveCount(1);
		await expect(page.getByText(/Note du module · Poids|Invalid input|NaN|Infinity/)).toHaveCount(0);
		await error.focus();
		await page.keyboard.press('Enter');
		await expect(maximum).toBeFocused();
		await expect(maximum).toHaveAccessibleDescription(/Le maximum doit être un entier positif\./);
		await page.screenshot({ path: info.outputPath('zero-maximum.png'), fullPage: true });
		if (retainOtherError) {
			await title.fill('');
			await maximum.focus();
			await expect(submit).toBeEnabled();
		}
		await maximum.fill('21');
		await expect(maximum).not.toHaveAttribute('aria-invalid', 'true');
		await expect(total).toHaveText('21 pts');
		await expect(page.getByText(/^Note du module =/)).toContainText('÷ 21 × 20');
		await expect(page.getByText('Le maximum doit être un entier positif.', { exact: true })).toHaveCount(0);
		if (retainOtherError) {
			await expect(feedback).toBeVisible();
			await expect(feedback.getByRole('button')).toHaveCount(1);
			const titleError = feedback.getByRole('button', { name: /^Section · Intitulé ·/ });
			await titleError.focus();
			await page.keyboard.press('Enter');
			await expect(title).toBeFocused();
			await title.fill('Test UX — Livrable avec références et présentation détaillée');
			await maximum.focus();
		}
		await expect(feedback).toHaveCount(0);
		await expect(submit).toBeEnabled();
		await expect(
			page.getByText('Vérifiez les champs indiqués. Vos saisies sont conservées.', { exact: true })
		).toHaveCount(0);
		await expect(page.getByText(/Note du module · Poids|Invalid input|NaN|Infinity/)).toHaveCount(0);
		await page.screenshot({ path: info.outputPath('recovered-maximum.png'), fullPage: true });
		await submit.focus();
		await expect(submit).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page.getByText('Barème enregistré.', { exact: true }).first()).toBeVisible();
		await page.reload();
		await expect(maximum).toHaveValue('21');
		await expect(title).toHaveValue('Test UX — Livrable avec références et présentation détaillée');
		await expect(label).toHaveValue('Test UX — Qualité des références conservées');
		await expect(kind).toHaveValue('oral');
		await expect(group).toHaveValue('Test UX — Références');
		await maximum.focus();
		await expect(maximum).toBeFocused();
		expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
	});
}

test('three invalid maxima block saving, preserve the draft and recover against the saved baseline', async ({
	app,
	page
}, info) => {
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	const db = createDatabase(client);
	const assessmentId = crypto.randomUUID();
	const groupId = crypto.randomUUID();
	const labels = [
		'Organisation du document et sémantique HTML',
		'Mise en forme CSS et lisibilité mobile',
		'Présentation et justification des choix'
	];
	try {
		const module = await createModule(db, {
			...emptyModule(),
			title: 'Initiation au web · Test UX'
		});
		const initial = await getRubric(db, module.id);
		await replaceRubric(db, module.id, {
			expectedRevision: initial.module.revision,
			assessments: [
				{
					id: assessmentId,
					title: 'Dossier',
					kind: 'other',
					purpose: 'graded',
					groups: [{ id: groupId, title: 'Production' }],
					lines: [8, 8, 4].map((maxPoints, index) => ({
						id: crypto.randomUUID(),
						groupId,
						label: labels[index],
						description: '',
						maxPoints
					}))
				}
			],
			results: [
				{
					id: crypto.randomUUID(),
					title: 'Note finale',
					rule: { kind: 'points_ratio', assessmentIds: [assessmentId] }
				}
			],
			contexts: []
		});
		const rubric = await getRubric(db, module.id);
		await page.setViewportSize(
			info.project.name === 'desktop' ? { width: 1728, height: 851 } : { width: 375, height: 667 }
		);
		await activate(page, app);
		for (const maxPoints of [0, -1, 1.5]) {
			const response = await page.request.patch(`${app.origin}/api/teaching/modules/${module.id}/rubric`, {
				headers: { origin: app.origin },
				data: {
					expectedRevision: rubric.module.revision,
					assessments: rubric.assessments.map((assessment) => ({
						...assessment,
						lines: assessment.lines.map((line) => ({ ...line, maxPoints }))
					})),
					results: rubric.results,
					contexts: []
				}
			});
			expect(response.status()).toBe(422);
			expect((await response.json()).fields['assessments.0.lines.0.maxPoints']).toBeTruthy();
			expect(await getRubric(db, module.id)).toEqual(rubric);
		}
		await page.goto(`${app.origin}/enseignant/modules/${module.id}/bareme`);
		const save = page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).first();
		const title = page.getByLabel('Nom de la section', { exact: true });
		await expect(async () => {
			await title.fill('Dossier temporaire');
			await expect(save).toBeEnabled({ timeout: 1000 });
		}).toPass({ timeout: 60000 });
		await title.fill('Dossier');
		await expect(save).toBeDisabled();
		await page.getByLabel('Libellé du critère 2', { exact: true }).scrollIntoViewIfNeeded();
		await page.screenshot({
			path: info.outputPath('rubric-labels-before-validation.png'),
			fullPage: true
		});
		for (const index of [1, 2, 3]) {
			await page.getByLabel(`Maximum du critère ${index} (pts)`, { exact: true }).fill('0');
		}
		const firstMaximum = page.getByLabel('Maximum du critère 1 (pts)', { exact: true });
		const total = page.getByRole('status', {
			name: 'Total des maxima des lignes de Dossier',
			exact: true
		});
		await firstMaximum.press('Tab');
		await expect(firstMaximum).toHaveAttribute('aria-invalid', 'true');
		await expect(save).toBeEnabled();
		await expect(page.locator('.editor-save-bar [role="status"]')).toHaveText(
			'Corrigez les champs signalés avant d’enregistrer. Vos saisies sont conservées.'
		);
		await expect(total).toHaveText('Maximum à corriger');
		await expect(page.getByText(/NaN|Infinity/)).toHaveCount(0);
		const sectionSelect = page.getByLabel('Section du barème', { exact: true });
		if (await sectionSelect.isVisible()) {
			await expect(sectionSelect.locator('option:checked')).toHaveText(/Dossier/);
		} else {
			const sectionTitle = page
				.getByRole('tablist', { name: 'Sections du module', exact: true })
				.getByRole('tab')
				.first()
				.locator('span')
				.first();
			expect(
				await sectionTitle.evaluate((title) => {
					const range = document.createRange();
					range.selectNodeContents(title);
					return range.getClientRects().length;
				})
			).toBe(1);
		}
		for (const [index, label] of labels.entries()) {
			await expect(page.getByLabel(`Libellé du critère ${index + 1}`, { exact: true })).toHaveValue(label);
			await expect(page.getByLabel(`Maximum du critère ${index + 1} (pts)`, { exact: true })).toHaveValue('0');
		}
		expect(await getRubric(db, module.id)).toEqual(rubric);
		const error = page.getByRole('button', { name: /Dossier · Maximum · Le maximum doit/ }).first();
		await error.focus();
		await page.keyboard.press('Enter');
		await expect(firstMaximum).toBeFocused();
		await expect(firstMaximum).toHaveAccessibleDescription(/Le maximum doit être un entier positif\./);
		await page.screenshot({ path: info.outputPath('rubric-invalid-maxima.png'), fullPage: true });
		await page.getByRole('button', { name: 'Retour à la grille', exact: true }).click();
		const leaveDialog = page.getByRole('alertdialog');
		await expect(leaveDialog).toBeVisible();
		await leaveDialog.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
		await expect(firstMaximum).toHaveValue('0');
		for (const [index, value] of [8, 8, 4].entries()) {
			await page.getByLabel(`Maximum du critère ${index + 1} (pts)`, { exact: true }).fill(String(value));
		}
		await expect(firstMaximum).not.toHaveAttribute('aria-invalid', 'true');
		await expect(save).toBeDisabled();
		await expect(total).toHaveText('20 pts');
		await firstMaximum.fill('9');
		await expect(save).toBeEnabled();
		const savedResponse = page.waitForResponse(
			(response) =>
				response.request().method() === 'POST' && response.url().includes(`/modules/${module.id}/bareme?/saveRubric`)
		);
		await save.click();
		expect((await savedResponse).status()).toBe(200);
		await expect(save).toBeDisabled();
		await page.reload();
		await expect(firstMaximum).toHaveValue('9');
		const longLabel = page.getByLabel('Libellé du critère 2', { exact: true });
		await longLabel.focus();
		await expect(longLabel).toBeFocused();
		expect(await longLabel.evaluate((field) => field.scrollHeight - field.clientHeight)).toBeLessThanOrEqual(1);
		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
			await expect
				.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
				.toBe(colorScheme === 'dark');
			await page.screenshot({
				path: info.outputPath(`rubric-labels-${colorScheme}.png`),
				fullPage: true
			});
			expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
		}
	} finally {
		client.close();
	}
});
