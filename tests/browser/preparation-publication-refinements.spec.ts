import type { Page } from '@playwright/test';
import { createClient } from '@libsql/client';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../../src/lib/server/db/index.js';
import * as tables from '../../src/lib/server/db/schema.js';
import type { ModuleDetail, ModuleDraft } from '../../src/lib/teaching/types.js';
import { publicationDecisionSchema } from '../../src/lib/domain/publication.js';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';
import { readFormActionCommand, readFormActionReceipt } from './support/form-actions.js';

const openPreparation = async (page: Page) => {
	const select = page.getByLabel('Section du module', { exact: true });
	if (await select.isVisible()) await select.selectOption('preparation');
	else await page.getByRole('tab', { name: 'Notes privées', exact: false }).click();
};

test('module save follows real changes and returns to a clean disabled state', async ({ app, page }) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.publicationModule}`);
	await readyModuleEditor(page);
	const save = page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first();
	const title = page.getByLabel('Nom du module', { exact: true });
	const original = await title.inputValue();
	const writes: unknown[] = [];
	page.on('request', async (request) => {
		if (request.method() === 'POST' && request.url().endsWith(app.ids.publicationModule + '?/saveModule'))
			writes.push(await readFormActionCommand(request));
	});
	await expect(save).toBeDisabled();
	await title.fill(`${original} · modification fictive`);
	await expect(save).toBeEnabled();
	await title.fill(original);
	await expect(save).toBeDisabled();
	expect(writes).toEqual([]);
	await title.fill(`${original} · modification enregistrée`);
	const saved = page.waitForResponse(
		(response) =>
			response.url().endsWith(`/enseignant/modules/${app.ids.publicationModule}?/saveModule`) &&
			response.request().method() === 'POST'
	);
	await save.click();
	expect((await saved).status()).toBe(200);
	await expect(save).toBeDisabled();
	await expect(page.getByText('Toutes les modifications sont enregistrées.', { exact: true })).toBeVisible();
	expect(writes).toHaveLength(1);
});

for (const failure of ['network', 'undecodable-applied'] as const) {
	test(`existing module retains save and drafts after an uncertain ${failure} update returns to baseline`, async ({
		app,
		page
	}) => {
		await activate(page, app);
		await page.goto(`${app.origin}/enseignant/modules/${app.ids.publicationModule}`);
		await readyModuleEditor(page);
		const title = page.getByLabel('Nom du module', { exact: true });
		const original = await title.inputValue();
		const save = page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first();
		const commands: unknown[] = [];
		const endpoint = `${app.origin}/enseignant/modules/${app.ids.publicationModule}?/saveModule`;
		await page.route(endpoint, async (route) => {
			if (route.request().method() !== 'POST') return route.continue();
			commands.push(await readFormActionCommand(route.request()));
			if (commands.length > 1) return route.continue();
			if (failure === 'network') return route.abort('failed');
			const response = await route.fetch();
			expect(response.status()).toBe(200);
			await route.fulfill({ status: 200, contentType: 'application/json', body: '{invalid' });
		});
		await title.fill(`${original} · réponse incertaine`);
		await save.click();
		await expect(
			page
				.locator('[aria-labelledby="module-feedback-title"]')
				.getByText(
					failure === 'network'
						? 'Connexion interrompue. Vos saisies sont conservées ; réessayez.'
						: 'Réponse indisponible. Vos saisies sont conservées ; réessayez.',
					{ exact: true }
				)
		).toBeVisible();
		await title.fill(original);
		await expect(save).toBeEnabled();
		await expect(page.getByText('Toutes les modifications sont enregistrées.', { exact: true })).toHaveCount(0);
		await page.getByRole('button', { name: 'Annuler', exact: true }).click();
		const dialog = page.getByRole('alertdialog', { name: 'Quitter le module ?', exact: true });
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
		await expect(title).toHaveValue(original);
		const retried = page.waitForResponse(
			(response) => response.url() === endpoint && response.request().method() === 'POST'
		);
		await save.click();
		const result = await retried;
		expect(result.status()).toBe(failure === 'network' ? 200 : 409);
		expect(commands).toHaveLength(2);
		expect(commands[1]).toMatchObject({ title: original });
		await expect(title).toHaveValue(original);
		if (failure === 'network') await expect(save).toBeDisabled();
		else {
			await expect(page.getByRole('button', { name: 'Recharger la version actuelle', exact: true })).toBeVisible();
			await expect(page.getByText('Toutes les modifications sont enregistrées.', { exact: true })).toHaveCount(0);
			await page.getByRole('button', { name: 'Recharger la version actuelle', exact: true }).click();
			const reload = page.getByRole('alertdialog', { name: 'Recharger le module ?', exact: true });
			await expect(reload).toBeVisible();
			await reload.getByRole('button', { name: 'Recharger et remplacer', exact: true }).click();
			await expect(title).toHaveValue(`${original} · réponse incertaine`);
			await expect(save).toBeDisabled();
			await expect(page.getByText('Toutes les modifications sont enregistrées.', { exact: true })).toBeVisible();
		}
	});
}

test('private references are secondary, retain values and reveal invalid fields before saving', async ({
	app,
	page
}) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.publicationModule}`);
	await readyModuleEditor(page);
	await openPreparation(page);
	const references = page.locator('details').filter({
		has: page.locator('summary').filter({ hasText: 'Dossier et références privées' })
	});
	const summary = references.locator('summary').first();
	const framing = page.getByLabel(/^Cadrage pédagogique(?: \(optionnel\))?$/, { exact: true });
	const nextSteps = page.getByLabel(/^Prochaines étapes(?: \(optionnel\))?$/, { exact: true });
	await expect(framing).toBeVisible();
	await expect(nextSteps).toBeVisible();
	await expect(references).not.toHaveAttribute('open', '');
	expect((await nextSteps.boundingBox())!.y).toBeLessThan((await summary.boundingBox())!.y);
	await summary.focus();
	await page.keyboard.press('Enter');
	await expect(references).toHaveAttribute('open', '');
	await expect(summary).toBeFocused();
	const source = references.getByLabel(/^Dossier source local(?: \(optionnel\))?$/, { exact: true });
	await source.fill('/fictional/private/reference-folder');
	await references.getByRole('button', { name: 'Ajouter une référence', exact: true }).click();
	await references.getByLabel(/^Intitulé/).fill('Document privé fictif');
	const url = references.getByLabel(/^Lien HTTPS/);
	await url.fill('http://example.test/private-reference.pdf');
	// Blur validation can move the summary; keyboard activation keeps its focused target.
	await summary.focus();
	await expect(url).toHaveAttribute('aria-invalid', 'true');
	await expect(summary).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(references).not.toHaveAttribute('open', '');
	await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first().click();
	await expect(references).toHaveAttribute('open', '');
	await expect(url).toHaveAttribute('aria-invalid', 'true');
	await expect(source).toHaveValue('/fictional/private/reference-folder');
	await expect(url).toHaveValue('http://example.test/private-reference.pdf');
	await page.getByRole('button', { name: /^Référence 1 · Lien HTTPS ·/ }).click();
	await expect(url).toBeFocused();
	await url.fill('https://example.test/private-reference.pdf');
	await summary.focus();
	await expect(url).not.toHaveAttribute('aria-invalid', 'true');
	await expect(summary).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(references).not.toHaveAttribute('open', '');
	const saved = page.waitForResponse(
		(response) =>
			response.url().endsWith(`/enseignant/modules/${app.ids.publicationModule}?/saveModule`) &&
			response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first().click();
	expect((await saved).status()).toBe(200);
	await expect(page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first()).toBeDisabled();
	await page.reload();
	await readyModuleEditor(page);
	await openPreparation(page);
	await summary.click();
	await expect(source).toHaveValue('/fictional/private/reference-folder');
	await expect(url).toHaveValue('https://example.test/private-reference.pdf');
});

