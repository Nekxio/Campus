import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';

test('roster exposes direct deletion after edit and requires confirmation', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/classes?classe=${app.ids.currentClass}`);
	const roster = page.getByRole('table', { name: /^Étudiants de/ });
	const row = roster.getByRole('row').filter({ hasText: 'Aline Moreau' });
	const edit = row.getByRole('button', { name: 'Modifier Aline Moreau', exact: true });
	const remove = row.getByRole('button', { name: 'Supprimer Aline Moreau', exact: true });
	await expect(remove).toBeVisible();
	await expect(row.getByRole('button', { name: /Autres actions/ })).toHaveCount(0);
	const order = await row.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.ariaLabel));
	expect(order).toEqual(['Modifier Aline Moreau', 'Supprimer Aline Moreau']);
	const confirmation = page.getByRole('alertdialog');
	await expect(async () => {
		await edit.focus();
		await page.keyboard.press('Tab');
		await expect(remove).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(confirmation).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await expect(confirmation).toHaveAccessibleName('Supprimer Aline Moreau ?');
	await expect(row).toBeVisible();
	await confirmation.getByRole('button', { name: 'Annuler', exact: true }).click();
	await expect(confirmation).toBeHidden();
	await expect(remove).toBeFocused();
	await expect(row).toBeVisible();
	await remove.click();
	await confirmation.getByRole('button', { name: 'Supprimer définitivement', exact: true }).click();
	await expect(row).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Étudiants', exact: true })).toBeFocused();
});

test('module heading and bottom reminder save the same draft', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.publicationModule}`);
	await readyModuleEditor(page);
	const heading = page.locator('.module-heading');
	const save = heading.getByRole('button', { name: 'Enregistrer le module', exact: true });
	await expect(save).toBeVisible();
	await expect(save).toBeDisabled();
	const title = page.getByLabel('Nom du module', { exact: true });
	const updated = 'Module fictif avec actions cohérentes';
	await title.fill(updated);
	await expect(save).toBeEnabled();
	await save.click();
	await expect(page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first()).toBeDisabled();
	await page.reload();
	await readyModuleEditor(page);
	await expect(title).toHaveValue(updated);
	await title.fill(`${updated} après rappel`);
	await page.locator('.editor-save-bar').getByRole('button', { name: 'Enregistrer le module', exact: true }).click();
	await expect(save).toBeDisabled();
});
