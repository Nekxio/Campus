import { createClient } from '@libsql/client';
import { pathToFileURL } from 'node:url';
import { currentAcademicYear } from '../../src/lib/domain/academic-year.js';
import { createDatabase } from '../../src/lib/server/db/index.js';
import { createClass, createModule, getModule } from '../../src/lib/server/teaching/service.js';
import { emptyModule } from '../../src/lib/teaching/types.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { openModulePages } from './support/module-navigation.js';

test('cancelling historical module preparation returns to its annual dossier and protects an unsaved draft', async ({
	app,
	page
}) => {
	const historicalStart = Number(currentAcademicYear().slice(0, 4)) - 2;
	const academicYear = `${historicalStart}-${historicalStart + 1}`;
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		const db = createDatabase(client);
		const schoolClass = await createClass(db, { name: 'Classe historique fictive', academicYear });
		const module = await createModule(db, {
			...emptyModule(),
			title: 'Module historique fictif',
			contexts: [{ id: crypto.randomUUID(), classId: schoolClass.id, lessons: [] }]
		});
		const annualUrl = `${app.origin}/enseignant/classes/annees?annee=${academicYear}`;
		await activate(page, app);
		await page.goto(annualUrl);
		await expect(page.getByLabel('Année à consulter', { exact: true })).toHaveValue(academicYear);
		await expect(async () => {
			await page.getByRole('button', { name: 'Consulter l’historique et les PDF', exact: true }).click();
			await expect(page.getByRole('link', { name: 'Publication', exact: true })).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 60000 });
		await page.getByRole('link', { name: 'Publication', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Publication du module', exact: true })).toBeVisible();
		await expect(page.getByLabel('Classe sélectionnée', { exact: true })).toContainText(academicYear);
		await (await openModulePages(page)).getByRole('link', { name: 'Préparer', exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`/enseignant/modules/${module.id}\\?`));
		const title = page.getByLabel('Nom du module', { exact: true });
		await expect(title).toHaveValue(module.title);
		await title.fill('Brouillon historique non enregistré');
		await page.getByRole('button', { name: 'Annuler', exact: true }).click();
		const confirmation = page.getByRole('alertdialog', { name: 'Quitter le module ?', exact: true });
		await expect(confirmation).toBeVisible();
		await confirmation.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
		await expect(title).toHaveValue('Brouillon historique non enregistré');
		await page.getByRole('button', { name: 'Annuler', exact: true }).click();
		await confirmation.getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click();
		await expect(page).toHaveURL(annualUrl);
		await expect(page.getByRole('heading', { name: 'Fin d’année et historique', exact: true })).toBeVisible();
		await expect(page.getByLabel('Année à consulter', { exact: true })).toHaveValue(academicYear);
		const retained = await getModule(db, module.id);
		expect(retained.title).toBe(module.title);
		expect(retained.contexts).toEqual(module.contexts);
	} finally {
		client.close();
	}
});
