import { createClient } from '@libsql/client';
import { pathToFileURL } from 'node:url';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { fulfillFormAction } from './support/form-actions.js';

const profileAction = '**/enseignant/compte?/updateProfile';

test('review fixes retain newer profile edits and explain resolved grading decisions', async ({ page, app }, info) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/compte');
	await expect(page.locator('#profile-form')).toHaveAttribute('data-enhanced', 'true');
	const name = page.getByRole('textbox', { name: 'Nom et prénom' });
	const save = page.getByRole('button', { name: 'Enregistrer', exact: true });
	await expect(save).toBeDisabled();
	for (const success of [true, false]) {
		let release!: () => void;
		const held = new Promise<void>((done) => {
			release = done;
		});
		let requested = false;
		await page.route(profileAction, async (route) => {
			const response = success ? await route.fetch() : null;
			requested = true;
			await held;
			if (response) await route.fulfill({ response });
			else await fulfillFormAction(route, { status: 503, message: 'Erreur fictive retardée' });
		});
		await name.fill(success ? 'Nom enregistré fictif' : 'Nom non enregistré');
		await save.focus();
		await page.keyboard.press('Enter');
		await expect.poll(() => requested).toBe(true);
		await name.fill('Saisie plus récente conservée');
		release();
		await expect(save).toBeEnabled();
		await expect(name).toHaveValue('Saisie plus récente conservée');
		if (!success) await expect(page.getByRole('alert')).toContainText('Erreur fictive retardée');
		await page.getByRole('button', { name: 'Annuler', exact: true }).click();
		await expect(name).toHaveValue('Nom enregistré fictif');
		await page.unroute(profileAction);
	}
	await page.screenshot({ path: info.outputPath('profile-retained-edit.png'), fullPage: true });

	// The harness owns this newly created fictional SQLite file and removes it after the test.
	const db = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		await db.execute({
			sql: "UPDATE correction SET lateness_decision = 'refused' WHERE context_id = ? AND student_id = ? AND assessment_id = ?",
			args: [app.ids.currentContext, app.ids.students[0], app.ids.project]
		});
		await page.goto(`${app.origin}/enseignant/notation?module=${app.ids.module}&etudiant=${app.ids.students[0]}`);
		const project = page
			.locator('#selected-student-summary')
			.getByRole('heading', { name: 'Projet', exact: true })
			.locator('..')
			.locator('..');
		await expect(project).toContainText('Production refusée');
		await expect(project).toContainText('0,0 /20');
		await expect(project).not.toContainText('Évaluation à compléter');
		await page.screenshot({ path: info.outputPath('resolved-refusal.png'), fullPage: true });
		const dates = await db.execute({
			sql: 'SELECT due_at FROM assessment_deadline WHERE context_id = ? AND assessment_id = ?',
			args: [app.ids.currentContext, app.ids.project]
		});
		const submittedAt = Number(dates.rows[0].due_at) + 6 * 86400000;
		await db.execute({
			sql: "UPDATE correction SET lateness_decision = 'automatic', submitted_at = ? WHERE context_id = ? AND student_id = ? AND assessment_id = ?",
			args: [submittedAt, app.ids.currentContext, app.ids.students[0], app.ids.project]
		});
		await db.execute({
			sql: 'UPDATE result_definition SET rule = ? WHERE module_id = ?',
			args: [JSON.stringify({ kind: 'points_ratio', assessmentIds: [app.ids.quiz] }), app.ids.module]
		});
		await page.goto(`${app.origin}/enseignant/propositions?proposition=${app.ids.proposals[0]}`);
		await expect(page.getByText(/Retard du projet : 6 jours · au-delà de cinq jours, projet à zéro/)).toBeVisible();
		await expect(page.getByText(/Sections Quiz normalisées sur 20 puis moyennées à poids égal/)).toBeVisible();
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await page.screenshot({
			path: info.outputPath('proposal-delay-and-quiz-rule.png'),
			fullPage: true
		});
		expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
	} finally {
		db.close();
	}
});
