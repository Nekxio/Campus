import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

async function selectProject(page: import('@playwright/test').Page) {
	await expect(async () => {
		await page.getByLabel('Évaluation', { exact: true }).selectOption({ label: 'Projet' });
		await expect(page.getByRole('button', { name: 'Enregistrer Projet', exact: true })).toBeVisible(
			{ timeout: 1000 }
		);
	}).toPass({ timeout: 15000 });
}

test('correction preserves blank versus zero and retains points on a real HTTP 409', async ({
	app,
	page
}) => {
	await activate(page, app);
	await page.goto(
		app.origin + '/enseignant/notation/' + app.ids.currentContext + '/' + app.ids.students[0]
	);
	await selectProject(page);
	const points = page.getByLabel('Navigation', { exact: true });
	await points.fill('');
	await expect(points).toHaveValue('');
	await page.getByLabel('Statut de l’évaluation', { exact: true }).selectOption('to_evaluate');
	const blank = page.waitForResponse(
		(response) =>
			response.url().includes('/assessments/' + app.ids.project) &&
			response.request().method() === 'PATCH'
	);
	await page.getByRole('button', { name: 'Enregistrer Projet', exact: true }).click();
	expect((await blank).status()).toBe(200);
	await page.reload();
	await selectProject(page);
	await expect(points).toHaveValue('');
	await points.fill('0');
	const zero = page.waitForResponse(
		(response) =>
			response.url().includes('/assessments/' + app.ids.project) &&
			response.request().method() === 'PATCH'
	);
	await page.getByRole('button', { name: 'Enregistrer Projet', exact: true }).click();
	expect((await zero).status()).toBe(200);
	await page.reload();
	await selectProject(page);
	await expect(points).toHaveValue('0');
	await points.fill('3');
	await app.call('conflict-correction');
	const conflict = page.waitForResponse(
		(response) =>
			response.url().includes('/assessments/' + app.ids.project) && response.status() === 409
	);
	await page.getByRole('button', { name: 'Enregistrer Projet', exact: true }).click();
	await conflict;
	await expect(page.getByText('Version à actualiser', { exact: true })).toBeVisible();
	await expect(points).toHaveValue('3');
});
