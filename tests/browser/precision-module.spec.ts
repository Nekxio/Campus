import type { Page, TestInfo } from '@playwright/test';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';

const chooseTheme = async (page: Page, theme: 'clair' | 'sombre') => {
	await expect(async () => {
		await page.getByRole('button', { name: 'Choisir le thème', exact: true }).click();
		await expect(page.getByRole('menuitemradio', { name: `Thème ${theme}`, exact: true })).toBeVisible({
			timeout: 1000
		});
	}).toPass({ timeout: 60000 });
	await page.getByRole('menuitemradio', { name: `Thème ${theme}`, exact: true }).click();
};

const openSection = async (page: Page, value: string, label: string) => {
	const select = page.getByLabel('Section du module', { exact: true });
	if (await select.isVisible()) await select.selectOption(value);
	else await page.getByRole('tab', { name: label, exact: false }).click();
};

const capture = async (page: Page, info: TestInfo, name: string) => {
	await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' });
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
};

test('short creation keeps its primary action next to the required name at every representative size', async ({
	app,
	page
}, info) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/modules/nouveau');
	for (const theme of ['clair', 'sombre'] as const) {
		for (const size of [
			{ width: 375, height: 667 },
			{ width: 390, height: 844 },
			{ width: 1280, height: 900 },
			{ width: 1728, height: 1117 }
		]) {
			await page.setViewportSize(size);
			await chooseTheme(page, theme);
			await page.evaluate(() => window.scrollTo(0, 0));
			await capture(page, info, `short-${size.width}-${theme}`);
			await expect
				.soft(page.getByRole('button', { name: 'Créer le brouillon', exact: true }))
				.toBeInViewport({ ratio: 1 });
		}
	}
	await page.setViewportSize({ width: 375, height: 667 });
	await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
	await expect(page.getByLabel('Nom du module', { exact: true })).toHaveAttribute('aria-invalid', 'true');
	await page.getByRole('button', { name: /^Nom du module ·/ }).focus();
	await page.keyboard.press('Enter');
	await expect(page.getByLabel('Nom du module', { exact: true })).toBeFocused();
	await page.getByLabel('Nom du module', { exact: true }).fill('Brouillon de finition fictif');
	const submit = page.getByRole('button', { name: 'Créer le brouillon', exact: true });
	await submit.focus();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/\/enseignant\/modules\/[a-f\d-]{36}$/);
	await expect(page.getByRole('heading', { name: 'Brouillon de finition fictif', exact: true })).toBeVisible();
	await expect(page.getByText('Brouillon créé.', { exact: true }).first()).toBeVisible();
});

test('short form retains optional values when opening the full editor and cancelling a dirty exit', async ({
	app,
	page
}, info) => {
	await activate(page, app);
	await page.setViewportSize({ width: 375, height: 667 });
	await page.goto(`${app.origin}/enseignant/modules/nouveau?classe=${app.ids.currentClass}&annee=2026-2027`);
	await chooseTheme(page, 'clair');
	await page.getByLabel('Nom du module', { exact: true }).fill('Brouillon contextualisé fictif');
	await page.locator('summary').filter({ hasText: 'Informations facultatives' }).click();
	await page.getByLabel('Description (optionnel)', { exact: true }).fill('Description à conserver');
	await page.getByLabel('Objectifs pédagogiques (optionnel)', { exact: true }).fill('Objectif à conserver');
	await page.getByRole('button', { name: 'Ouvrir l’éditeur complet', exact: true }).click();
	await expect(page.getByLabel('Nom du module', { exact: true })).toBeFocused();
	await expect(page.getByLabel('Description (optionnel)', { exact: true })).toHaveValue('Description à conserver');
	await expect(page.getByLabel('Objectifs pédagogiques (optionnel)', { exact: true })).toHaveValue(
		'Objectif à conserver'
	);
	await page.getByRole('button', { name: 'Annuler', exact: true }).click();
	await expect(page.getByRole('alertdialog', { name: 'Quitter le module ?', exact: true })).toBeVisible();
	await capture(page, info, 'dirty-exit-375');
	await page.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(page.getByLabel('Description (optionnel)', { exact: true })).toHaveValue('Description à conserver');
	await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
	await expect(page).toHaveURL(/\/enseignant\/modules\/[a-f\d-]{36}\?/);
	expect(new URL(page.url()).searchParams.get('classe')).toBe(app.ids.currentClass);
	expect(new URL(page.url()).searchParams.get('annee')).toBe('2026-2027');
	await page.reload();
	await readyModuleEditor(page);
	await expect(page.getByLabel('Description (optionnel)', { exact: true })).toHaveValue('Description à conserver');
});