test('private references close on the first pointer activation after blur validation and cancel a drag-out', async ({
	app,
	page
}, info) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.publicationModule}`);
	await readyModuleEditor(page);
	await openPreparation(page);
	const references = page.locator('details').filter({
		has: page.locator('summary').filter({ hasText: 'Dossier et références privées' })
	});
	const summary = references.locator('summary').first();
	const activateSummary = () => (info.project.name === 'mobile' ? summary.tap() : summary.click());
	await activateSummary();
	await references.getByRole('button', { name: 'Ajouter une référence', exact: true }).click();
	await references.getByLabel(/^Intitulé/).fill('Référence fictive · clic souris');
	const url = references.getByLabel(/^Lien HTTPS/);
	await url.fill('http://example.test/private-mouse-reference.pdf');
	await expect(url).toBeFocused();
	await activateSummary();
	await expect(references).not.toHaveAttribute('open', '');
	await activateSummary();
	await expect(references).toHaveAttribute('open', '');
	await expect(url).toHaveValue('http://example.test/private-mouse-reference.pdf');
	await url.fill('https://example.test/private-mouse-reference.pdf');
	await expect(url).toBeFocused();
	await activateSummary();
	await expect(references).not.toHaveAttribute('open', '');
	await expect(url).not.toHaveAttribute('aria-invalid', 'true');
	await activateSummary();
	await expect(references).toHaveAttribute('open', '');
	await summary.scrollIntoViewIfNeeded();
	const bounds = await summary.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
	await page.mouse.down();
	await page.mouse.move(Math.max(1, bounds!.x - 16), bounds!.y + bounds!.height + 16);
	await page.mouse.up();
	await expect(references).toHaveAttribute('open', '');
	await activateSummary();
	await expect(references).not.toHaveAttribute('open', '');
});

test('creation can retry its exact captured command after the current form returns to its baseline', async ({
	app,
	page
}) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/nouveau`);
	await readyModuleEditor(page);
	const title = page.getByLabel('Nom du module', { exact: true });
	const create = page.getByRole('button', { name: 'Créer le brouillon', exact: true });
	await expect(create).toBeEnabled();
	const commands: { id: string; payload: ModuleDraft }[] = [];
	let stored: ModuleDetail | undefined;
	await page.route(`${app.origin}/enseignant/modules/nouveau?/createModule`, async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		const command = await readFormActionCommand<{ id: string; draft: ModuleDraft }>(route.request());
		commands.push({ id: command.id, payload: command.draft });
		if (commands.length > 1) return route.continue();
		const response = await route.fetch();
		expect(response.status()).toBe(200);
		stored = await readFormActionReceipt<ModuleDetail>(response);
		await route.abort('failed');
	});
	await title.fill('Création fictive · tentative conservée');
	await create.click();
	await expect(
		page
			.locator('[aria-labelledby="module-feedback-title"]')
			.getByText('Connexion interrompue. Vos saisies sont conservées ; réessayez.', {
				exact: true
			})
	).toBeVisible();
	await title.fill('');
	await expect(create).toBeEnabled();
	await create.click();
	await expect(
		page.getByText('Brouillon créé. Vos modifications actuelles restent à enregistrer.', {
			exact: true
		})
	).toBeVisible();
	expect(commands).toHaveLength(2);
	expect(commands[1]).toEqual(commands[0]);
	expect(stored!.id).toBe(commands[0].id);
	await expect(title).toHaveValue('');
	await expect(page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first()).toBeEnabled();
});

