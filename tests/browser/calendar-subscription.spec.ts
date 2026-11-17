import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../../src/lib/server/db/index.js';
import * as tables from '../../src/lib/server/db/schema.js';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';
import { fulfillFormAction, readFormActionCommand } from './support/form-actions.js';
import type { CalendarCommand } from '../../src/lib/domain/calendar-subscription.js';
import type { CalendarSettings } from '../../src/lib/domain/calendar-subscription.js';

test('calendar connection previews explicit mappings, preserves choices on failure and disconnects safely', async ({
	page,
	app
}, info) => {
	await activate(page, app);
	await page.clock.setFixedTime(new Date('2026-11-12T12:00:00Z'));
	const contextId = '11111111-1111-4111-8111-111111111111';
	const lessonId = '22222222-2222-4222-8222-222222222222';
	const startsAt = '2026-11-04T08:00:00.000Z';
	const endsAt = '2026-11-04T10:00:00.000Z';
	const state: CalendarSettings = {
		connection: {
			active: false,
			revision: 1,
			lastSuccess: null,
			lastAttempt: null,
			error: '',
			previewAt: '2026-10-31T08:00:00.000Z',
			mappings: [],
			events: [
				{
					key: 'event-1',
					course: 'Web et intégration — groupe de démonstration',
					title: 'Cours Web',
					startsAt,
					endsAt,
					cancelled: false
				}
			]
		},
		contexts: [
			{
				id: contextId,
				label: 'Initiation au web · B2 Démo',
				academicYear: '2026-2027',
				lessons: [{ id: lessonId, title: 'Séance préparée', startsAt, endsAt }]
			},
			{
				id: '33333333-3333-4333-8333-333333333333',
				label: 'Initiation au web · B2 Démo · 2025-2026',
				academicYear: '2025-2026',
				lessons: []
			},
			{
				id: '44444444-4444-4444-8444-444444444444',
				label: 'Initiation au web · B2 Démo · 2027-2028',
				academicYear: '2027-2028',
				lessons: []
			}
		],
		issues: []
	};
	let failConnection = true;
	let previewRequests = 0;
	let connectionRequests = 0;
	let releaseConnection!: () => void;
	const connectionResponse = new Promise<void>((resolve) => {
		releaseConnection = resolve;
	});
	await page.route('**/enseignant/applications?/calendarCommand', async (route) => {
		const command = await readFormActionCommand<CalendarCommand>(route.request());
		if (command.action === 'sync') return fulfillFormAction(route, { receipt: { ...state, connection: null } });
		if (command.action === 'preview') {
			if (command.url.startsWith('http:'))
				return fulfillFormAction(route, {
					status: 422,
					message: 'Renseignez le lien HTTPS privé fourni par Pronote Campus.'
				});
			previewRequests++;
			if (previewRequests === 1)
				return fulfillFormAction(route, {
					status: 422,
					message:
						'Pronote Campus a refusé le téléchargement (HTTP 403). Recopiez le lien d’abonnement complet depuis l’école. Aucune séance n’a été modifiée.'
				});
			return fulfillFormAction(route, { receipt: state });
		}
		if (command.action === 'connect') {
			connectionRequests++;
			expect(command.mappings).toEqual([
				{
					course: state.connection!.events[0].course,
					contextId,
					adoptions: [{ key: 'event-1', lessonId }]
				}
			]);
			if (failConnection)
				return fulfillFormAction(route, {
					status: 409,
					message: 'Le planning a changé. Vérifiez vos choix.'
				});
			await connectionResponse;
			state.connection!.active = true;
			state.connection!.revision = 2;
			state.connection!.mappings = [{ course: state.connection!.events[0].course, contextId }];
			return fulfillFormAction(route, { receipt: state });
		}
		state.connection!.active = false;
		state.connection!.revision = 3;
		return fulfillFormAction(route, { receipt: state });
	});
	await page.goto(app.origin + '/enseignant/applications');
	await expect(page.getByRole('heading', { name: 'Calendrier de l’école', exact: true })).toBeVisible();
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
	const urlField = page.getByLabel('Lien d’abonnement iCalendar');
	await page.getByRole('button', { name: 'Examiner le calendrier' }).click();
	await expect(urlField).toHaveAttribute('aria-invalid', 'true');
	await expect(urlField).toBeFocused();
	await expect(
		page
			.locator('[data-sonner-toast][data-type="error"]')
			.filter({ hasText: 'Vérifiez le lien d’abonnement iCalendar.' })
	).toBeVisible();
	expect(previewRequests).toBe(0);
	await urlField.fill('http://example.test/demo.ics');
	await page.getByRole('button', { name: 'Examiner le calendrier' }).click();
	await expect(urlField).toHaveAttribute('aria-invalid', 'true');
	await expect(urlField).toHaveAttribute('aria-describedby', /.+/);
	await expect(urlField).toHaveValue('http://example.test/demo.ics');
	await expect(
		page.getByText('Renseignez le lien HTTPS privé fourni par Pronote Campus.', { exact: true })
	).toHaveCount(1);
	await expect(urlField).toBeFocused();
	await urlField.fill('https://school.pronote-campus.net/hp/Telechargements/ical/demo.ics?icalsecurise=fictional');
	await page.getByRole('button', { name: 'Examiner le calendrier' }).click();
	await expect(urlField).toHaveAttribute('aria-invalid', 'true');
	const downloadError = page.getByText(
		'Pronote Campus a refusé le téléchargement (HTTP 403). Recopiez le lien d’abonnement complet depuis l’école. Aucune séance n’a été modifiée.',
		{ exact: true }
	);
	await expect(downloadError).toHaveCount(2);
	await expect(urlField).toBeFocused();
	await expect(urlField).toHaveValue(
		'https://school.pronote-campus.net/hp/Telechargements/ical/demo.ics?icalsecurise=fictional'
	);
	const descriptionIds = (await urlField.getAttribute('aria-describedby'))!.split(' ');
	await expect
		.poll(async () =>
			(await Promise.all(descriptionIds.map((id) => page.locator(`[id="${id}"]`).innerText()))).join(' ')
		)
		.toContain('HTTP 403');
	for (const width of [1728, 375]) {
		await page.setViewportSize({ width, height: 851 });
		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme });
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
			await page.screenshot({
				path: info.outputPath(`calendar-error-${width}-${colorScheme}.png`),
				fullPage: true
			});
		}
	}
	await page.getByRole('button', { name: 'Examiner le calendrier' }).click();
	await expect.poll(() => previewRequests).toBe(2);
	await expect(urlField).not.toHaveAttribute('aria-invalid', 'true');
	const mapping = page.getByLabel('Module Campus pour Web et intégration — groupe de démonstration');
	await expect(mapping).toHaveValue('');
	await expect(mapping.locator('option')).toHaveText(['Ne pas importer ce cours', 'Initiation au web · B2 Démo']);
	const connectionButtons = page.getByRole('button', { name: 'Connecter les cours sélectionnés', exact: true });
	await expect(connectionButtons).toHaveCount(2);
	await connectionButtons.first().click();
	await expect(mapping).toBeFocused();
	await expect(mapping).toHaveAttribute('aria-invalid', 'true');
	await mapping.selectOption(contextId);
	const adoption = page.getByLabel('Séance existante pour Cours Web');
	await expect(adoption).toHaveValue('');
	await connectionButtons.last().click();
	await expect(adoption).toBeFocused();
	await expect(adoption).toHaveAttribute('aria-invalid', 'true');
	await expect(adoption).toHaveAttribute('aria-required', 'true');
	await adoption.selectOption(lessonId);
	for (const width of [1728, 375]) {
		await page.setViewportSize({ width, height: 851 });
		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme });
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
			await page.screenshot({
				path: info.outputPath(`calendar-preview-${width}-${colorScheme}.png`),
				fullPage: true
			});
		}
	}
	await connectionButtons.first().click();
	await expect(page.getByRole('alert')).toContainText('Le planning a changé. Vérifiez vos choix.');
	await expect(mapping).toHaveValue(contextId);
	await expect(adoption).toHaveValue(lessonId);
	failConnection = false;
	try {
		await connectionButtons.last().click();
		const pendingButtons = page.getByRole('button', { name: 'Connexion en cours…', exact: true });
		await expect(pendingButtons).toHaveCount(2);
		await expect(pendingButtons.first()).toBeDisabled();
		await expect(pendingButtons.last()).toBeDisabled();
		await expect.poll(() => connectionRequests).toBe(2);
	} finally {
		releaseConnection();
	}
	await expect(page.getByText('Synchronisation active', { exact: true })).toBeVisible();
	await expect(page.getByLabel('Lien d’abonnement iCalendar')).toHaveCount(0);
	await expect(page.getByText('icalsecurise=fictional')).toHaveCount(0);
	for (const width of [1728, 375]) {
		await page.setViewportSize({ width, height: 851 });
		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme });
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
			await page.screenshot({
				path: info.outputPath(`calendar-${width}-${colorScheme}.png`),
				fullPage: true
			});
		}
	}
	await page.getByRole('button', { name: 'Déconnecter le calendrier', exact: true }).click();
	await expect(page.getByText('Les séances et leur préparation resteront dans Campus.', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Garder la connexion' })).toBeFocused();
	await page.getByRole('button', { name: 'Confirmer la déconnexion' }).click();
	await expect(page.getByText('Synchronisation arrêtée', { exact: true })).toBeVisible();
});

