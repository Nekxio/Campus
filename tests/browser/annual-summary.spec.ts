import { fulfillFormAction, readFormActionCommand, readFormActionReceipt } from './support/form-actions.js';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test';
import { createDatabase } from '../../src/lib/server/db/index.js';
import * as t from '../../src/lib/server/db/schema.js';
import { getAnnualData } from '../../src/lib/server/teaching/annual.js';
import type { AnnualAction, AnnualPreview, AnnualReceipt } from '../../src/lib/domain/annual.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { readPdfText } from './support/pdf.js';

const year = '2026-2027';

test('annual closure reviews and removes the complete calendar including next-year lessons', async ({ app, page }) => {
	await activate(page, app);
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	const db = createDatabase(client);
	try {
		const [teacher] = await db
			.select({ id: t.user.id })
			.from(t.user)
			.where(eq(t.user.email, 'teacher-browser@example.test'));
		const nextClass = crypto.randomUUID();
		const nextContext = crypto.randomUUID();
		await db.insert(t.classes).values({ id: nextClass, name: 'Next demo', academicYear: '2027-2028' });
		await db.insert(t.teachingContexts).values({
			id: nextContext,
			classId: nextClass,
			className: 'Next demo',
			moduleId: app.ids.module,
			academicYear: '2027-2028'
		});
		await db.insert(t.calendarSubscriptions).values({
			teacherId: teacher.id,
			generation: 'demo',
			url: 'https://school.pronote-campus.net/hp/Telechargements/ical/private-demo.ics'
		});
		for (const [index, contextId] of [app.ids.currentContext, nextContext].entries()) {
			const mappingId = crypto.randomUUID();
			const lessonId = crypto.randomUUID();
			await db
				.insert(t.calendarMappings)
				.values({ id: mappingId, teacherId: teacher.id, generation: 'demo', course: `Demo ${index}`, contextId });
			await db.insert(t.lessons).values({
				id: lessonId,
				contextId,
				title: 'Imported demo',
				startsAt: new Date('2027-10-04T08:00:00Z'),
				endsAt: new Date('2027-10-04T10:00:00Z')
			});
			await db.insert(t.calendarLessons).values({ lessonId, mappingId, eventKey: `event-${index}` });
		}
		await page.goto(`${app.origin}/enseignant/classes/annees?annee=${year}`);
		await chooseClose(page);
		await expect(consequences(page)).toContainText('2 séances importées');
		await expect(consequences(page)).toContainText('dont 1 d’une autre année');
		await prepare(page).click();
		const dialog = page.getByRole('alertdialog');
		await expect(consequences(dialog)).toContainText('toutes les années sont concernées');
		await expect(dialog).not.toContainText('private-demo.ics');
		await acknowledge(dialog);
		const response = page.waitForResponse(
			(item) => item.url().endsWith('/enseignant/classes/annees?/decideYear') && item.request().method() === 'POST'
		);
		await dialog.getByRole('button', { name: `Clôturer ${year}`, exact: true }).click();
		expect((await response).status()).toBe(200);
		await expect(dialog).toHaveCount(0);
		await expect(
			page.getByText('Calendrier effacé : 2 séances importées, toutes années confondues.', { exact: false })
		).toBeVisible();
		expect(await db.select().from(t.calendarSubscriptions)).toEqual([]);
		expect(await db.select().from(t.calendarMappings)).toEqual([]);
		expect(await db.select().from(t.calendarLessons)).toEqual([]);
		expect(await db.select().from(t.lessons).where(eq(t.lessons.contextId, nextContext))).toEqual([]);
		await noOverflow(page);
	} finally {
		client.close();
	}
});

const consequences = (scope: Page | Locator) =>
	scope.getByRole('region', { name: /^(Bilan de l’année|Conséquences de la clôture)$/ });
const prepare = (page: Page) => page.getByRole('button', { name: 'Vérifier et confirmer la clôture', exact: true });
const chooseClose = async (page: Page) => {
	const choice = page.getByRole('button', { name: 'Préparer la clôture', exact: true });
	await expect(choice).toBeEnabled();
	await choice.focus();
	await page.keyboard.press('Enter');
	await expect(consequences(page)).toBeVisible();
};

