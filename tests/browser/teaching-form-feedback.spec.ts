import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('teaching forms validate before requests, focus linked errors and toast failed and successful saves', async ({
	app,
	page
}) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/classes');
	const dialog = page.getByRole('dialog', { name: 'Nouvelle classe', exact: true });
	await expect(async () => {
		await page.getByRole('button', { name: 'Nouvelle classe', exact: true }).click();
		await expect(dialog).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	const name = dialog.getByRole('textbox', { name: 'Nom de la classe', exact: true });
	let requests = 0;
	await page.route('**/enseignant/classes?/createClass', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		requests++;
		await route.abort();
	});
	await dialog.getByRole('button', { name: 'Créer la classe', exact: true }).click();
	await expect(name).toHaveAttribute('aria-invalid', 'true');
	await expect(name).toHaveAttribute('aria-required', 'true');
	await expect(name).toBeFocused();
	const descriptions = (await name.getAttribute('aria-describedby'))!.split(' ');
	await expect
		.poll(async () => (await Promise.all(descriptions.map((id) => page.locator(`[id="${id}"]`).innerText()))).join(' '))
		.toContain('Renseignez un nom.');
	await expect(
		page.locator('[data-sonner-toast][data-type="error"]').filter({ hasText: 'Vérifiez les champs indiqués.' })
	).toBeVisible();
	expect(requests).toBe(0);
	await name.fill('Classe fictive formulaires');
	await dialog.getByRole('button', { name: 'Créer la classe', exact: true }).click();
	await expect(
		page.locator('[data-sonner-toast][data-type="error"]').filter({ hasText: 'Connexion interrompue.' })
	).toBeVisible();
	await expect(name).toHaveValue('Classe fictive formulaires');
	expect(requests).toBe(1);
	await page.unroute('**/enseignant/classes?/createClass');
	await dialog.getByRole('button', { name: 'Créer la classe', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(
		page.locator('[data-sonner-toast][data-type="success"]').filter({ hasText: 'La classe a été créée.' })
	).toBeVisible();
	await page.getByRole('button', { name: 'Ajouter un étudiant', exact: true }).click();
	const student = page.getByRole('dialog', { name: 'Ajouter un étudiant', exact: true });
	await student.getByRole('button', { name: 'Ajouter l’étudiant', exact: true }).click();
	const studentName = student.getByRole('textbox', { name: 'Nom complet', exact: true });
	await expect(studentName).toHaveAttribute('aria-invalid', 'true');
	await expect(studentName).toBeFocused();
	await studentName.fill('Premier étudiant fictif');
	await student.getByRole('button', { name: 'Fermer', exact: true }).click();
	await page.getByRole('button', { name: 'Importer une liste', exact: true }).click();
	const importing = page.getByRole('dialog', { name: 'Importer les étudiants', exact: true });
	await importing.getByLabel('Liste des étudiants', { exact: true }).fill('Étudiant importé fictif');
	await importing.getByRole('button', { name: 'Fermer', exact: true }).click();
	await page.getByRole('button', { name: 'Ajouter un étudiant', exact: true }).click();
	await expect(studentName).toHaveValue('Premier étudiant fictif');
	await student.getByRole('button', { name: 'Ajouter l’étudiant', exact: true }).click();
	const added = page
		.locator('[data-sonner-toast][data-type="success"]')
		.filter({ hasText: 'L’étudiant a été ajouté à la classe.' });
	await expect(added).toBeVisible();
	await added.getByRole('button', { name: 'Fermer la notification' }).click();
	await expect(added).toHaveCount(0);
	await page.getByRole('button', { name: 'Importer une liste', exact: true }).click();
	await expect(importing.getByLabel('Liste des étudiants', { exact: true })).toHaveValue('Étudiant importé fictif');
	await importing.getByRole('button', { name: 'Ajouter 1 étudiant', exact: true }).click();
	await expect(importing.getByRole('alert')).toContainText('Rechargez la version actuelle');
	await expect(importing.getByLabel('Liste des étudiants', { exact: true })).toHaveValue('Étudiant importé fictif');
	await importing.getByRole('button', { name: 'Recharger la version actuelle', exact: true }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Abandonner et recharger', exact: true }).click();
	await expect(importing).not.toBeVisible();
	await page.getByRole('button', { name: 'Importer une liste', exact: true }).click();
	await importing.getByLabel('Liste des étudiants', { exact: true }).fill('Étudiant importé fictif');
	await importing.getByRole('button', { name: 'Ajouter 1 étudiant', exact: true }).click();
	await expect(importing).not.toBeVisible();
	await expect(page.getByRole('button', { name: 'Modifier Étudiant importé fictif', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Ajouter un étudiant', exact: true }).click();
	await student.getByRole('textbox', { name: 'Nom complet', exact: true }).fill('Deuxième étudiant fictif');
	await student.getByRole('button', { name: 'Ajouter l’étudiant', exact: true }).click();
	await expect(added).toBeVisible();
});