test('imported lesson planning protects school times and saves preparation through the real API', async ({
	page,
	app
}, info) => {
	await activate(page, app);
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	const db = createDatabase(client);
	const moduleId = crypto.randomUUID();
	const contextId = crypto.randomUUID();
	const lessonId = crypto.randomUUID();
	const mappingId = crypto.randomUUID();
	const generation = crypto.randomUUID();
	const title = 'Intégration web et accessibilité — séance de démonstration avec un intitulé particulièrement long';
	const startsAt = new Date('2026-11-04T08:00:00.000Z');
	const endsAt = new Date('2026-11-04T10:00:00.000Z');
	try {
		const [teacher] = await db
			.select({ id: tables.user.id })
			.from(tables.user)
			.where(eq(tables.user.email, 'teacher-browser@example.test'));
		const [annualClass] = await db.select().from(tables.classes).where(eq(tables.classes.id, app.ids.currentClass));
		await db.insert(tables.modules).values({ id: moduleId, title: 'Test calendrier — Préparation conservée' });
		await db.insert(tables.teachingContexts).values({
			id: contextId,
			moduleId,
			classId: annualClass.id,
			className: annualClass.name,
			academicYear: annualClass.academicYear
		});
		await db.insert(tables.calendarSubscriptions).values({
			teacherId: teacher.id,
			generation,
			url: 'https://school.pronote-campus.net/hp/Telechargements/ical/fictional.ics',
			active: false
		});
		await db.insert(tables.calendarMappings).values({
			id: mappingId,
			teacherId: teacher.id,
			generation,
			course: 'Intégration web',
			contextId,
			active: false
		});
		await db.insert(tables.lessons).values({
			id: lessonId,
			contextId,
			title,
			startsAt,
			endsAt,
			recap: 'Préparation initiale conservée',
			toDo: 'Consignes initiales conservées'
		});
		await db
			.insert(tables.calendarLessons)
			.values({ lessonId, mappingId, eventKey: 'fictional-occurrence', status: 'disconnected' });
		await page.goto(`${app.origin}/enseignant/modules/${moduleId}?section=planning&contexte=${contextId}`);
		await readyModuleEditor(page);
		const section = page.getByLabel('Section du module', { exact: true });
		if (await section.isVisible()) await section.selectOption('planning');
		else await page.getByRole('tab', { name: 'Classe et planning', exact: false }).click();
		const lessonTitle = page.getByLabel('Intitulé de la séance', { exact: true });
		const starts = page.getByLabel('Début', { exact: true });
		const ends = page.getByLabel('Fin', { exact: true });
		const recap = page.getByLabel('Récapitulatif (optionnel)', { exact: true });
		const toDo = page.getByLabel('À faire (optionnel)', { exact: true });
		await expect(lessonTitle).toHaveValue(title);
		for (const input of [lessonTitle, starts, ends]) await expect(input).toHaveJSProperty('readOnly', true);
		await expect(page.getByRole('button', { name: `Retirer ${title}`, exact: true })).toHaveCount(0);
		await expect(page.getByText('Synchronisation déconnectée', { exact: true })).toBeVisible();
		await expect(recap).toBeEditable();
		await expect(toDo).toBeEditable();
		await recap.fill('Préparation modifiée après import, sans toucher aux horaires.');
		await toDo.fill('Consignes modifiées et conservées dans Campus.');
		await expect(page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first()).toBeEnabled();
		await page.getByRole('link', { name: 'Gérer l’abonnement dans Applications' }).click();
		await expect(page.getByRole('alertdialog', { name: 'Quitter le module ?' })).toBeVisible();
		await page.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
		await expect(page.locator('[data-slot="alert-dialog-overlay"]')).toHaveCount(0);
		await expect(recap).toHaveValue('Préparation modifiée après import, sans toucher aux horaires.');
		for (const width of [1728, 375]) {
			await page.setViewportSize({ width, height: 851 });
			for (const colorScheme of ['light', 'dark'] as const) {
				await page.emulateMedia({ colorScheme });
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
				await recap.focus();
				await expect(recap).toBeFocused();
				await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
				await page.screenshot({
					animations: 'disabled',
					path: info.outputPath(`calendar-planning-${width}-${colorScheme}.png`),
					fullPage: true
				});
			}
		}
		const save = page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first();
		await expect(save).toBeEnabled();
		await save.click();
		await expect
			.poll(async () => (await db.select().from(tables.lessons).where(eq(tables.lessons.id, lessonId)))[0]?.recap)
			.toBe('Préparation modifiée après import, sans toucher aux horaires.');
		const [saved] = await db.select().from(tables.lessons).where(eq(tables.lessons.id, lessonId));
		expect(saved).toMatchObject({
			title,
			startsAt,
			endsAt,
			toDo: 'Consignes modifiées et conservées dans Campus.'
		});
		await expect(save).toBeDisabled();
		await page.reload();
		await expect(recap).toHaveValue(saved.recap);
		await expect(toDo).toHaveValue(saved.toDo);
		await expect(lessonTitle).toHaveValue(title);
		await expect(lessonTitle).toHaveJSProperty('readOnly', true);
		const publicPage = await page.context().newPage();
		const publicCalendarRequests: string[] = [];
		publicPage.on('request', (request) => {
			if (new URL(request.url()).pathname === '/api/teaching/calendar') publicCalendarRequests.push(request.method());
		});
		try {
			await publicPage.goto(`${app.origin}/modules/${app.ids.publicationContext}`);
			await expect(
				publicPage.getByRole('heading', { name: 'Application web · publication démo', exact: true })
			).toBeVisible();
			const openInstructions = async () => {
				await expect(async () => {
					const compactTrigger = publicPage.getByRole('button', { name: /^Changer de rubrique :/ });
					if (await compactTrigger.isVisible()) {
						const sections = publicPage.getByRole('dialog', {
							name: 'Contenu du cours',
							exact: true
						});
						if (!(await sections.isVisible())) await compactTrigger.click();
						await expect(sections).toBeVisible({ timeout: 1000 });
						await sections.getByRole('button', { name: 'Consignes et barèmes', exact: true }).click();
						await expect(publicPage.getByRole('heading', { name: 'Consignes et barèmes', exact: true })).toBeVisible({
							timeout: 1000
						});
					} else {
						const instructions = publicPage.getByRole('tab', {
							name: 'Consignes et barèmes',
							exact: true
						});
						await instructions.click();
						await expect(instructions).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
					}
				}).toPass({ timeout: 60000 });
			};
			await openInstructions();
			await publicPage.reload();
			await openInstructions();
			expect(publicCalendarRequests).toEqual([]);
		} finally {
			await publicPage.close();
		}
	} finally {
		client.close();
	}
});
