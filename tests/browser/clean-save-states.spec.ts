import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { fulfillFormAction } from './support/form-actions.js';

const openClassDialog = async (page: Page, label: 'Nouvelle classe' | 'Modifier la classe') => {
	const dialog = page.getByRole('dialog', { name: label, exact: true });
	await expect(async () => {
		await page.getByRole('button', { name: label, exact: true }).click();
		await expect(dialog).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	return dialog;
};

test('profile save reflects edits, reverts and a decoded successful response', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/compte');
	const name = page.getByRole('textbox', { name: 'Nom et prénom', exact: true });
	const save = page.getByRole('button', { name: 'Enregistrer', exact: true });
	await expect(page.getByRole('button', { name: 'Annuler', exact: true })).toBeEnabled();
	const initial = await name.inputValue();
	await expect(save).toBeDisabled();
	await name.fill('Nom de profil fictif');
	await expect(save).toBeEnabled();
	await name.fill(initial);
	await expect(save).toBeDisabled();
	await name.fill('Nom de profil fictif');
	await save.click();
	await expect(page.getByText('Votre nom a été enregistré.', { exact: true })).toBeVisible();
	await expect(save).toBeDisabled();
	await name.fill('Autre saisie fictive');
	await expect(save).toBeEnabled();
	await page.getByRole('button', { name: 'Annuler', exact: true }).click();
	await expect(name).toHaveValue('Nom de profil fictif');
	await expect(save).toBeDisabled();
});

test('profile can reassert the original name after an edited in-flight save loses its response', async ({
	page,
	app
}) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/compte');
	const name = page.getByRole('textbox', { name: 'Nom et prénom', exact: true });
	const save = page.getByRole('button', { name: 'Enregistrer', exact: true });
	await expect(page.getByRole('button', { name: 'Annuler', exact: true })).toBeEnabled();
	const initial = await name.inputValue();
	let releaseResponse = () => {};
	const responseGate = new Promise<void>((resolve) => {
		releaseResponse = resolve;
	});
	let persisted = false;
	const endpoint = '**/api/enseignant/compte';
	await page.route(endpoint, async (route) => {
		const response = await route.fetch();
		expect(response.status()).toBe(200);
		persisted = true;
		await responseGate;
		await route.abort('failed');
	});
	await name.fill('Nom fictif dont la réponse sera perdue');
	await save.click();
	await expect.poll(() => persisted).toBe(true);
	await expect(page.getByRole('button', { name: 'Enregistrement…', exact: true })).toBeDisabled();
	await name.fill(initial);
	releaseResponse();
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(name).toHaveValue(initial);
	await expect(save).toBeEnabled();
	await page.unroute(endpoint);
	await save.click();
	await expect(page.getByText('Votre nom a été enregistré.', { exact: true })).toBeVisible();
	await expect(save).toBeDisabled();
	await page.reload();
	await expect(name).toHaveValue(initial);
	await expect(save).toBeDisabled();
});

