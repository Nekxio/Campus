import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

const readyNavigation = async (page: Page) => {
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
};

const openSection = async (page: Page, value: string, label: string) => {
	const select = page.getByLabel('Section du module', { exact: true });
	if (await select.isVisible()) await select.selectOption(value);
	else await page.getByRole('tab', { name: label, exact: false }).click();
};

for (const rejectEmptyFirst of [true, false]) {
	test(`a short draft confirms creation once ${rejectEmptyFirst ? 'after an empty-name error' : 'without prior errors'}`, async ({
		app,
		page
	}, info) => {
		await activate(page, app);
		await page.goto(app.origin + '/enseignant/modules/nouveau');
		await readyNavigation(page);
		const submit = page.getByRole('button', { name: 'Créer le brouillon', exact: true });
		await expect(page.getByRole('tablist', { name: 'Sections du module' })).toHaveCount(0);
		await expect(page.getByLabel('Description (optionnel)', { exact: true })).not.toBeVisible();
		const optional = page.locator('summary').filter({ hasText: 'Informations facultatives' });
		await expect(optional).toBeVisible();
		await expect(submit).toBeInViewport({ ratio: 1 });
		const title = page.getByLabel('Nom du module', { exact: true });
		if (rejectEmptyFirst) {
			await expect(async () => {
				await submit.click();
				await expect(page.getByRole('button', { name: /^Nom du module ·/ })).toBeVisible({
					timeout: 1000
				});
			}).toPass({ timeout: 60000 });
			await expect(title).toHaveAttribute('aria-invalid', 'true');
			await page.getByRole('button', { name: /^Nom du module ·/ }).focus();
			await page.keyboard.press('Enter');
			await expect(title).toBeFocused();
		}
		const name = 'Test UX — Nouveau brouillon';
		await title.fill(name);
		if (rejectEmptyFirst) {
			await optional.focus();
			await page.keyboard.press('Enter');
			await page
				.getByLabel('Description (optionnel)', { exact: true })
				.fill('Test UX — Description facultative conservée');
			await page.getByLabel('Objectifs pédagogiques (optionnel)', { exact: true }).fill('Objectif conservé');
		}
		await page.screenshot({
			path: info.outputPath('short-creation.png'),
			fullPage: true,
			animations: 'disabled'
		});
		await submit.focus();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/\/enseignant\/modules\/[a-f\d-]{36}$/);
		await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
		await expect(page.getByText('Brouillon créé.', { exact: true }).first()).toBeVisible();
		await page.evaluate(
			() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
		);
		expect(await page.getByText('Brouillon créé.', { exact: true }).count()).toBe(1);
		const accessible = await page.locator('body').ariaSnapshot();
		expect(accessible.match(/Brouillon créé\./g)).toHaveLength(1);
		const save = page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first();
		await save.focus();
		await expect(save).toBeFocused();
		await page.screenshot({
			path: info.outputPath('single-creation-notice.png'),
			fullPage: true,
			animations: 'disabled'
		});
		await page.reload();
		await expect(title).toHaveValue(name);
		await expect(page.getByLabel('Description (optionnel)', { exact: true })).toHaveValue(
			rejectEmptyFirst ? 'Test UX — Description facultative conservée' : ''
		);
		await expect(page.getByLabel('Objectifs pédagogiques (optionnel)', { exact: true })).toHaveValue(
			rejectEmptyFirst ? 'Objectif conservé' : ''
		);
	});
}

