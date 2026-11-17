import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { returnToGradingClass, showGradingContext } from './support/grading.js';

test('module changes refresh the grid, student summary and export while ignoring a late export response', async ({
	page,
	app
}, info) => {
	await app.call('complete-class');
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/notation?module=' + app.ids.module);
	await showGradingContext(page);
	const module = page.getByRole('combobox', { name: 'Module', exact: true });
	const exportPanel = page.getByRole('region', { name: 'Export PDF du module', exact: true });
	await expect(exportPanel).toContainText('12/12 étudiants');
	await expect(async () => {
		await module.selectOption(app.ids.secondModule);
		await expect(exportPanel).toContainText('0/12 étudiants', { timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await expect(page).toHaveURL(new RegExp('module=' + app.ids.secondModule));
	await expect(exportPanel.getByRole('button', { name: 'Télécharger le PDF', exact: true })).toBeDisabled();
	const summary = page.locator('#selected-student-summary');
	if (info.project.name === 'mobile')
		await page.locator('.mobile-grid .student-row').first().getByRole('button').click();
	await expect(summary.getByRole('heading', { name: 'Projet', exact: true })).toHaveCount(0);
	await expect(summary.getByRole('link', { name: 'Ouvrir la correction détaillée' })).toHaveAttribute(
		'href',
		new RegExp(app.ids.secondContext)
	);
	await module.selectOption(app.ids.module);
	await expect(exportPanel).toContainText('12/12 étudiants');
	if (info.project.name === 'mobile')
		await page.locator('.mobile-grid .student-row').first().getByRole('button').click();
	await expect(summary.getByRole('heading', { name: 'Projet', exact: true })).toBeVisible();
	let release!: () => void;
	const held = new Promise<void>((done) => {
		release = done;
	});
	const requested: string[] = [];
	await page.route('**/api/teaching/contexts/*/export', async (route) => {
		requested.push(new URL(route.request().url()).pathname);
		await held;
		await route.fulfill({ status: 409, json: { message: 'Fictional delayed export conflict' } });
	});
	await exportPanel.getByRole('button', { name: 'Télécharger le PDF', exact: true }).click();
	await expect.poll(() => requested.length).toBe(1);
	await module.selectOption(app.ids.secondModule);
	await expect(exportPanel).toContainText('0/12 étudiants');
	const late = page.waitForResponse((response) =>
		response.url().includes('/contexts/' + app.ids.currentContext + '/export')
	);
	release();
	await (await late).finished();
	await expect(exportPanel).toContainText('0/12 étudiants');
	await expect(page.getByText('Fictional delayed export conflict', { exact: true })).toHaveCount(0);
	await expect(exportPanel).not.toContainText('Résultats à actualiser');
	expect(requested).toEqual(['/api/teaching/contexts/' + app.ids.currentContext + '/export']);
	await page.screenshot({
		path: info.outputPath('module-selection-export-updated.png'),
		fullPage: true
	});
});

test('notation selects students from names, marks, states and empty row space', async ({ page, app }, info) => {
	await app.call('complete-class');
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/notation?module=' + app.ids.module);
	const mobile = info.project.name === 'mobile';
	const rows = page.locator(mobile ? '.mobile-grid .student-row' : '.desktop-grid tbody tr');
	await expect(rows).toHaveCount(12);
	const names = await rows.getByRole('button').allTextContents();
	// A cold fixture first renders server HTML; establish that the controls are hydrated.
	await expect(async () => {
		await rows.nth(1).getByRole('button').click();
		await expect(page).toHaveURL(new RegExp('etudiant=' + app.ids.students[1]), {
			timeout: 1000
		});
	}).toPass({ timeout: 60000 });
	await returnToGradingClass(page);
	await rows.nth(0).getByRole('button').click();
	await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true');
	const writes: string[] = [];
	page.on('request', (request) => {
		if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url());
	});
	async function check(index: number) {
		await expect(page.getByRole('complementary', { name: 'Bilan de ' + names[index].trim() })).toBeVisible();
		await expect(rows.nth(index)).toHaveAttribute('data-selected', 'true');
		await expect(page).toHaveURL(new RegExp('etudiant=' + app.ids.students[index]));
	}
	async function point(index: number, area: 'mark' | 'state' | 'blank') {
		await returnToGradingClass(page);
		const row = rows.nth(index);
		const target =
			area === 'mark'
				? row.locator(mobile ? 'dd' : 'td').nth(mobile ? 0 : 1)
				: area === 'state'
					? row.locator('[data-slot="badge"]').last()
					: row;
		const options = area === 'blank' ? { position: { x: 2, y: 2 } } : {};
		if (mobile) await target.tap(options);
		else await target.click(options);
		await check(index);
	}
	await point(1, 'mark');
	await point(2, 'state');
	await point(3, 'blank');
	await returnToGradingClass(page);
	await rows.nth(4).getByRole('button').click();
	await check(4);
	await returnToGradingClass(page);
	const keyboardButton = rows.nth(0).getByRole('button');
	await keyboardButton.focus();
	await page.keyboard.press('Enter');
	await check(0);
	await point(1, 'mark');
	await page.screenshot({ path: info.outputPath('notation-row-selected.png'), fullPage: true });
	await info.attach('row-selection', {
		body: JSON.stringify({
			route: new URL(page.url()).pathname,
			moduleQuery: new URL(page.url()).searchParams.has('module'),
			targets: ['mark', 'state', 'blank', 'name', 'keyboard'],
			writes
		}),
		contentType: 'application/json'
	});
	expect(writes).toEqual([]);
	if (!mobile) {
		await expect(page.getByRole('table')).toBeVisible();
		await expect(rows.nth(1)).toHaveRole('row');
	}
});

test('three new assessments can be cancelled while saved assessments require an explicit withdrawal', async ({
	page,
	app
}, info) => {
	const uiErrors: string[] = [];
	page.on('pageerror', (error) => uiErrors.push(error.message));
	page.on('console', async (message) => {
		if (message.type() === 'error') uiErrors.push(message.text());
		if (message.type() === 'error')
			console.info(
				'Fictional rubric console:',
				await Promise.all(
					message
						.args()
						.map((argument) => argument.evaluate((value) => (value instanceof Error ? value.stack : String(value))))
				)
			);
	});
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/modules/' + app.ids.module + '/bareme');
	const tabs = page.getByRole('tablist', { name: 'Sections du module' }).getByRole('tab');
	await expect(tabs).toHaveCount(3);
	await expect(async () => {
		await tabs.nth(1).click();
		await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
	}).toPass({ timeout: 60000 });
	const originalTabs = await tabs.allTextContents();
	const writes: string[] = [];
	page.on('request', (request) => {
		if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url());
	});
	for (let index = 0; index < 3; index++) {
		await page.getByRole('button', { name: 'Ajouter une section', exact: true }).click();
		await expect(tabs).toHaveCount(4 + index);
		await expect(page.getByRole('button', { name: 'Annuler le brouillon', exact: true })).toBeVisible();
	}
	await expect(tabs.last()).toHaveAccessibleName(/\b1 pts$/);
	await page.screenshot({
		path: info.outputPath('three-drafts-cancel-action.png'),
		fullPage: true
	});
	for (let index = 0; index < 3; index++) {
		await tabs.last().click();
		const cancel = page.getByRole('button', { name: 'Annuler le brouillon', exact: true });
		await cancel.focus();
		await page.keyboard.press('Enter');
		await expect(tabs).toHaveCount(5 - index);
	}
	expect(await tabs.allTextContents()).toEqual(originalTabs);
	await tabs.first().click();
	const assessmentName = page.getByLabel('Nom de la section', { exact: true }).filter({ visible: true });
	const originalName = await assessmentName.inputValue();
	await expect(page.getByRole('button', { name: 'Retirer la section', exact: true })).toHaveText('');
	await page.getByRole('button', { name: 'Retirer la section', exact: true }).click();
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toContainText('Les points déjà enregistrés seront conservés');
	await expect(dialog).toContainText('Enregistrer le barème');
	await page.screenshot({
		path: info.outputPath('saved-assessment-withdrawal-confirmation.png'),
		fullPage: true
	});
	await dialog.getByRole('button', { name: 'Conserver la section', exact: true }).click();
	await expect(tabs).toHaveCount(3);
	await expect(assessmentName).toHaveValue(originalName);
	await page.getByRole('button', { name: 'Retirer la section', exact: true }).click();
	await dialog.getByRole('button', { name: 'Retirer du brouillon', exact: true }).click();
	await expect(tabs).toHaveCount(2);
	expect(writes).toEqual([]);
	// Discard this isolated fixture's local draft: no save has been issued.
	page.once('dialog', (confirmation) => confirmation.accept());
	await page.reload();
	await expect(tabs).toHaveCount(3);
	expect(await tabs.allTextContents()).toEqual(originalTabs);
	expect(uiErrors).toEqual([]);
	await info.attach('assessment-withdrawal', {
		body: JSON.stringify({
			draftsAddedAndCancelled: 3,
			savedAssessmentsPreserved: 3,
			defaultMaximum: 1,
			writes
		}),
		contentType: 'application/json'
	});
});
