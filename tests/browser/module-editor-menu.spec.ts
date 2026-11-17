import { openModulePages, closeModulePages } from './support/module-navigation.js';
import type { Locator, Page } from '@playwright/test';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';
import { readFormActionCommand, readFormActionReceipt } from './support/form-actions.js';
import type { ModuleDetail, ModuleDraft } from '../../src/lib/teaching/types.js';

const actionName = 'Actions du module';

const moduleSection = async (page: Page, value: string, label: string) => {
	const select = page.getByLabel('Section du module', { exact: true });
	if (await select.isVisible()) await select.selectOption(value);
	else await page.getByRole('tab', { name: label, exact: false }).click();
};

const expectTarget = async (control: Locator) => {
	await expect
		.poll(async () => (await control.boundingBox())?.height ?? 0, { timeout: 5000 })
		.toBeGreaterThanOrEqual(44);
	const bounds = await control.boundingBox();
	expect(bounds!.width).toBeGreaterThanOrEqual(44);
};

test('module links keep real scoped destinations, keyboard focus and clean cancellation', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.publicationModule}?classe=${app.ids.currentClass}&contexte=${app.ids.publicationContext}`
	);
	await readyModuleEditor(page);
	const writes: string[] = [];
	page.on('request', (request) => {
		if (request.url().includes('/api/teaching/') && request.method() !== 'GET')
			writes.push(request.method() + ' ' + new URL(request.url()).pathname);
	});
	await moduleSection(page, 'preparation', 'Notes privées');
	const workflow = await openModulePages(page);
	await expect(workflow).toBeVisible();
	await expect(workflow.getByRole('link')).toHaveText(['Préparer', 'Quiz', 'Barème', 'Notation', 'Publication']);
	for (const link of await workflow.getByRole('link').all()) await expectTarget(link);
	await expect(page.getByRole('button', { name: actionName, exact: true })).toHaveCount(0);
	await expect(page.locator('.module-editor').getByRole('link', { name: 'Barème', exact: true })).toHaveCount(1);
	const published = page.getByRole('link', { name: /Voir la page publiée/ });
	await expectTarget(published);
	await expect(published).toHaveAttribute('href', `/modules/${app.ids.publicationContext}`);
	await expect(published).toHaveAttribute('target', '_blank');
	await expect(published).toHaveAttribute('rel', 'noopener noreferrer');
	const scope = {
		classe: app.ids.currentClass,
		contexte: app.ids.publicationContext,
		section: 'preparation'
	};
	for (const [label, path] of [
		['Publication', `/enseignant/modules/${app.ids.publicationModule}/publication`],
		['Barème', `/enseignant/modules/${app.ids.publicationModule}/bareme`],
		['Quiz', `/enseignant/modules/${app.ids.publicationModule}/quiz`],
		['Notation', '/enseignant/notation']
	]) {
		const target = new URL(
			(await workflow.getByRole('link', { name: label, exact: true }).getAttribute('href'))!,
			app.origin
		);
		expect(target.pathname).toBe(path);
		for (const [name, value] of Object.entries(scope)) expect(target.searchParams.get(name)).toBe(value);
		if (label === 'Barème') expect(target.searchParams.get('retour')).toBe('module');
		if (label === 'Notation') expect(target.searchParams.get('module')).toBe(app.ids.publicationModule);
	}
	const links = workflow.getByRole('link');
	await links.first().focus();
	await page.keyboard.press('Tab');
	await expect(links.nth(1)).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(links.nth(2)).toBeFocused();
	await page.keyboard.press('Shift+Tab');
	await expect(links.nth(1)).toBeFocused();
	await closeModulePages(page);
	const cancelBounds = await page.getByRole('button', { name: 'Annuler', exact: true }).boundingBox();
	await page.mouse.move(cancelBounds!.x + cancelBounds!.width / 2, cancelBounds!.y + 22);
	await page.mouse.down();
	await page.mouse.move(cancelBounds!.x - 60, cancelBounds!.y - 60);
	await page.mouse.up();
	await expect(page.getByRole('alertdialog')).toHaveCount(0);
	await page.getByRole('button', { name: 'Annuler', exact: true }).click();
	await expect(page).toHaveURL(`${app.origin}/enseignant/classes?classe=${app.ids.currentClass}`);
	await expect(page.getByRole('alertdialog')).toHaveCount(0);
	expect(writes).toEqual([]);
});

test('creation hides unavailable actions and recovered identity exposes only valid private links', async ({
	page,
	app
}) => {
	test.setTimeout(90000);
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/modules/nouveau');
	await readyModuleEditor(page);
	await expect(page.getByRole('button', { name: actionName, exact: true })).toHaveCount(0);
	await expect(await openModulePages(page)).toHaveCount(0);
	const save = page.getByRole('button', { name: 'Créer le brouillon', exact: true });
	await expect(save).toHaveAttribute('form', 'module-form');
	await expect(page.locator('.editor-save-bar').getByRole('button', { name: 'Annuler', exact: true })).toHaveAttribute(
		'type',
		'button'
	);
	const title = page.getByLabel('Nom du module', { exact: true });
	await save.click();
	await expect(page.locator('#module-feedback-title')).toHaveText('Des champs nécessitent votre attention');
	await expect(title).toHaveAttribute('aria-invalid', 'true');
	await title.fill('Création fictive menu original');
	const commands: { id: string; payload: ModuleDraft }[] = [];
	let saved: ModuleDetail | undefined;
	await page.route(app.origin + '/enseignant/modules/nouveau?/createModule', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		const command = await readFormActionCommand<{ id: string; draft: ModuleDraft }>(route.request());
		commands.push({ id: command.id, payload: command.draft });
		if (commands.length > 1) return route.continue();
		const response = await route.fetch();
		expect(response.status()).toBe(200);
		saved = await readFormActionReceipt<ModuleDetail>(response);
		await route.abort('failed');
	});
	await save.click();
	await expect(
		page
			.locator('[aria-labelledby="module-feedback-title"]')
			.getByText('Connexion interrompue. Vos saisies sont conservées ; réessayez.', {
				exact: true
			})
	).toBeVisible();
	await expect(page.locator('#module-feedback-title')).toHaveText('Enregistrement non confirmé');
	await expect(page.locator('#module-form [aria-invalid="true"]')).toHaveCount(0);
	await expect(title).toHaveValue('Création fictive menu original');
	await expect(page.getByRole('button', { name: actionName, exact: true })).toHaveCount(0);
	await title.fill('Création fictive menu local conservé');
	await save.click();
	await expect(
		page.getByText('Brouillon créé. Vos modifications actuelles restent à enregistrer.', {
			exact: true
		})
	).toBeVisible();
	expect(commands).toHaveLength(2);
	expect(commands[1]).toEqual(commands[0]);
	expect(saved!.id).toBe(commands[0].id);
	await expect(page).toHaveURL(
		(url) =>
			url.origin === app.origin &&
			url.pathname === '/enseignant/modules/nouveau' &&
			url.searchParams.get('section') === 'information'
	);
	await expect(title).toHaveValue('Création fictive menu local conservé');
	const workflow = await openModulePages(page);
	await expect(workflow.getByRole('link')).toHaveText(['Préparer', 'Quiz', 'Barème', 'Notation', 'Publication']);
	await expect(page.getByRole('link', { name: /Voir la page publiée/ })).toHaveCount(0);
	const notation = new URL(
		(await workflow.getByRole('link', { name: 'Notation', exact: true }).getAttribute('href'))!,
		app.origin
	);
	expect(notation.pathname).toBe('/enseignant/notation');
	expect(notation.searchParams.get('module')).toBe(saved!.id);
	await workflow.getByRole('link', { name: 'Barème', exact: true }).click();
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(title).toHaveValue('Création fictive menu local conservé');
	await page.getByRole('button', { name: 'Annuler', exact: true }).click();
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click();
	await expect(page).toHaveURL(app.origin + '/enseignant/modules');
	const stored = await page.request.get(`${app.origin}/api/teaching/modules/${saved!.id}`);
	expect(stored.status()).toBe(200);
	expect(((await stored.json()) as ModuleDetail).title).toBe('Création fictive menu original');
});

test('module editor batched light dark inspection preserves sections errors and save-bar clearance', async ({
	page,
	app
}, info) => {
	const widths = info.project.name === 'desktop' ? [1440, 1024] : [320, 390];
	const measurements: Record<string, unknown>[] = [];
	await activate(page, app);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	const failedFonts: number[] = [];
	page.on('response', (response) => {
		if (response.request().resourceType() === 'font' && response.status() >= 400) failedFonts.push(response.status());
	});
	const inspect = async (state: string, prepare?: () => Promise<void>) => {
		for (const theme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: theme });
			for (const width of widths) {
				await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
				await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
				await page.evaluate(() => document.fonts.ready);
				await prepare?.();
				const metrics = await page.evaluate(() => ({
					overflow: document.documentElement.scrollWidth - innerWidth,
					savePosition: getComputedStyle(document.querySelector('.editor-save-bar')!).position,
					coarse: matchMedia('(pointer: coarse)').matches,
					interLoaded: [...document.fonts].some((font) => font.family.includes('Inter') && font.status === 'loaded')
				}));
				expect(metrics.interLoaded).toBe(true);
				expect(failedFonts).toEqual([]);
				expect(metrics.overflow).toBeLessThanOrEqual(1);
				expect(metrics.savePosition).toBe(width < 1024 || metrics.coarse ? 'static' : 'sticky');
				measurements.push({ state, theme, width, ...metrics });
				await page.screenshot({
					path: info.outputPath(`${state}-${theme}-${width}.png`),
					fullPage: true
				});
			}
		}
	};
	await page.goto(app.origin + '/enseignant/modules/nouveau');
	await readyModuleEditor(page);
	await inspect('creation');
	await page.getByRole('button', { name: 'Annuler', exact: true }).click();
	await expect(page).toHaveURL(app.origin + '/enseignant/modules');
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.publicationModule}`);
	await readyModuleEditor(page);
	await inspect('edit-navigation', async () => {
		const workflow = await openModulePages(page);
		await expect(workflow.getByRole('link')).toHaveCount(5);
		for (const link of await workflow.getByRole('link').all()) {
			await expectTarget(link);
			const bounds = await link.boundingBox();
			expect(bounds!.x).toBeGreaterThanOrEqual(0);
			expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
		}
		await workflow.getByRole('link', { name: 'Quiz', exact: true }).focus();
		await expect(workflow.getByRole('link', { name: 'Quiz', exact: true })).toBeFocused();
	});
	await closeModulePages(page);
	const objectives = page.getByLabel('Objectifs pédagogiques (optionnel)', { exact: true });
	await inspect('last-field', async () => {
		await objectives.focus();
		const focus = await objectives.evaluate((node) => {
			const field = node.getBoundingClientRect();
			const footer = document.querySelector('.editor-save-bar')!.getBoundingClientRect();
			const descriptions = (node.getAttribute('aria-describedby') ?? '')
				.split(' ')
				.map((id) => document.getElementById(id))
				.filter((element) => element && element.getBoundingClientRect().height > 0);
			return {
				bottom: Math.max(field.bottom, ...descriptions.map((element) => element!.getBoundingClientRect().bottom)),
				footer: footer.top
			};
		});
		expect(focus.bottom).toBeLessThanOrEqual(focus.footer);
		measurements.push({ state: 'focus-clearance', ...focus });
	});
	await moduleSection(page, 'preparation', 'Notes privées');
	await page.getByLabel('Cadrage pédagogique', { exact: true }).fill('Cadrage fictif conservé');
	await expect(page.getByLabel('Prochaines étapes', { exact: true })).toBeVisible();
	await page.locator('summary').filter({ hasText: 'Dossier et références privées' }).click();
	await expect(page.getByLabel('Dossier source local', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Ajouter une référence', exact: true })).toBeVisible();
	await moduleSection(page, 'planning', 'Classe et planning');
	await expect(page.getByRole('button', { name: 'Ajouter une séance', exact: true })).toBeVisible();
	await moduleSection(page, 'resources', 'Contenu étudiant');
	await expect(page.getByLabel('Consignes du module', { exact: true })).toBeVisible();
	await expect(page.getByLabel('Consignes du projet, si pertinent', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Ajouter un exercice non noté', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Ajouter un support', exact: true }).click();
	await page.getByLabel('Intitulé', { exact: true }).last().fill('Support fictif incomplet');
	await moduleSection(page, 'information', 'Informations');
	const writes: string[] = [];
	page.on('request', (request) => {
		if (request.url().includes('/api/teaching/') && request.method() !== 'GET') writes.push(request.method());
	});
	await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first().click();
	await expect(page.getByRole('group', { name: 'Des champs nécessitent votre attention', exact: true })).toBeFocused();
	const invalid = page.getByLabel('Lien HTTPS', { exact: true }).last();
	await expect(invalid).toBeVisible();
	await expect(invalid).toHaveAttribute('aria-invalid', 'true');
	await expect(invalid).toHaveAccessibleDescription(/Collez le lien de partage du document choisi/);
	const description = await invalid.evaluate((node) =>
		(node.getAttribute('aria-describedby') ?? '')
			.split(' ')
			.map((id) => document.getElementById(id)?.textContent ?? '')
			.join(' ')
	);
	expect(description).toMatch(/HTTPS/);
	await inspect('other-section-error');
	await moduleSection(page, 'preparation', 'Notes privées');
	await expect(page.getByLabel('Cadrage pédagogique', { exact: true })).toHaveValue('Cadrage fictif conservé');
	expect(writes).toEqual([]);
	await info.attach('module-editor-inspection-metrics', {
		body: JSON.stringify(measurements, null, 2),
		contentType: 'application/json'
	});
});