test('rubric save is disabled for clean and reverted drafts and remains available after failure', async ({
	page,
	app
}) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}/bareme`);
	const tabs = page.getByRole('tablist', { name: 'Sections du module' }).getByRole('tab');
	await expect(async () => {
		await tabs.nth(1).click();
		await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await tabs.first().click();
	const title = page.getByLabel('Nom de la section', { exact: true }).filter({ visible: true });
	const initial = await title.inputValue();
	const save = page.getByRole('button', { name: 'Enregistrer le barème', exact: true }).first();
	await expect(save).toBeDisabled();
	await title.fill('Section fictive modifiée');
	await expect(save).toBeEnabled();
	await title.fill(initial);
	await expect(save).toBeDisabled();
	await title.fill('Section fictive modifiée');
	const endpoint = `**/enseignant/modules/${app.ids.module}/bareme?/saveRubric`;
	await page.route(endpoint, (route) => route.abort('failed'));
	await save.click();
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(title).toHaveValue('Section fictive modifiée');
	await expect(save).toBeEnabled();
	await title.fill(initial);
	await expect(save).toBeEnabled();
	await title.fill('Section fictive modifiée');
	await page.unroute(endpoint);
	await save.click();
	await expect(page.getByText('Barème enregistré.', { exact: true })).toBeVisible();
	await expect(save).toBeDisabled();
	await page.reload();
	await expect(save).toBeDisabled();
});

test('class creation remains available while unchanged class edits cannot be saved', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/classes?classe=${app.ids.currentClass}`);
	const creation = await openClassDialog(page, 'Nouvelle classe');
	await expect(creation.getByRole('button', { name: 'Créer la classe', exact: true })).toBeEnabled();
	await creation.getByRole('button', { name: 'Annuler', exact: true }).click();
	const dialog = await openClassDialog(page, 'Modifier la classe');
	const name = dialog.getByLabel('Nom de la classe', { exact: true });
	const initial = await name.inputValue();
	const save = dialog.getByRole('button', { name: 'Enregistrer le nom', exact: true });
	await expect(save).toBeDisabled();
	await name.fill('Classe fictive modifiée');
	await expect(save).toBeEnabled();
	await name.fill(initial);
	await expect(save).toBeDisabled();
	await name.fill('Classe fictive modifiée');
	const endpoint = '**/enseignant/classes?/updateClass';
	await page.route(endpoint, (route) => route.fulfill({ status: 200, json: {} }));
	await save.click();
	await expect(dialog.getByRole('alert')).toBeVisible();
	await expect(name).toHaveValue('Classe fictive modifiée');
	await expect(save).toBeEnabled();
	await name.fill(initial);
	await expect(save).toBeEnabled();
	await name.fill('Classe fictive modifiée');
	await page.unroute(endpoint);
	await save.click();
	await expect(dialog).not.toBeVisible();
	const reopened = await openClassDialog(page, 'Modifier la classe');
	await expect(reopened.getByLabel('Nom de la classe', { exact: true })).toHaveValue('Classe fictive modifiée');
	await expect(reopened.getByRole('button', { name: 'Enregistrer le nom', exact: true })).toBeDisabled();
});

test('student creation remains available while rename save follows its retained draft', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/classes?classe=${app.ids.currentClass}`);
	await expect(async () => {
		await page.getByRole('button', { name: 'Ajouter un étudiant', exact: true }).click();
		await expect(page.getByRole('dialog', { name: 'Ajouter un étudiant', exact: true })).toBeVisible({
			timeout: 1000
		});
	}).toPass({ timeout: 60000 });
	const creation = page.getByRole('dialog', { name: 'Ajouter un étudiant', exact: true });
	const add = creation.getByRole('button', { name: 'Ajouter l’étudiant', exact: true });
	await expect(add).toBeEnabled();
	await creation.getByLabel('Nom complet', { exact: true }).fill('Étudiant fictif à renommer');
	await add.click();
	await expect(creation).not.toBeVisible();
	const openRename = page.getByRole('button', {
		name: 'Modifier Étudiant fictif à renommer',
		exact: true
	});
	await openRename.click();
	const dialog = page.getByRole('dialog', { name: 'Modifier le nom', exact: true });
	const name = dialog.getByLabel('Nom complet', { exact: true });
	const save = dialog.getByRole('button', { name: 'Enregistrer le nom', exact: true });
	await expect(save).toBeDisabled();
	await name.fill('Étudiant fictif renommé');
	await expect(save).toBeEnabled();
	await name.fill('Étudiant fictif à renommer');
	await expect(save).toBeDisabled();
	await name.fill('Étudiant fictif renommé');
	await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
	await openRename.click();
	await expect(name).toHaveValue('Étudiant fictif renommé');
	await expect(save).toBeEnabled();
	const endpoint = '**/enseignant/classes?/updateStudent';
	await page.route(endpoint, (route) => route.fulfill({ status: 200, json: {} }));
	await save.click();
	await expect(dialog.getByRole('alert')).toBeVisible();
	await name.fill('Étudiant fictif à renommer');
	await expect(save).toBeEnabled();
	await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
	await openRename.click();
	await expect(name).toHaveValue('Étudiant fictif à renommer');
	await expect(save).toBeEnabled();
	await name.fill('Étudiant fictif renommé');
	await page.unroute(endpoint);
	await page.route(endpoint, (route) => fulfillFormAction(route, { status: 409, message: 'Conflit fictif conservé' }));
	await save.click();
	await expect(dialog.getByRole('alert')).toBeVisible();
	await expect(name).toHaveValue('Étudiant fictif renommé');
	await expect(save).toBeEnabled();
	await page.unroute(endpoint);
	await save.click();
	await expect(dialog).not.toBeVisible();
	await page.getByRole('button', { name: 'Modifier Étudiant fictif renommé', exact: true }).click();
	await expect(name).toHaveValue('Étudiant fictif renommé');
	await expect(save).toBeDisabled();
});
