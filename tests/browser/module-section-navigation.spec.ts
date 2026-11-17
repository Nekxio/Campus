import type { Page } from '@playwright/test';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';

const chooseSection = async (page: Page, value: string, name: string) => {
	const selector = page.getByLabel('Section du module', { exact: true });
	if (await selector.isVisible()) await selector.selectOption(value);
	else {
		await page.getByRole('tab', { name, exact: false }).focus();
		await page.keyboard.press('Enter');
	}
	await expect(page.getByRole('tabpanel', { name, exact: false })).toBeVisible();
};

test('library preparation shortcuts open preparation and section URLs survive reload and history with drafts', async ({
	app,
	page
}, info) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules`);
	const shortcut = page.getByRole('link', { name: 'Préparer', exact: true }).filter({ visible: true }).first();
	await expect(shortcut).toHaveAttribute('href', /[?&]section=preparation(?:&|$)/);
	await shortcut.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('tabpanel', { name: 'Notes privées', exact: false })).toBeVisible();
	const query = new URLSearchParams({
		section: 'planning',
		classe: app.ids.currentClass,
		contexte: app.ids.currentContext,
		annee: '2026-2027'
	});
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}?${query}`);
	await expect(page.getByRole('tabpanel', { name: 'Classe et planning', exact: false })).toBeVisible();
	await readyModuleEditor(page);
	await chooseSection(page, 'planning', 'Classe et planning');
	await chooseSection(page, 'preparation', 'Notes privées');
	await expect.poll(() => new URL(page.url()).searchParams.get('section')).toBe('preparation');
	for (const [key, value] of query)
		if (key !== 'section') expect(new URL(page.url()).searchParams.get(key)).toBe(value);
	await page.reload();
	await expect(page.getByRole('tabpanel', { name: 'Notes privées', exact: false })).toBeVisible();
	await readyModuleEditor(page);
	await chooseSection(page, 'preparation', 'Notes privées');
	await page.getByLabel('Prochaines étapes', { exact: true }).fill('Brouillon local à conserver');
	await chooseSection(page, 'planning', 'Classe et planning');
	await page.goBack();
	await expect(page.getByRole('tabpanel', { name: 'Notes privées', exact: false })).toBeVisible();
	await expect(page.getByLabel('Prochaines étapes', { exact: true })).toHaveValue('Brouillon local à conserver');
	await expect(page.getByRole('alertdialog')).toHaveCount(0);
	await page.goForward();
	await expect(page.getByRole('tabpanel', { name: 'Classe et planning', exact: false })).toBeVisible();
	await expect.poll(() => new URL(page.url()).searchParams.get('section')).toBe('planning');
	await page.screenshot({ path: info.outputPath('module-planning-history.png'), fullPage: true });
	await chooseSection(page, 'information', 'Informations');
	await expect(page.getByRole('complementary', { name: 'Compléter le module' })).toHaveCount(0);
	await expect(page.getByText('Classes associées', { exact: true })).toHaveCount(0);
	await chooseSection(page, 'resources', 'Contenu étudiant');
	await expect(page.getByRole('paragraph').filter({ hasText: 'Ces liens apparaissent' })).toContainText(
		'Ces liens apparaissent sur la page étudiante après publication du module ou de sa mise à jour.'
	);
	await page.getByRole('button', { name: 'Ajouter un support', exact: true }).focus();
	await expect(page.getByRole('button', { name: 'Ajouter un support', exact: true })).toBeFocused();
	await page.screenshot({
		path: info.outputPath('student-links-publication-help.png'),
		fullPage: true
	});

	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