for (const failure of ['network', 'unavailable', 'lost-response'] as const) {
	test(`annual purge retries the same command after closing its dialog following ${failure}`, async ({ page, app }) => {
		await activate(page, app);
		await page.goto(`${app.origin}/enseignant/classes/annees?annee=${year}`);
		await chooseClose(page);
		await prepare(page).click();
		const dialog = page.getByRole('alertdialog');
		await acknowledge(dialog);
		const commands: AnnualAction[] = [];
		await page.route('**/enseignant/classes/annees?/decideYear', async (route) => {
			commands.push(await readFormActionCommand<AnnualAction>(route.request()));
			if (commands.length === 1 && failure === 'network') {
				await route.abort('failed');
				return;
			}
			if (commands.length === 1 && failure === 'unavailable') {
				await fulfillFormAction(route, { status: 503, message: 'Fictional temporary failure.' });
				return;
			}
			const response = await route.fetch();
			expect(response.status()).toBe(200);
			if (commands.length === 1) await route.abort('failed');
			else await route.fulfill({ response });
		});
		await dialog.getByRole('button', { name: `Clôturer ${year}`, exact: true }).click();
		await expect(dialog.getByRole('button', { name: 'Réessayer la même purge', exact: true })).toBeEnabled();
		await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		await page.getByRole('button', { name: 'Réessayer la même demande', exact: true }).click();
		await expect(page.getByText('Données étudiantes purgées', { exact: true })).toBeVisible();
		expect(commands).toHaveLength(2);
		expect(commands[1]).toEqual(commands[0]);
		const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
		try {
			const receipts = await createDatabase(client).select().from(t.annualReceipts);
			expect(receipts).toHaveLength(1);
			expect(receipts[0].requestId).toBe(commands[0].requestId);
		} finally {
			client.close();
		}
	});
}

async function beforeInReadingAndLayout(first: Locator, second: Locator) {
	const secondId = await second.evaluate((element) => {
		if (!element.id) throw new Error('The ordering assertion needs a named destination.');
		return element.id;
	});
	expect(
		await first.evaluate((element, id) => {
			const next = document.getElementById(id)!;
			return {
				reading: !!(element.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING),
				geometric: element.getBoundingClientRect().bottom <= next.getBoundingClientRect().top + 1
			};
		}, secondId)
	).toEqual({ reading: true, geometric: true });
}

async function noOverflow(page: Page, dialog?: Locator) {
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
	if (dialog)
		expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
}

async function summaryCounts(summary: Locator, preview: AnnualPreview) {
	for (const [key, label] of [
		['classes', 'classe'],
		['students', 'étudiant'],
		['corrections', 'correction'],
		['comments', 'commentaire'],
		['proposals', 'proposition']
	] as const) {
		const count = preview.removed[key];
		await expect(summary).toContainText(`${count} ${label}${count > 1 ? 's' : ''}`);
	}
	await expect(summary).toContainText(`${preview.preserved.modules} module`);
	await expect(summary).toContainText(
		`${preview.preserved.contexts} suivi${preview.preserved.contexts > 1 ? 's' : ''} de module`
	);
	await expect(summary).toContainText('Un PDF ne permet pas de restaurer les corrections détaillées.');
	await expect(summary).toContainText('Drive et les PDF déjà conservés restent en dehors de Campus.');
}

async function acknowledge(dialog: Locator) {
	await dialog.getByLabel(`Recopiez l’année ${year}`, { exact: true }).fill(year);
	await dialog.getByRole('checkbox').check();
}

async function seedSummaryStress(db: ReturnType<typeof createDatabase>, publicationModule: string) {
	const longTitle =
		'Module fictif — ressources, préparation et publication · 日本語 · ' + 'IntituléSansCoupure'.repeat(12);
	await db.update(t.modules).set({ title: longTitle }).where(eq(t.modules.id, publicationModule));
	const largeClass = crypto.randomUUID();
	await db.insert(t.classes).values({
		id: largeClass,
		name: 'Classe fictive sans module · ' + 'NomTrèsLong'.repeat(18),
		academicYear: year
	});
	await db.insert(t.students).values(
		Array.from({ length: 1000 }, (_, position) => ({
			id: crypto.randomUUID(),
			classId: largeClass,
			name: `Étudiant fictif ${position}`,
			position
		}))
	);
	await db.insert(t.academicYears).values({ academicYear: '2024-2025' });
}

