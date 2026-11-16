import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';

test('home and module library have distinct destinations and preserve legacy module links', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(`${app.origin}/?mois=2026-10`);
	await expect(page.getByRole('heading', { name: 'Mon atelier', exact: true })).toBeVisible();
	await expect(page.getByLabel('Rechercher un module', { exact: true })).toHaveCount(0);
	await expect(page.getByRole('navigation', { name: 'Continuer le travail' })).toHaveCount(0);
	expect(new URL(page.url()).searchParams.get('mois')).toBe('2026-10');
	await page.goto(`${app.origin}/#modules`);
	await expect(page).toHaveURL(`${app.origin}/enseignant/modules`);
	await expect(page.getByRole('heading', { level: 1, name: 'Mes modules', exact: true })).toBeVisible();
	const search = page.getByLabel('Rechercher un module', { exact: true });
	await search.fill('No matching fictional module');
	await expect(page.getByText('Aucun module trouvé', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Réinitialiser la recherche', exact: true }).click();
	const row = page.locator('.module-entry').first();
	for (const name of ['Préparer', 'Barème', 'Publication']) {
		await expect(row.getByRole('link', { name, exact: true })).toBeVisible();
	}
});

test('module mobile navigation keeps scope, closes on selection and protects an unsaved draft', async ({
	page,
	app
}) => {
	await activate(page, app);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.module}?contexte=${app.ids.currentContext}&section=information`
	);
	await readyModuleEditor(page);
	await expect(page.getByRole('navigation', { name: 'Fil d’Ariane du module' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Retour au module', exact: true })).toHaveCount(0);
	const trigger = page.getByRole('button', { name: 'Changer de page du module', exact: true });
	await trigger.click();
	const sheet = page.getByRole('dialog', { name: 'Pages du module', exact: true });
	await expect(sheet.getByRole('link')).toHaveText(['Préparer', 'Quiz', 'Barème', 'Notation', 'Publication']);
	await page.keyboard.press('Escape');
	await expect(trigger).toBeFocused();
	await page.getByLabel('Nom du module', { exact: true }).fill('Unsaved navigation draft');
	await trigger.click();
	await sheet.getByRole('link', { name: 'Quiz', exact: true }).click();
	const confirmation = page.getByRole('alertdialog');
	await expect(confirmation).toBeVisible();
	await confirmation.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(trigger).toBeFocused();
	await expect(page.getByLabel('Nom du module', { exact: true })).toHaveValue('Unsaved navigation draft');
	await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first().click();
	await expect(page.getByText('Toutes les modifications sont enregistrées.', { exact: true })).toBeVisible();
	await trigger.click();
	await sheet.getByRole('link', { name: 'Quiz', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/quiz\\?.*contexte=${app.ids.currentContext}`));
	await expect(sheet).toHaveCount(0);
	await expect(trigger).toContainText('Quiz');
});

test('proposal navigation distinguishes the global queue from the current module', async ({ page, app }) => {
	await activate(page, app);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`${app.origin}/enseignant/notation?module=${app.ids.module}&contexte=${app.ids.currentContext}`);
	const navigation = page.getByRole('navigation', { name: 'Navigation principale', exact: true });
	const proposals = navigation.getByRole('link', { name: 'Propositions', exact: true });
	await expect(proposals).toHaveAttribute('href', '/enseignant/propositions');
	await expect(proposals.locator('xpath=ancestor::ul[1]')).toHaveAttribute('data-slot', 'sidebar-menu-sub');
	await expect(page.getByRole('link', { name: 'Propositions de ce module', exact: true })).toHaveAttribute(
		'href',
		`/enseignant/propositions?contexte=${app.ids.currentContext}`
	);
	await proposals.click();
	await expect(page).toHaveURL(`${app.origin}/enseignant/propositions`);
	await expect(proposals).toHaveAttribute('aria-current', 'page');
});

test('published pages keep the class directory and lead to the shared module library', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/vue-etudiante`);
	await expect(page.getByRole('list', { name: 'Classes avec des pages publiées', exact: true })).toBeVisible();
	await expect(page.getByRole('list', { name: 'Modules à préparer', exact: true })).toHaveCount(0);
	await page.getByRole('link', { name: 'Choisir un module à publier', exact: true }).click();
	await expect(page).toHaveURL(`${app.origin}/enseignant/modules`);
	await expect(
		page.locator('.module-entry').first().getByRole('link', { name: 'Publication', exact: true })
	).toBeVisible();
});
