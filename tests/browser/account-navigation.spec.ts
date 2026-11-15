import type { CalendarCommand, CalendarSettings } from '../../src/lib/domain/calendar-subscription.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { fulfillFormAction, readFormActionCommand } from './support/form-actions.js';

test('account views retain their navigation through links, history and direct access', async ({ page, app }, info) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/compte');
	await expect(page.locator('#profile-form')).toHaveAttribute('data-enhanced', 'true');
	const navigation = page.getByRole('navigation', { name: 'Sections du compte', exact: true });
	const information = navigation.getByRole('link', { name: 'Informations et accès', exact: true });
	const applications = navigation.getByRole('link', { name: 'Applications connectées', exact: true });
	await expect(information).toHaveAttribute('aria-current', 'page');
	const persistentNavigation = await navigation.elementHandle();
	await applications.click();
	await expect(page).toHaveURL(app.origin + '/enseignant/applications');
	await expect(page.getByRole('heading', { name: 'Compte', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Applications connectées', exact: true })).toBeVisible();
	await expect(applications).toHaveAttribute('aria-current', 'page');
	expect(await persistentNavigation!.evaluate((element) => element.isConnected)).toBe(true);
	await expect(page.getByRole('textbox', { name: 'Nom et prénom', exact: true })).toHaveCount(0);
	await page.goBack();
	await expect(information).toHaveAttribute('aria-current', 'page');
	await expect(page.getByRole('textbox', { name: 'Nom et prénom', exact: true })).toBeVisible();
	await page.goForward();
	await expect(applications).toHaveAttribute('aria-current', 'page');
	await page.goto(app.origin + '/enseignant/applications');
	await expect(applications).toHaveAttribute('aria-current', 'page');
	await expect(page).toHaveTitle('Applications connectées · Campus');
	for (const colorScheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme });
		for (const width of [1440, 768, 390, 320]) {
			await page.setViewportSize({ width, height: 900 });
			await expect(information).toBeVisible();
			await expect(applications).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
			await page.screenshot({ path: info.outputPath(`applications-${width}-${colorScheme}.png`), fullPage: true });
		}
	}
});

test('profile changes stay intact until leaving is explicitly confirmed', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/compte');
	await expect(page.locator('#profile-form')).toHaveAttribute('data-enhanced', 'true');
	const name = page.getByRole('textbox', { name: 'Nom et prénom', exact: true });
	const applications = page
		.getByRole('navigation', { name: 'Sections du compte', exact: true })
		.getByRole('link', { name: 'Applications connectées', exact: true });
	let writes = 0;
	page.on('request', (request) => {
		if (request.method() === 'POST' && request.url().endsWith('/enseignant/compte?/updateProfile')) writes++;
	});
	await name.fill('Nom en cours de saisie');
	await applications.click();
	const confirmation = page.getByRole('alertdialog', { name: 'Quitter les informations du compte ?', exact: true });
	await expect(confirmation).toBeVisible();
	await confirmation.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(confirmation).toHaveCount(0);
	await expect(name).toHaveValue('Nom en cours de saisie');
	await expect(applications).toBeFocused();
	await expect(page).toHaveURL(app.origin + '/enseignant/compte');
	await applications.click();
	await confirmation.getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click();
	await expect(page).toHaveURL(app.origin + '/enseignant/applications');
	await page.goBack();
	await expect(name).toHaveValue('Teacher Browser Demo');
	expect(writes).toBe(0);
});

test('confirming a browser return preserves the account history order', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/applications');
	await expect(page.locator('#calendar-form')).toHaveAttribute('data-enhanced', 'true');
	await page
		.getByRole('navigation', { name: 'Sections du compte', exact: true })
		.getByRole('link', { name: 'Informations et accès', exact: true })
		.click();
	const name = page.getByRole('textbox', { name: 'Nom et prénom', exact: true });
	await name.fill('Brouillon avant retour');
	await page.evaluate(() => window.history.back());
	const confirmation = page.getByRole('alertdialog', { name: 'Quitter les informations du compte ?', exact: true });
	await expect(confirmation).toBeVisible();
	await confirmation.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(page).toHaveURL(app.origin + '/enseignant/compte');
	await expect(name).toHaveValue('Brouillon avant retour');
	await page.evaluate(() => window.history.back());
	await confirmation.getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click();
	await expect(page).toHaveURL(app.origin + '/enseignant/applications');
	await expect(page.getByRole('heading', { name: 'Applications connectées', exact: true })).toBeVisible();
	await expect(name).toHaveCount(0);
	await page.goForward();
	await expect(page).toHaveURL(app.origin + '/enseignant/compte');
	await expect(name).toHaveValue('Teacher Browser Demo');
	await page.goBack();
	await expect(page).toHaveURL(app.origin + '/enseignant/applications');
});

test('calendar URL and mapping drafts are protected when changing account views', async ({ page, app }) => {
	await activate(page, app);
	await page.clock.setFixedTime(new Date('2026-11-12T12:00:00Z'));
	const contextId = '11111111-1111-4111-8111-111111111111';
	const settings: CalendarSettings = {
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
					course: 'Cours de démonstration',
					title: 'Séance de démonstration',
					startsAt: '2026-11-04T08:00:00.000Z',
					endsAt: '2026-11-04T10:00:00.000Z',
					cancelled: false
				}
			]
		},
		contexts: [
			{
				id: contextId,
				label: 'Module de démonstration · Classe Démo',
				academicYear: '2026-2027',
				lessons: []
			}
		],
		issues: []
	};
	await page.route('**/enseignant/applications?/calendarCommand', async (route) => {
		const command = await readFormActionCommand<CalendarCommand>(route.request());
		expect(command.action).toBe('preview');
		await fulfillFormAction(route, { receipt: settings });
	});
	await page.goto(app.origin + '/enseignant/applications');
	const url = page.getByRole('textbox', { name: 'Lien d’abonnement iCalendar', exact: true });
	await expect(page.locator('#calendar-form')).toHaveAttribute('data-enhanced', 'true');
	const information = page
		.getByRole('navigation', { name: 'Sections du compte', exact: true })
		.getByRole('link', { name: 'Informations et accès', exact: true });
	const confirmation = page.getByRole('alertdialog', { name: 'Quitter la configuration du calendrier ?', exact: true });
	await url.fill('https://calendar.example.test/fictional.ics');
	await information.click();
	await expect(confirmation).toBeVisible();
	await confirmation.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(url).toHaveValue('https://calendar.example.test/fictional.ics');
	await page.getByRole('button', { name: 'Examiner le calendrier', exact: true }).click();
	const mapping = page.getByRole('combobox', {
		name: 'Module Campus pour Cours de démonstration (optionnel)',
		exact: true
	});
	await mapping.selectOption(contextId);
	await information.click();
	await expect(confirmation).toBeVisible();
	await confirmation.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(mapping).toHaveValue(contextId);
	await mapping.selectOption('');
	await information.click();
	await expect(page).toHaveURL(app.origin + '/enseignant/compte');
	await expect(confirmation).toHaveCount(0);
});