test('optional values and originating class survive the short form, full editor and reediting', async ({
	app,
	page
}, info) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/nouveau?classe=${app.ids.currentClass}&annee=2026-2027`);
	await readyNavigation(page);
	await expect(async () => {
		await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
		await expect(page.getByRole('button', { name: /^Nom du module ·/ })).toBeVisible({
			timeout: 1000
		});
	}).toPass({ timeout: 60000 });
	const name =
		'Test UX — Préparation et références privées pour un module au nom très long qui doit revenir à la ligne sur mobile';
	await page.getByLabel('Nom du module', { exact: true }).fill(name);
	const optional = page.locator('summary').filter({ hasText: 'Informations facultatives' });
	await optional.focus();
	await page.keyboard.press('Enter');
	await expect(optional).toBeFocused();
	const ring = await optional.evaluate((element) => {
		const style = getComputedStyle(element);
		return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
	});
	expect(ring.style).not.toBe('none');
	expect(ring.width).toBeGreaterThanOrEqual(2);
	await page.getByLabel('Description (optionnel)', { exact: true }).fill('Test UX — Description conservée');
	await page
		.getByLabel('Objectifs pédagogiques (optionnel)', { exact: true })
		.fill('Premier objectif\nDeuxième objectif');
	await optional.focus();
	await page.keyboard.press('Enter');
	const full = page.getByRole('button', { name: 'Ouvrir l’éditeur complet', exact: true });
	await full.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByLabel('Nom du module', { exact: true })).toBeFocused();
	await expect(page.getByLabel('Description (optionnel)', { exact: true })).toHaveValue(
		'Test UX — Description conservée'
	);
	await openSection(page, 'preparation', 'Notes privées');
	const framing = page.getByLabel('Cadrage pédagogique', { exact: true });
	const nextSteps = page.getByLabel('Prochaines étapes', { exact: true });
	const source = page.getByLabel('Dossier source local', { exact: true });
	expect((await framing.boundingBox())!.height).toBeLessThanOrEqual(88);
	expect((await nextSteps.boundingBox())!.height).toBeLessThanOrEqual(88);
	await page.locator('summary').filter({ hasText: 'Dossier et références privées' }).click();
	expect((await source.boundingBox())!.y).toBeGreaterThan((await nextSteps.boundingBox())!.y);
	await source.fill('/fictional/test-ux/private-references');
	const longText = Array.from(
		{ length: 14 },
		(_, index) => `Test UX — Note privée ${index + 1} conservée avec son contenu.`
	).join('\n');
	await framing.fill(longText);
	await nextSteps.fill('Test UX — Préparer les exemples');
	await nextSteps.focus();
	await expect(nextSteps).toBeFocused();
	const submit = page.getByRole('button', { name: 'Créer le brouillon', exact: true });
	await submit.focus();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(new RegExp(`/enseignant/modules/[a-f\\d-]{36}\\?.*classe=${app.ids.currentClass}`));
	expect(new URL(page.url()).searchParams.get('annee')).toBe('2026-2027');
	await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
	await page.reload();
	await readyNavigation(page);
	await expect(page.getByText(/2026-2027/).first()).toBeVisible();
	await expect(page.getByLabel('Description (optionnel)', { exact: true })).toHaveValue(
		'Test UX — Description conservée'
	);
	await expect(page.getByLabel('Objectifs pédagogiques (optionnel)', { exact: true })).toHaveValue(
		'Premier objectif\nDeuxième objectif'
	);
	await openSection(page, 'preparation', 'Notes privées');
	await expect(framing).toHaveValue(longText);
	await expect(source).toHaveValue('/fictional/test-ux/private-references');
	expect((await framing.boundingBox())!.height).toBeGreaterThan(112);
	await nextSteps.fill('Test UX — Étapes révisées');
	await nextSteps.focus();
	const clearance = await page.evaluate(() => {
		const field = document.activeElement!.getBoundingClientRect();
		const bar = document.querySelector('.editor-save-bar')!.getBoundingClientRect();
		return field.bottom <= bar.top || bar.bottom <= field.top;
	});
	expect(clearance).toBe(true);
	await page.screenshot({
		path: info.outputPath('filled-preparation.png'),
		fullPage: true,
		animations: 'disabled'
	});
	await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first().click();
	await expect(page.getByText('Module enregistré.', { exact: true }).first()).toBeVisible();
	await page.reload();
	await expect(nextSteps).toHaveValue('Test UX — Étapes révisées');
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