test('publication names first publication and update from the selected saved state', async ({ app, page }) => {
	const moduleId = crypto.randomUUID();
	const contextId = crypto.randomUUID();
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		const db = createDatabase(client);
		await db.insert(tables.modules).values({ id: moduleId, title: 'Première publication fictive' });
		await db.insert(tables.teachingContexts).values({
			id: contextId,
			moduleId,
			classId: app.ids.currentClass,
			className: 'Classe fictive de publication',
			academicYear: '2026-2027'
		});
	} finally {
		client.close();
	}
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${moduleId}/publication?contexte=${contextId}`);
	const state = page.locator('.publication-state');
	await expect(state.getByRole('heading', { name: 'Première publication', exact: true })).toBeVisible();
	await expect(page.getByLabel('Classe sélectionnée', { exact: true })).toHaveText('B2 Demo');
	await expect(page.locator('.publication-scope').getByRole('combobox')).toHaveCount(0);
	await expect(state).toContainText('Ce module n’a pas encore de page publique pour cette classe.');
	const published = page.waitForResponse(
		(response) =>
			response.url().endsWith(`/enseignant/modules/${moduleId}/publication?/decidePublication`) &&
			response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Publier pour cette classe', exact: true }).first().click();
	const result = await published;
	expect(result.status()).toBe(200);
	const command = publicationDecisionSchema.parse(await readFormActionCommand(result.request()));
	expect(command.contextId).toBe(contextId);
	expect(command.expectedRevision).toBe(0);
	await expect(state.getByRole('heading', { name: 'Mise à jour de la publication', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Publier la mise à jour', exact: true }).first()).toBeDisabled();
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`
	);
	await expect(state.getByRole('heading', { name: 'Mise à jour de la publication', exact: true })).toBeVisible();
	await expect(state).toContainText('Le brouillon a changé. La version publiée reste visible jusqu’à votre décision.');
	await expect(page.getByRole('button', { name: 'Publier la mise à jour', exact: true }).first()).toBeEnabled();
});