async function verifyInter(page: Page, request: APIRequestContext, info: TestInfo, origin: string) {
	const inter = await page.evaluate(async () => {
		const faces = await document.fonts.load('400 14px "Inter Variable"', 'Clôturer l’année 2026-2027');
		await document.fonts.ready;
		return {
			faces: faces.map((face) => ({ family: face.family, status: face.status })),
			family: getComputedStyle(document.body).fontFamily,
			url: performance
				.getEntriesByType('resource')
				.find((entry) => new URL(entry.name).pathname.endsWith('/inter-latin-wght-normal.woff2'))?.name
		};
	});
	expect(inter.faces.length).toBeGreaterThan(0);
	for (const face of inter.faces) {
		expect(face.family).toContain('Inter Variable');
		expect(face.status).toBe('loaded');
	}
	expect(inter.family).toContain('Inter Variable');
	if (!inter.url) throw new Error('The browser did not request the installed Inter font.');
	expect(new URL(inter.url).origin).toBe(origin);
	const response = await request.get(inter.url);
	expect(response.status()).toBe(200);
	const bytes = (await response.body()).byteLength;
	expect(bytes).toBeGreaterThan(0);
	const evidence = { ...inter, httpStatus: response.status(), bytes };
	console.info('Annual Inter before captures:', JSON.stringify(evidence));
	await info.attach('annual-inter-font', {
		body: JSON.stringify(evidence),
		contentType: 'application/json'
	});
}

test('annual summary Inter geometry precedes details across widths and themes', async ({
	app,
	page,
	request
}, info) => {
	test.setTimeout(240000);
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
	await activate(page, app);
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	const db = createDatabase(client);
	try {
		await seedSummaryStress(db, app.ids.publicationModule);
		const preview = (await getAnnualData(db, app.ids.teacher, year)).selected!;
		expect(preview.removed.students).toBe(1012);
		const moduleIds = [...new Set(preview.contexts.map((context) => context.moduleId))];
		await page.goto(`${app.origin}/enseignant/classes/annees?annee=${year}`);
		await chooseClose(page);
		await expect(prepare(page)).toBeEnabled();
		await verifyInter(page, request, info, app.origin);
		await summaryCounts(consequences(page), preview);
		const measurements: {
			width: number;
			theme: string;
			students: number;
			modules: number;
			documentOverflow: number;
			dialogOverflow: number;
		}[] = [];
		for (const width of info.project.name === 'desktop' ? [1440, 1024] : [390, 320]) {
			await page.setViewportSize({ width, height: width >= 1024 ? 900 : 844 });
			for (const theme of ['light', 'dark'] as const) {
				await page.emulateMedia({ colorScheme: theme });
				await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
				await beforeInReadingAndLayout(consequences(page), page.locator('#annual-pdf-title'));
				await noOverflow(page);
				await page.evaluate(() => window.scrollTo(0, 0));
				await page.screenshot({
					path: info.outputPath(`annual-inter-${width}-${theme}.png`),
					fullPage: true
				});
				await prepare(page).focus();
				await page.keyboard.press('Enter');
				const dialog = page.getByRole('alertdialog');
				await expect(dialog).toBeVisible();
				await expect(dialog).toHaveCSS('font-family', /Inter Variable/);
				await summaryCounts(consequences(dialog), preview);
				await expect(dialog.locator('select')).toHaveCount(moduleIds.length);
				for (const moduleId of moduleIds)
					await expect(dialog.locator(`#annual-module-${moduleId}`)).toHaveValue('pause');
				await expect(dialog.getByLabel(/^Année de reprise(?: \(optionnel\))?$/)).toHaveValue('');
				await expect(
					dialog.getByText(`Réglages à vérifier : 0 à reprendre, ${moduleIds.length} à mettre de côté.`)
				).toBeVisible();
				await beforeInReadingAndLayout(consequences(dialog), dialog.locator('#annual-confirmation-details-title'));
				await noOverflow(page, dialog);
				await dialog.evaluate((element) => {
					element.scrollTop = 0;
				});
				await page.screenshot({
					path: info.outputPath(`annual-inter-dialog-${width}-${theme}.png`)
				});
				measurements.push({
					width,
					theme,
					students: preview.removed.students,
					modules: moduleIds.length,
					documentOverflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
					dialogOverflow: await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)
				});
				const cancel = dialog.getByRole('button', { name: 'Annuler', exact: true });
				await cancel.focus();
				await page.keyboard.press('Tab');
				await expect(dialog.getByRole('button', { name: `Clôturer ${year}`, exact: true })).toBeFocused();
				await page.keyboard.press('Shift+Tab');
				await expect(cancel).toBeFocused();
				await page.keyboard.press('Enter');
				await expect(dialog).not.toBeVisible();
				await expect(prepare(page)).toBeFocused();
			}
		}
		console.info('Annual Inter geometry:', JSON.stringify(measurements));
		await info.attach('annual-inter-layout-measurements', {
			body: JSON.stringify(measurements),
			contentType: 'application/json'
		});
		expect(errors).toEqual([]);
	} finally {
		client.close();
	}
});

