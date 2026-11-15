import { chmod } from 'node:fs/promises';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { readPdfText } from './support/pdf.js';
import { setGradingFilters, showGradingContext } from './support/grading.js';

test('full-class PDF includes all twelve names and results despite filtering, and blocks incomplete data', async ({
	app,
	page
}, testInfo) => {
	await activate(page, app);
	const grid = app.origin + '/enseignant/notation?module=' + app.ids.module + '&contexte=' + app.ids.currentContext;
	await page.goto(grid);
	const exportPanel = page.getByRole('region', { name: 'Export PDF du module', exact: true });
	await exportPanel.locator('summary').click();
	const button = page.getByRole('button', { name: 'Télécharger le PDF', exact: true });
	await expect(button).toBeDisabled();
	const incomplete = await page.request.get(
		app.origin + '/api/teaching/contexts/' + app.ids.currentContext + '/export'
	);
	expect(incomplete.status()).toBe(409);
	const roster = await app.call<{ names: string[]; results: string[] }>('complete-class');
	expect(roster.names).toHaveLength(12);
	await page.reload();
	await expect(button).toBeEnabled();
	await showGradingContext(page);
	const module = page.getByRole('combobox', { name: 'Module', exact: true });
	const contextBounds = await module.boundingBox();
	const exportBounds = await exportPanel.boundingBox();
	expect(contextBounds!.y + contextBounds!.height).toBeLessThanOrEqual(exportBounds!.y);
	await setGradingFilters(page, { search: roster.names[0], filter: 'complete' });
	await expect(page.getByRole('status').filter({ hasText: /1 \/ 12 étudiants/ })).toBeVisible();
	const filterBounds = await page
		.getByRole(testInfo.project.name === 'mobile' ? 'button' : 'searchbox', {
			name: testInfo.project.name === 'mobile' ? 'Filtrer les étudiants' : 'Rechercher un étudiant',
			exact: true
		})
		.boundingBox();
	const filteredExportBounds = await exportPanel.boundingBox();
	expect(filteredExportBounds!.y + filteredExportBounds!.height).toBeLessThanOrEqual(filterBounds!.y);
	await expect(exportPanel).toContainText('12/12 étudiants');
	await expect(exportPanel).toContainText('Toute la classe, même avec une recherche ou un filtre.');
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
	expect(text).not.toMatch(/PRIVATE_BROWSER_COMMENT_MARKER|private-submission-marker|Navigation|Authentification/);
});