test('student content groups links and exercises while keeping the single-class association explicit', async ({
	app,
	page
}, info) => {
	await activate(page, app);
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.module}?classe=${app.ids.currentClass}&contexte=${app.ids.currentContext}`
	);
	await readyModuleEditor(page);
	await openSection(page, 'resources', 'Contenu étudiant');
	await expect(page.getByRole('tabpanel', { name: 'Contenu étudiant', exact: false })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Contenu étudiant', exact: true })).toBeVisible();
	await expect(page.getByRole('group', { name: 'Supports et liens', exact: true })).toBeVisible();
	await expect(page.getByRole('group', { name: 'Consignes et exercices', exact: true })).toBeVisible();
	await expect(page.getByText(/accessibles avec leurs corrigés après votre publication/)).toBeVisible();
	await page.getByRole('button', { name: 'Ajouter un support', exact: true }).click();
	await expect(page.getByLabel('Type de lien', { exact: true }).last().locator('option:checked')).toHaveText(
		'Ressource complémentaire'
	);
	await page.getByLabel('Intitulé', { exact: true }).last().fill('Support fictif conservé');
	await page.getByLabel('Lien HTTPS', { exact: true }).last().fill('https://example.test/support');
	await page.getByRole('button', { name: 'Ajouter un exercice non noté', exact: true }).click();
	await page.getByLabel('Titre de l’exercice', { exact: true }).last().fill('Exercice fictif conservé');
	const correction = page.getByRole('textbox', { name: /^Corrigé librement accessible/ }).last();
	await correction.fill('Correction publique fictive');
	await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first().click();
	await expect(page.getByText('Toutes les modifications sont enregistrées.', { exact: true })).toBeVisible();
	await page.reload();
	await chooseTheme(page, 'clair');
	await expect(correction).toHaveValue('Correction publique fictive');
	for (const theme of ['clair', 'sombre'] as const) {
		for (const width of [375, 390, 1280, 1728]) {
			await page.setViewportSize({ width, height: width === 375 ? 667 : 900 });
			await chooseTheme(page, theme);
			await page.evaluate(() => window.scrollTo(0, 0));
			await capture(page, info, `content-${width}-${theme}`);
			if (width === 375 || width === 1728) {
				await page.getByRole('group', { name: 'Consignes et exercices', exact: true }).scrollIntoViewIfNeeded();
				await capture(page, info, `exercises-${width}-${theme}`);
			}
		}
	}
	await openSection(page, 'planning', 'Classe et planning');
	await expect(
		page.getByText(
			'Un module est associé à une seule classe. Pour une autre classe, créez une copie pédagogique indépendante.',
			{ exact: true }
		)
	).toBeVisible();
	await expect(page.getByLabel('Classe à associer', { exact: true })).toHaveCount(0);
	await expect(page.getByText('Toutes les classes disponibles sont déjà associées.', { exact: true })).toHaveCount(0);
	expect(new URL(page.url()).searchParams.get('classe')).toBe(app.ids.currentClass);
	expect(new URL(page.url()).searchParams.get('contexte')).toBe(app.ids.currentContext);
});