test('annual summary retains archive, PDF, purge and empty-year lifecycle states', async ({
	app,
	page,
	request
}, info) => {
	test.setTimeout(360000);
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
	await activate(page, app);
	await app.call('complete-class');
	// Only the harness-owned, newly allocated fictional SQLite file is opened here.
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	const db = createDatabase(client);
	try {
		await seedSummaryStress(db, app.ids.publicationModule);
		const preview = (await getAnnualData(db, app.ids.teacher, year)).selected!;
		expect(preview.removed.students).toBe(1012);
		await page.goto(`${app.origin}/enseignant/classes/annees`);
		await expect(page.getByLabel('Année à consulter', { exact: true })).toHaveValue('');
		await expect(consequences(page)).toHaveCount(0);
		await expect(async () => {
			await page.getByLabel('Année à consulter', { exact: true }).selectOption(year);
			await expect(page.getByRole('button', { name: 'Préparer la clôture', exact: true })).toBeEnabled({
				timeout: 1000
			});
		}).toPass({ timeout: 60000 });
		await chooseClose(page);
		await summaryCounts(consequences(page), preview);
		const inventory = consequences(page);
		await expect(inventory).toContainText(`${preview.removed.scores} saisie`);
		await expect(inventory).toContainText(`${preview.removed.decisions} reçu`);
		await expect(inventory).toContainText(`${preview.preserved.publications} instantané`);

		const archiveResponse = page.waitForResponse(
			(response) =>
				response.url().endsWith('/enseignant/classes/annees?/decideYear') && response.request().method() === 'POST'
		);
		await page.getByRole('button', { name: 'Archiver sans supprimer', exact: true }).click();
		await page.getByRole('button', { name: `Archiver ${year}`, exact: true }).click();
		expect((await archiveResponse).status()).toBe(200);
		await expect(page.getByText('Année archivée', { exact: true })).toBeVisible();
		await expect(consequences(page)).toContainText('Aucune donnée supprimée');
		const historyToggle = page.locator(`[aria-controls="annual-history-${app.ids.currentContext}"]`);
		await historyToggle.click();
		const history = page.locator(`#annual-history-${app.ids.currentContext}`);
		await expect(history.getByText('Lecture seule', { exact: true })).toBeVisible();
		await expect(history.getByText('Aline Moreau', { exact: true })).toBeVisible();
		await expect(history.locator('input, textarea, select')).toHaveCount(0);
		const download = page.waitForEvent('download');
		await page.getByRole('button', { name: /^Télécharger le PDF Application web · démo pour/ }).click();
		const pdfPath = info.outputPath('annual-archived.pdf');
		await (await download).saveAs(pdfPath);
		expect(await readPdfText(pdfPath)).toContain('Aline Moreau');
		await page.screenshot({ path: info.outputPath('annual-archived-history.png'), fullPage: true });
		await page.getByRole('button', { name: 'Rouvrir l’année', exact: true }).click();
		await expect(page.getByText('Année active', { exact: true })).toBeVisible();
		await chooseClose(page);
		await prepare(page).click();
		const dialog = page.getByRole('alertdialog');
		await acknowledge(dialog);
		await dialog.getByRole('button', { name: `Clôturer ${year}`, exact: true }).click();
		await expect(dialog).not.toBeVisible();
		await expect(page.getByText('Données étudiantes purgées', { exact: true })).toBeVisible();
		const purged = (await getAnnualData(db, app.ids.teacher, year)).selected!;
		expect(Object.values(purged.removed)).toEqual([0, 0, 0, 0, 0, 0, 0]);
		await expect(consequences(page)).toContainText(
			`Les données étudiantes de ${year} ont été supprimées définitivement`
		);
		await expect(consequences(page)).not.toContainText('1012 étudiants');
		await expect(consequences(page)).not.toContainText('seront supprimés');
		await expect(consequences(page)).not.toContainText('Choisir le devenir');
		await expect(prepare(page)).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Rouvrir l’année', exact: true })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^Télécharger le PDF Application web · démo pour/ })).toBeDisabled();
		await historyToggle.click();
		await expect(history.getByText('Les données étudiantes ont été purgées.', { exact: false })).toBeVisible();
		await expect(history.getByText('Aline Moreau', { exact: true })).toHaveCount(0);
		await noOverflow(page);
		await page.screenshot({ path: info.outputPath('annual-purged-history.png'), fullPage: true });
		expect((await request.get(`${app.origin}/modules/${app.ids.publicationContext}`)).status()).toBe(404);
		expect((await request.get(`${app.origin}/classes/${app.ids.currentClass}`)).status()).toBe(404);
		expect((await getAnnualData(db, app.ids.teacher, '2025-2026')).selected!.removed.students).toBe(1);
		await page.getByLabel('Année à consulter', { exact: true }).selectOption('2024-2025');
		const empty = (await getAnnualData(db, app.ids.teacher, '2024-2025')).selected!;
		expect(empty.removed.students).toBe(0);
		await expect(consequences(page)).toHaveCount(0);
		await expect(prepare(page)).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Archiver sans supprimer', exact: true })).toBeDisabled();
		await noOverflow(page);
		await page.screenshot({ path: info.outputPath('annual-empty.png'), fullPage: true });
		expect(errors).toEqual([]);
	} finally {
		client.close();
	}
});

