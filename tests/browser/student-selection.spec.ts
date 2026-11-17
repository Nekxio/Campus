import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { returnToGradingClass, setGradingFilters } from './support/grading.js';

test('one activation keeps the student row, summary, PDF and correction destination together', async ({
	page,
	app
}, info) => {
	await app.call('complete-class');
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/notation?module=' + app.ids.module);
	const mobile = info.project.name === 'mobile';
	const rows = page.locator(mobile ? '.mobile-grid .student-row' : '.desktop-grid tbody tr');
	const summary = page.locator('#selected-student-summary');
	const names = (await rows.getByRole('button').allTextContents()).map((name) => name.trim());
	// The class export stays visible in the overview and enables after hydration.
	await expect(page.getByRole('button', { name: 'Télécharger le PDF', exact: true })).toBeEnabled();
	if (mobile) await rows.first().getByRole('button').tap();
	await expect(
		page.getByRole('button', { name: 'Télécharger le PDF individuel de Aline Moreau', exact: true })
	).toBeEnabled();
	await expect(summary).toHaveAccessibleName('Bilan de Aline Moreau');
	const writes: string[] = [];
	page.on('request', (request) => {
		if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url());
	});
	await returnToGradingClass(page);
	// Read the shared values from the persistent controls while mobile detail hides the filters.
	const search = page.locator('#grading-search');
	const filter = page.locator('#grading-filter');
	await setGradingFilters(page, { search: ' ', filter: 'complete' });
	async function check(index: number) {
		await expect(page).toHaveURL(new RegExp('etudiant=' + app.ids.students[index]));
		await expect(summary).toHaveAccessibleName('Bilan de ' + names[index]);
		await expect(rows.nth(index)).toHaveAttribute('data-selected', 'true');
		await expect(rows.locator('[aria-pressed="true"]')).toHaveCount(1);
		await expect(rows.nth(index).getByRole('button', { includeHidden: true })).toHaveAttribute('aria-pressed', 'true');
		await expect(
			summary.getByRole('button', {
				name: 'Télécharger le PDF individuel de ' + names[index],
				exact: true
			})
		).toBeEnabled();
		await expect(summary.getByRole('link', { name: 'Ouvrir la correction détaillée', exact: true })).toHaveAttribute(
			'href',
			'/enseignant/notation/' + app.ids.currentContext + '/' + app.ids.students[index]
		);
		await expect(search).toHaveValue(' ');
		await expect(filter).toHaveValue('complete');
		if (mobile) await expect(summary).toBeFocused();
	}
	const name = rows.nth(1).getByRole('button');
	if (mobile) await name.tap();
	else await name.click();
	await expect(page).toHaveURL(new RegExp('etudiant=' + app.ids.students[1]));
	await page.screenshot({ path: info.outputPath('single-activation.png'), animations: 'disabled' });
	await info.attach('single-activation-identity', {
		body: JSON.stringify({
			expectedStudent: names[1],
			url: page.url(),
			summary: await summary.getAttribute('aria-label'),
			correction: await summary.getByRole('link', { name: 'Ouvrir la correction détaillée' }).getAttribute('href')
		}),
		contentType: 'application/json'
	});
	await check(1);
	await summary.screenshot({
		path: info.outputPath('confirmed-student-summary.png'),
		animations: 'disabled'
	});
	for (const [index, area] of [
		[2, 'mark'],
		[3, 'state'],
		[4, 'blank']
	] as const) {
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
	await returnToGradingClass(page);
	await rows.nth(0).getByRole('button').focus();
	await page.keyboard.press('Enter');
	await check(0);
	await summary.getByRole('link', { name: 'Ouvrir la correction détaillée' }).click();
	await expect(page).toHaveURL(
		app.origin + '/enseignant/notation/' + app.ids.currentContext + '/' + app.ids.students[0]
	);
	await expect(page.getByRole('heading', { name: 'Aline Moreau', exact: true })).toBeVisible();
	expect(writes).toEqual([]);
});

test('an old individual PDF response cannot replace the newly selected student or poison a return', async ({
	page,
	app
}, info) => {
	await app.call('complete-class');
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/notation?module=' + app.ids.module);
	const summary = page.locator('#selected-student-summary');
	const mobile = info.project.name === 'mobile';
	const rows = page.locator(mobile ? '.mobile-grid .student-row' : '.desktop-grid tbody tr');
	const names = (await rows.getByRole('button').allTextContents()).map((name) => name.trim());
	const pdf = (name: string) =>
		summary.getByRole('button', {
			name: 'Télécharger le PDF individuel de ' + name,
			exact: true
		});
	await expect(page.getByRole('button', { name: 'Télécharger le PDF', exact: true })).toBeEnabled();
	if (mobile) await rows.first().getByRole('button').tap();
	await expect(pdf(names[0])).toBeEnabled();
	let release!: () => void;
	const held = new Promise<void>((done) => {
		release = done;
	});
	const requested: string[] = [];
	let delivered = false;
	await page.route('**/api/teaching/contexts/*/students/*/export', async (route) => {
		requested.push(new URL(route.request().url()).pathname);
		await held;
		await route.fulfill({ status: 409, json: { message: 'OLD_STUDENT_PDF_RESPONSE' } });
		delivered = true;
	});
	await pdf(names[0]).click();
	await expect.poll(() => requested.length).toBe(1);
	for (const index of [1, 2, 0]) {
		await returnToGradingClass(page);
		const button = rows.nth(index).getByRole('button');
		if (mobile) await button.tap();
		else await button.click();
		await expect(summary).toHaveAccessibleName('Bilan de ' + names[index]);
		await expect(pdf(names[index])).toBeEnabled();
	}
	release();
	await expect.poll(() => delivered).toBe(true);
	await expect(summary).toHaveAccessibleName('Bilan de ' + names[0]);
	await expect(pdf(names[0])).toBeEnabled();
	await expect(page.getByText('OLD_STUDENT_PDF_RESPONSE', { exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Actualiser les résultats', exact: true })).toHaveCount(0);
	await returnToGradingClass(page);
	const next = rows.nth(1).getByRole('button');
	if (mobile) await next.tap();
	else await next.click();
	await expect(summary).toHaveAccessibleName('Bilan de ' + names[1]);
	await pdf(names[1]).click();
	await expect.poll(() => requested.length).toBe(2);
	expect(requested).toEqual([
		'/api/teaching/contexts/' + app.ids.currentContext + '/students/' + app.ids.students[0] + '/export',
		'/api/teaching/contexts/' + app.ids.currentContext + '/students/' + app.ids.students[1] + '/export'
	]);
	await info.attach('ignored-old-student-export', {
		body: JSON.stringify({ requested, delivered, selectedStudent: names[1] }),
		contentType: 'application/json'
	});
});
