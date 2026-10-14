import { chmod } from 'node:fs/promises';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { readPdfText } from './support/pdf.js';

test('full-class PDF includes all twelve names and results despite filtering, and blocks incomplete data', async ({
	app,
	page
}, testInfo) => {
	await activate(page, app);
	const grid =
		app.origin +
		'/enseignant/notation?module=' +
		app.ids.module +
		'&contexte=' +
		app.ids.currentContext;
	await page.goto(grid);
	const button = page.getByRole('button', { name: 'Télécharger le PDF', exact: true });
	await expect(button).toBeDisabled();
	const incomplete = await page.request.get(
		app.origin + '/api/teaching/contexts/' + app.ids.currentContext + '/export'
	);
	expect(incomplete.status()).toBe(409);
	const roster = await app.call<{ names: string[]; results: string[] }>('complete-class');
	expect(roster.names).toHaveLength(12);
	await page.reload();
	await expect(async () => {
		await page.getByLabel('Rechercher un étudiant', { exact: true }).fill(roster.names[0]);
		await expect(page.getByText(/1 \/ 12 étudiants/)).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 15000 });
	await expect(button).toBeEnabled();
	const downloaded = page.waitForEvent('download');
	await button.click();
	const download = await downloaded;
	const path = testInfo.outputPath('result.pdf');
	await download.saveAs(path);
	await chmod(path, 0o600);
	const text = await readPdfText(path);
	for (const name of roster.names) expect(text).toContain(name);
	for (const title of roster.results) expect(text).toContain(title);
	expect(text).toContain('Noé Petit');
	expect(text).not.toMatch(
		/PRIVATE_BROWSER_COMMENT_MARKER|private-submission-marker|Navigation|Authentification/
	);
});