test('annual confirmation retains settings through a real conflict and retries an identical lost-response command once', async ({
	app,
	page,
	request
}, info) => {
	test.setTimeout(360000);
	await activate(page, app);
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	const db = createDatabase(client);
	try {
		const preview = (await getAnnualData(db, app.ids.teacher, year)).selected!;
		await page.goto(`${app.origin}/enseignant/classes/annees?annee=${year}`);
		await chooseClose(page);
		await prepare(page).click();
		const dialog = page.getByRole('alertdialog');
		const continued = dialog.locator(`#annual-module-${app.ids.publicationModule}`);
		const nextYear = dialog.getByLabel(/^Année de reprise(?: \(optionnel\))?$/);
		await continued.selectOption('continue');
		await expect(dialog.getByText('Réglages à vérifier : 1 à reprendre, 2 à mettre de côté.')).toBeVisible();
		await dialog.getByRole('button', { name: `Clôturer ${year}`, exact: true }).click();
		await expect(nextYear).toBeFocused();
		await expect(dialog.getByText('Choisissez explicitement l’année de reprise.', { exact: true })).toBeVisible();
		await expect(dialog.getByText('Recopiez exactement l’année choisie.', { exact: true })).toBeVisible();
		await expect(dialog.getByText('Confirmez la conservation des PDF nécessaires.', { exact: true })).toBeVisible();
		await nextYear.fill('2027-2028');
		await acknowledge(dialog);
		await app.call('conflict-correction');
		const changed = (await getAnnualData(db, app.ids.teacher, year)).selected!;
		expect(changed.removed).toEqual(preview.removed);
		expect(changed.reviewToken).not.toBe(preview.reviewToken);
		const conflictResponse = page.waitForResponse(
			(response) =>
				response.url().endsWith('/enseignant/classes/annees?/decideYear') && response.request().method() === 'POST'
		);
		await dialog.getByRole('button', { name: `Clôturer ${year}`, exact: true }).click();
		const conflict = await conflictResponse;
		expect(conflict.status()).toBe(409);
		expect((await readFormActionCommand<AnnualAction>(conflict.request())).reviewToken).toBe(preview.reviewToken);
		await expect(dialog.getByText('Le dossier doit être actualisé', { exact: true })).toBeVisible();
		await expect(dialog.getByRole('button', { name: `Clôturer ${year}`, exact: true })).toBeDisabled();
		await expect(continued).toHaveValue('continue');
		await expect(continued).toBeDisabled();
		await expect(nextYear).toHaveValue('2027-2028');
		await expect(dialog.getByLabel(`Recopiez l’année ${year}`, { exact: true })).toHaveValue(year);
		await expect(dialog.getByRole('checkbox')).toBeChecked();
		await expect(dialog.getByText('Réglages à vérifier : 1 à reprendre, 2 à mettre de côté.')).toBeVisible();
		await noOverflow(page, dialog);
		await page.screenshot({ path: info.outputPath('annual-conflict-retained.png') });
		await dialog.getByRole('button', { name: 'Actualiser le dossier', exact: true }).click();
		await expect(dialog).not.toBeVisible();
		await chooseClose(page);
		await expect(prepare(page)).toBeEnabled();
		await prepare(page).click();
		await expect(dialog.getByText('Réglages à vérifier : 0 à reprendre, 3 à mettre de côté.')).toBeVisible();
		await expect(nextYear).toHaveValue('');
		await expect(dialog.getByLabel(`Recopiez l’année ${year}`, { exact: true })).toHaveValue('');
		await expect(dialog.getByRole('checkbox')).not.toBeChecked();
		await continued.selectOption('continue');
		await nextYear.fill('2027-2028');
		await acknowledge(dialog);

		const bodies: string[] = [];
		const receipts: AnnualReceipt[] = [];
		await page.route('**/enseignant/classes/annees?/decideYear', async (route) => {
			const command = await readFormActionCommand<AnnualAction>(route.request());
			bodies.push(JSON.stringify(command));
			expect(command.requestId).toEqual(expect.any(String));
			const response = await route.fetch();
			expect(response.status()).toBe(200);
			receipts.push(await readFormActionReceipt<AnnualReceipt>(response));
			if (bodies.length === 1)
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: '{lost fictional response'
				});
			else await route.fulfill({ response });
		});
		await dialog.getByRole('button', { name: `Clôturer ${year}`, exact: true }).click();
		await expect(dialog.getByRole('button', { name: 'Réessayer la même purge', exact: true })).toBeEnabled();
		await expect(continued).toHaveValue('continue');
		await expect(nextYear).toHaveValue('2027-2028');
		const beforeRetry = await db.select().from(t.annualReceipts);
		expect(beforeRetry).toHaveLength(1);
		const newYear = (await getAnnualData(db, app.ids.teacher, '2027-2028')).selected!;
		expect(newYear.removed.students).toBe(0);
		await page.screenshot({ path: info.outputPath('annual-lost-response.png') });
		await dialog.getByRole('button', { name: 'Réessayer la même purge', exact: true }).click();
		await expect(dialog).not.toBeVisible();
		await expect(page.getByText('Données étudiantes purgées', { exact: true })).toBeVisible();
		expect(bodies).toHaveLength(2);
		expect(bodies[1]).toBe(bodies[0]);
		expect((JSON.parse(bodies[0]) as AnnualAction).reviewToken).toBe(changed.reviewToken);
		expect(receipts).toHaveLength(2);
		expect(receipts[1]).toEqual(receipts[0]);
		expect(receipts[0].removed).toEqual(changed.removed);
		expect(await db.select().from(t.annualReceipts)).toEqual(beforeRetry);
		expect((await getAnnualData(db, app.ids.teacher, '2027-2028')).selected).toEqual(newYear);
		expect((await request.get(`${app.origin}/modules/${app.ids.publicationContext}`)).ok()).toBe(true);
		expect((await request.get(`${app.origin}/classes/${app.ids.currentClass}`)).ok()).toBe(true);
		await page.goto(`${app.origin}/enseignant/classes/annees?annee=2027-2028`);
		await chooseClose(page);
		await expect(consequences(page)).toContainText('0 étudiant');
		expect(newYear.preserved.lessons).toBe(0);
		expect(newYear.preserved.deadlines).toBe(0);
		expect(newYear.removed.corrections).toBe(0);
		await noOverflow(page);
	} finally {
		client.close();
	}
});
