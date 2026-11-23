import { readFormActionCommand, fulfillFormAction } from './support/form-actions.js';
import type { Page } from '@playwright/test';
import type { QuizArchive, QuizDraft, QuizDraftWrite } from '../../src/lib/domain/quiz-content.js';
import type { NativeQuizFixture } from '../../src/lib/server/db/testing/quiz-fixtures.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

const readyWorkspace = async (page: Page) => {
	const mobile = (page.viewportSize()?.width ?? 1440) < 768;
	await expect(async () => {
		await page
			.getByRole('button', {
				name: mobile ? 'Ouvrir la navigation' : 'Choisir le thème',
				exact: true
			})
			.click();
		await expect(
			mobile
				? page
						.getByRole('navigation', { name: 'Navigation principale', exact: true })
						.getByRole('link', { name: 'Notation', exact: true })
				: page.getByRole('menuitemradio', { name: 'Thème système', exact: true })
		).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await page.keyboard.press('Escape');
	if (mobile) await expect(page.locator('[data-slot="sheet-overlay"]')).toHaveCount(0);
};

test.beforeEach(async ({ page }, info) => {
	page.on('pageerror', (error) => {
		void info.attach('teacher-quiz-client-error', { body: error.stack ?? error.message });
	});
});

test('quiz actions align across draft, open and archived rows', async ({ app, page }, info) => {
	await activate(page, app);
	const draft = await app.call<NativeQuizFixture>('native-quiz');
	await app.call<NativeQuizFixture>('native-quiz-ui');
	await page.goto(`${app.origin}/enseignant/modules/${draft.moduleId}/quiz?contexte=${draft.contextId}`);
	await readyWorkspace(page);
	const quiz = page.getByRole('button', { name: `Modifier ${draft.content.title}`, exact: true });
	const room = page.getByRole('button', { name: `Consulter ${draft.content.title}`, exact: true });
	const opening = page.getByRole('button', { name: 'Ouvrir une salle', exact: true });
	const managing = page.getByRole('link', { name: 'Piloter la salle', exact: true });
	const library = page.getByRole('table', { name: /Quiz de/ });
	const draftRow = library.getByRole('row').filter({ has: opening });
	const openRow = library.getByRole('row').filter({ has: managing });
	const archive = { name: `Archiver ${draft.content.title}`, exact: true };
	const left = () => quiz.evaluate((button) => button.getBoundingClientRect().left);
	const draftLeft = await left();
	const roomLeft = await room.evaluate((button) => button.getBoundingClientRect().left);
	expect(Math.abs(draftLeft - roomLeft)).toBeLessThan(1);
	const archiveLeft = await draftRow
		.getByRole('button', archive)
		.evaluate((button) => button.getBoundingClientRect().left);
	expect(
		Math.abs(
			archiveLeft -
				(await openRow.getByRole('button', archive).evaluate((button) => button.getBoundingClientRect().left))
		)
	).toBeLessThan(1);
	expect(Math.abs((await opening.boundingBox())!.x - (await managing.boundingBox())!.x)).toBeLessThan(1);
	await page.screenshot({ path: info.outputPath('quiz-actions.png'), fullPage: true });
	await draftRow.getByRole('button', archive).click();
	const restore = page.getByRole('button', { name: `Restaurer ${draft.content.title}`, exact: true });
	await expect(restore).toBeEnabled();
	const archivedRow = library.getByRole('row').filter({ has: restore });
	expect((await archivedRow.getByRole('button', { name: /^Consulter / }).boundingBox())!.x).toBeCloseTo(draftLeft, 0);
	expect((await restore.boundingBox())!.x).toBeCloseTo(archiveLeft, 0);
	if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 844 });
	expect(await library.evaluate((table) => table.parentElement!.scrollWidth <= table.parentElement!.clientWidth)).toBe(
		true
	);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the teacher archives and restores a quiz with one retryable decision and keeps its history accessible', async ({
	app,
	page,
	request
}) => {
	await activate(page, app);
	const fixture = await app.call<NativeQuizFixture>('native-quiz');
	await page.goto(`${app.origin}/enseignant/modules/${fixture.moduleId}/quiz?contexte=${fixture.contextId}`);
	await readyWorkspace(page);
	const commands: QuizArchive[] = [];
	await page.route(`${app.origin}/enseignant/modules/${fixture.moduleId}/quiz?/setArchive`, async (route) => {
		commands.push(await readFormActionCommand<QuizArchive>(route.request()));
		if (commands.length !== 1) return route.continue();
		const response = await route.fetch();
		expect(response.status()).toBe(200);
		await route.abort('failed');
	});
	const row = page.getByRole('row').filter({ hasText: fixture.content.title });
	await row.getByRole('button', { name: `Archiver ${fixture.content.title}`, exact: true }).click();
	await row.getByRole('button', { name: /Réessayer l’archivage/ }).click();
	await expect(row.getByText('Archivé', { exact: true }).filter({ visible: true })).toBeVisible();
	await expect(row.getByRole('button', { name: 'Ouvrir une salle' })).toHaveCount(0);
	await expect(row.getByRole('button', { name: `Consulter ${fixture.content.title}`, exact: true })).toBeEnabled();
	expect(commands[1]).toEqual(commands[0]);
	const publicUrl = `${app.origin}/api/quizzes/${fixture.contextId}`;
	expect(await (await request.get(publicUrl)).json()).not.toContainEqual(
		expect.objectContaining({ id: fixture.quizId })
	);
	await row.getByRole('button', { name: `Restaurer ${fixture.content.title}`, exact: true }).click();
	await expect(row.getByRole('button', { name: 'Ouvrir une salle' })).toBeEnabled();
	expect(await (await request.get(publicUrl)).json()).toContainEqual(expect.objectContaining({ id: fixture.quizId }));
});

test('an editor keeps pending changes until reloading a quiz archived in another tab', async ({
	app,
	page,
	context
}) => {
	await activate(page, app);
	const fixture = await app.call<NativeQuizFixture>('native-quiz');
	const workspace = `${app.origin}/enseignant/modules/${fixture.moduleId}/quiz?contexte=${fixture.contextId}`;
	await page.goto(workspace);
	await readyWorkspace(page);
	await page.getByRole('button', { name: `Modifier ${fixture.content.title}`, exact: true }).click();
	await page.getByRole('button', { name: 'Paramètres', exact: true }).click();
	const settings = page.getByRole('dialog', { name: 'Paramètres du quiz', exact: true });
	await settings.getByLabel('Titre du quiz', { exact: true }).fill('Saisie en cours');
	await page.keyboard.press('Escape');
	const library = await context.newPage();
	await library.goto(workspace);
	await readyWorkspace(library);
	const row = library.getByRole('row').filter({ hasText: fixture.content.title });
	await row.getByRole('button', { name: `Archiver ${fixture.content.title}`, exact: true }).click();
	await expect(row.getByText('Archivé', { exact: true }).filter({ visible: true })).toBeVisible();
	await library.close();
	await page.getByRole('button', { name: 'Enregistrer le quiz', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Saisie en cours', exact: true })).toBeVisible();
	const reload = { name: 'Recharger la version enregistrée', exact: true };
	await page.getByRole('button', reload).click();
	await page.getByRole('alertdialog').getByRole('button', reload).click();
	await expect(page.getByRole('heading', { name: fixture.content.title, exact: true })).toBeVisible();
	await expect(page.getByText('Quiz archivé', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Enregistrer le quiz', exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Consulter la question 1', exact: true })).toBeEnabled();
});

test('teacher quiz editor preserves later edits, retries the exact save and keeps a conflict draft', async ({
	app,
	page,
	context
}, info) => {
	page.setDefaultTimeout(20000);
	await activate(page, app);
	const fixture = await app.call<NativeQuizFixture>('native-quiz');
	await page.goto(`${app.origin}/enseignant/modules/${fixture.moduleId}/quiz?contexte=${fixture.contextId}`);
	await expect(page.getByRole('heading', { name: 'Quiz', exact: true })).toBeVisible();
	await readyWorkspace(page);
	const editQuiz = page.getByRole('button', {
		name: `Modifier ${fixture.content.title}`,
		exact: true
	});
	await expect(editQuiz).toHaveText('');
	await expect(page.getByRole('button', { name: 'Ouvrir une salle', exact: true })).toHaveText('Ouvrir une salle');
	await editQuiz.hover();
	await expect(page.getByRole('tooltip', { name: 'Modifier' })).toBeVisible();
	await editQuiz.click();
	await page.getByRole('button', { name: 'Paramètres', exact: true }).click();
	const sheet = page.getByRole('dialog', { name: 'Paramètres du quiz', exact: true });
	const title = sheet.getByLabel('Titre du quiz', { exact: true });
	const duration = sheet.getByLabel('Durée du quiz', { exact: true });
	await expect(duration).toHaveValue('10:00');
	await sheet.getByRole('button', { name: 'Ajouter 30 secondes', exact: true }).click();
	await expect(duration).toHaveValue('10:30');
	await sheet.getByRole('button', { name: 'Retirer 30 secondes', exact: true }).click();
	await expect(duration).toHaveValue('10:00');
	await duration.fill('0:30');
	await expect(sheet.getByRole('button', { name: 'Retirer 30 secondes', exact: true })).toBeDisabled();
	await duration.fill('240:00');
	await expect(sheet.getByRole('button', { name: 'Ajouter 30 secondes', exact: true })).toBeDisabled();
	await duration.fill('1:15');
	await sheet.getByRole('button', { name: 'Enregistrer le quiz', exact: true }).click();
	await expect(
		sheet.getByText('Choisissez une durée de 0:30 à 240:00, par pas de 30 secondes.', { exact: true })
	).toBeVisible();
	await duration.fill('1:30');
	await expect(duration).not.toHaveAttribute('aria-invalid', 'true');
	await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
	await title.fill('Quiz enregistré après coupure');
	const commands: QuizDraftWrite[] = [];
	let lost = false;
	let conflict = false;
	await page.route(`${app.origin}/enseignant/modules/${fixture.moduleId}/quiz?/saveQuiz`, async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		commands.push(await readFormActionCommand<QuizDraftWrite>(route.request()));
		if (conflict) return fulfillFormAction(route, { status: 409, message: 'Version modifiée dans une autre fenêtre.' });
		if (lost) return route.continue();
		lost = true;
		const response = await route.fetch();
		expect(response.status()).toBe(200);
		await route.abort('failed');
	});
	await sheet.getByRole('button', { name: 'Enregistrer le quiz', exact: true }).click();
	await expect.poll(() => commands.length).toBe(1);
	await expect(sheet.getByRole('button', { name: 'Réessayer l’enregistrement', exact: true })).toBeEnabled();
	await title.fill('Modification suivante conservée');
	await sheet.getByRole('button', { name: 'Réessayer l’enregistrement', exact: true }).click();
	await expect.poll(() => commands.length).toBe(2);
	expect(commands[0].content.durationSeconds).toBe(90);
	expect(commands[1]).toEqual(commands[0]);
	await expect(title).toHaveValue('Modification suivante conservée');
	const saved = (await (
		await context.request.get(`${app.origin}/api/teaching/quizzes/${fixture.quizId}`)
	).json()) as QuizDraft;
	expect(saved.content.title).toBe('Quiz enregistré après coupure');
	await sheet.getByRole('button', { name: 'Enregistrer le quiz', exact: true }).click();
	await expect.poll(() => commands.length).toBe(3);
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
	await expect(page.getByRole('heading', { name: 'Modification suivante conservée', exact: true })).toBeVisible();
	await expect(page.getByRole('status').filter({ hasText: 'Enregistré' })).toBeVisible();
	await page
		.locator('[data-sonner-toast]')
		.filter({ hasText: 'Quiz enregistré' })
		.getByRole('button', { name: 'Fermer la notification', exact: true })
		.click();
	await page.getByRole('button', { name: 'Modifier la question 1', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Question 1', exact: true })).toBeVisible();
	await expect(page.getByLabel('Extrait de code (optionnel)', { exact: true })).toHaveValue(
		fixture.content.questions[0].code
	);
	await page.getByLabel('Extrait de code (optionnel)', { exact: true }).scrollIntoViewIfNeeded();
	await page.keyboard.press('Escape');
	conflict = true;
	await page.getByRole('button', { name: 'Paramètres', exact: true }).click();
	await title.fill('Saisie à conserver après conflit');
	await duration.fill('2:00');
	await sheet.getByRole('button', { name: 'Enregistrer le quiz', exact: true }).click();
	await expect.poll(() => commands.length).toBe(4);
	await expect(title).toHaveValue('Saisie à conserver après conflit');
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden();
	await expect(
		page.getByRole('alert').getByText('Version modifiée dans une autre fenêtre.', { exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Recharger la version enregistrée', exact: true }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Saisie à conserver après conflit', exact: true })).toBeVisible();
	await expect(page.getByRole('alertdialog')).toBeHidden();
	if (info.project.name === 'mobile') {
		await page.evaluate(async () => {
			if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
			window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
			await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
		});
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
		await expect
			.poll(() => page.locator('.teacher-header').evaluate((element) => element.getBoundingClientRect().top))
			.toBe(0);
		await expect(
			page.getByRole('alert').getByText('Version modifiée dans une autre fenêtre.', { exact: true })
		).toBeInViewport({ ratio: 1 });
		expect(
			await page.locator('.skip-link').evaluate((element) => element.getBoundingClientRect().bottom)
		).toBeLessThanOrEqual(0);
	}
	await page.getByRole('button', { name: 'Recharger la version enregistrée', exact: true }).click();
	await page
		.getByRole('alertdialog')
		.getByRole('button', { name: 'Recharger la version enregistrée', exact: true })
		.click();
	await expect(page.getByRole('alertdialog')).toBeHidden();
	await expect(page.getByRole('heading', { name: 'Modification suivante conservée', exact: true })).toBeVisible();
	await expect(
		page.getByRole('alert').getByText('Version modifiée dans une autre fenêtre.', { exact: true })
	).toHaveCount(0);
	await page.getByRole('button', { name: 'Paramètres', exact: true }).click();
	await expect(duration).toHaveValue('1:30');
	await page.keyboard.press('Escape');
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('an empty quiz library gives one next step instead of a duplicate creation command', async ({ app, page }) => {
	await activate(page, app);
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.publicationModule}/quiz?contexte=${app.ids.publicationContext}`
	);
	await readyWorkspace(page);
	await expect(page.getByText('Préparer le premier quiz', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Créer un quiz', exact: true })).toHaveCount(0);
	await expect(
		page
			.getByRole('button', { name: 'Créer le premier quiz', exact: true })
			.or(page.getByRole('link', { name: 'Créer une ligne dans le barème', exact: true }))
	).toHaveCount(1);
});

test('teacher opens and operates a real durable room through authenticated HTTP while the roster updates live', async ({
	app,
	page,
	context
}, info) => {
	page.setDefaultTimeout(20000);
	await activate(page, app);
	const fixture = await app.call<NativeQuizFixture>('native-quiz');
	await page.goto(`${app.origin}/enseignant/modules/${fixture.moduleId}/quiz?contexte=${fixture.contextId}`);
	await readyWorkspace(page);
	if (info.project.name === 'mobile') {
		const entry = page.getByRole('row').filter({ hasText: fixture.content.title });
		await expect(entry.getByRole('button', { name: `Modifier ${fixture.content.title}`, exact: true })).toBeInViewport({
			ratio: 1
		});
		await expect(entry.getByRole('button', { name: 'Ouvrir une salle', exact: true })).toBeInViewport({
			ratio: 1
		});
		expect(
			await page
				.locator('[data-slot="table-container"]')
				.evaluate((element) => element.scrollWidth <= element.clientWidth)
		).toBe(true);
	}
	const opening = page.waitForResponse(
		(response) =>
			response.url().endsWith(`/enseignant/modules/${fixture.moduleId}/quiz?/openRoom`) &&
			response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Ouvrir une salle', exact: true }).click();
	const opened = await opening;
	expect(opened.status(), await opened.text()).toBe(200);
	await expect(page).toHaveURL(new RegExp(`/enseignant/quiz/[a-f0-9-]{36}$`));
	await expect(page.getByRole('heading', { name: `Quiz : ${fixture.content.title}`, exact: true })).toBeVisible();
	const runId = new URL(page.url()).pathname.split('/').at(-1)!;
	const roomUrl = `${app.origin}/api/quizzes/${fixture.contextId}/rooms/${runId}`;
	const admission = {
		headers: { Origin: app.origin },
		data: { participantId: fixture.roster[0].id, fullscreenConfirmed: true }
	};
	const prepared = await context.request.put(roomUrl, admission);
	expect(prepared.status()).toBe(200);
	const joined = await context.request.post(roomUrl, admission);
	expect(joined.status()).toBe(200);
	await expect(
		page.getByRole('row').filter({ hasText: fixture.roster[0].name }).getByText('Prêt', { exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Démarrer le quiz', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Clôturer le quiz', exact: true })).toBeEnabled();
	await expect(
		page.getByRole('row').filter({ hasText: fixture.roster[0].name }).getByText('En cours', { exact: true })
	).toBeVisible();
	await page
		.locator('[data-sonner-toast]')
		.filter({ hasText: 'Décision enregistrée.' })
		.getByRole('button', { name: 'Fermer la notification', exact: true })
		.click();
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.getByRole('button', { name: `Voir le détail de ${fixture.roster[0].name}`, exact: true }).click();
	const detail = page.getByRole('dialog', { name: fixture.roster[0].name, exact: true });
	await expect(detail).toBeVisible();
	await expect(detail).toHaveAttribute('aria-modal', info.project.name === 'desktop' ? 'false' : 'true');
	await expect(page.locator('[data-slot="sheet-overlay"]')).toHaveCount(info.project.name === 'desktop' ? 0 : 1);
	if (info.project.name === 'desktop') {
		const toolbar = page.getByRole('region', {
			name: 'Contexte et commandes du quiz',
			exact: true
		});
		await expect(toolbar).toBeInViewport({ ratio: 1 });
		await expect(toolbar.getByLabel('Temps restant maximal', { exact: true })).toBeInViewport({
			ratio: 1
		});
		await expect(toolbar.getByRole('button', { name: 'Clôturer le quiz', exact: true })).toBeInViewport({ ratio: 1 });
		await page.getByRole('button', { name: 'Clôturer le quiz', exact: true }).click();
		await expect(page.getByRole('alertdialog')).toBeVisible();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Annuler', exact: true }).click();
		await expect(page.getByRole('alertdialog')).toBeHidden();
		await expect(detail).toBeVisible();
		const inspectorBounds = await detail.boundingBox();
		const toolbarBounds = await toolbar.boundingBox();
		expect(inspectorBounds!.y).toBeGreaterThanOrEqual(toolbarBounds!.y + toolbarBounds!.height);
		expect(inspectorBounds!.width).toBeLessThanOrEqual(400);
		expect((await page.getByRole('table').boundingBox())!.y).toBeLessThan(200);
	}
	await detail.getByLabel('Temps supplémentaire', { exact: true }).fill('120');
	await detail.getByRole('button', { name: 'Ajouter du temps', exact: true }).click();
	await expect(
		detail.getByText('En secondes. À ajouter : 2 min. Déjà accordé : 2 min.', { exact: true })
	).toBeVisible();
	await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
	await page.evaluate(() => window.scrollTo(0, 0));
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	if (info.project.name === 'desktop') {
		const rosterPosition = await page.getByRole('table').boundingBox();
		const nextStudent = page.getByRole('button', {
			name: `Sélectionner ${fixture.roster[1].name}`,
			exact: true
		});
		await nextStudent.click();
		await expect(page.getByRole('dialog', { name: fixture.roster[1].name, exact: true })).toBeVisible();
		expect(await page.getByRole('table').boundingBox()).toEqual(rosterPosition);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toBeHidden();
		await expect(nextStudent).toBeFocused();
	} else {
		await page.keyboard.press('Escape');
		await expect(detail).toBeHidden();
		await expect(
			page.getByRole('button', { name: `Voir le détail de ${fixture.roster[0].name}`, exact: true })
		).toBeFocused();
	}
	await page.getByRole('button', { name: 'Clôturer le quiz', exact: true }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Confirmer', exact: true }).click();
	await expect(page.getByRole('alertdialog')).toBeHidden();
	await expect(page.getByText('Quiz clôturé', { exact: true }).filter({ visible: true })).toBeVisible();
	await expect(page.getByRole('status', { name: 'Bilan du quiz', exact: true })).toHaveText(
		'1 copie terminée · 11 absents'
	);
	await expect(page.getByText(/12 terminés sur 12|En direct/)).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Vérifier les notes', exact: true })).toBeVisible();
	await page.getByRole('button', { name: `Voir le détail de ${fixture.roster[0].name}`, exact: true }).click();
	const closedDetail = page.getByRole('dialog', { name: fixture.roster[0].name, exact: true });
	await expect(closedDetail.getByText('Temps restant', { exact: true }).locator('..').locator('dd')).toHaveText(
		'Clôturé'
	);
	await page.keyboard.press('Escape');
	await expect(closedDetail).toBeHidden();
	await page.getByRole('button', { name: 'Fermer la notification', exact: true }).click();
	await page.evaluate(() => window.scrollTo(0, 0));
	const added = await context.request.post(`${app.origin}/api/teaching/classes/${app.ids.currentClass}/students`, {
		headers: { Origin: app.origin },
		data: { kind: 'import', source: 'Maël\nNew student left out', expectedRevision: 1 }
	});
	expect(added.status(), await added.text()).toBe(200);
	const candidatesUrl = `${app.origin}/api/teaching/quiz-rooms/${runId}/candidates`;
	await page.route(candidatesUrl, (route) => route.fulfill({ status: 503, body: 'Unavailable' }), { times: 1 });
	await page.goto(`${app.origin}/enseignant/modules/${fixture.moduleId}/quiz?contexte=${fixture.contextId}`);
	const reopen = page.getByRole('link', { name: 'Ouvrir une salle', exact: true });
	const results = page.getByRole('link', { name: `Voir les résultats de ${fixture.content.title}`, exact: true });
	await expect(reopen).toBeVisible();
	await expect(results).toHaveText('');
	await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
	await results.click();
	await expect(page.getByRole('dialog', { name: 'Nouvelle salle', exact: true })).toHaveCount(0);
	await page.goto(`${app.origin}/enseignant/modules/${fixture.moduleId}/quiz?contexte=${fixture.contextId}`);
	await reopen.click();
	const retake = page.getByRole('dialog', { name: 'Nouvelle salle', exact: true });
	await expect(retake.getByRole('alert')).toContainText('La liste des étudiants est indisponible. Réessayez.');
	await expect(retake.getByRole('button', { name: 'Créer la salle', exact: true })).toBeDisabled();
	await retake.getByRole('button', { name: 'Réessayer', exact: true }).click();
	await expect(retake.getByRole('group', { name: 'Sans note · 2', exact: true })).toBeVisible();
	await expect(retake.getByRole('checkbox', { name: fixture.roster[0].name, exact: true })).toHaveCount(0);
	await retake.getByRole('checkbox', { name: 'Maël', exact: true }).check();
	await retake.getByRole('checkbox', { name: fixture.roster[1].name, exact: true }).check();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await retake.getByRole('button', { name: 'Créer la salle', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/enseignant/quiz/(?!${runId})[a-f0-9-]{36}$`));
	await expect(page.getByRole('table').getByText(fixture.roster[1].name, { exact: true })).toBeVisible();
	await expect(page.getByRole('table').getByText(fixture.roster[0].name, { exact: true })).toHaveCount(0);
	await expect(page.getByRole('table').getByText('Maël', { exact: true })).toBeVisible();
	await expect(page.getByRole('table').getByText('New student left out', { exact: true })).toHaveCount(0);
	await page.getByRole('link', { name: 'Quiz du module', exact: true }).click();
	await page.getByRole('button', { name: `Consulter ${fixture.content.title}`, exact: true }).click();
	await expect(page.getByText('Cette version est figée', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Enregistrer le quiz', exact: true })).toHaveCount(0);
});
