import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('annual history can be consulted without choosing an annual mutation', async ({ app, page }, info) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/classes/annees?annee=2026-2027`);
	const writes: string[] = [];
	page.on('request', (request) => {
		if (
			request.method() !== 'GET' &&
			(request.url().includes('/api/teaching/years/') ||
				request.url().includes('/enseignant/classes/annees?/decideYear'))
		)
			writes.push(request.url());
	});
	await page.getByRole('button', { name: 'Consulter l’historique et les PDF', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Historique et PDF', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Archiver 2026-2027', exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Vérifier et confirmer la clôture', exact: true })).toHaveCount(0);
	await expect(page.getByRole('alertdialog')).toHaveCount(0);
	expect(writes).toEqual([]);
	await page.screenshot({ path: info.outputPath('annual-reading.png'), fullPage: true });
	await page.goto(app.origin + '/enseignant/vue-etudiante');
	await expect(page.getByRole('heading', { name: 'Préparer ou mettre à jour un module' })).toBeVisible();
	await page.screenshot({ path: info.outputPath('publication-directory.png'), fullPage: true });
	await page.goto(app.origin + '/enseignant/compte');
	await expect(page.getByRole('navigation', { name: 'Sections du compte' })).toBeVisible();
	await page.screenshot({ path: info.outputPath('account.png'), fullPage: true });
});

test('the class introduction appears above the module directory', async ({ app, page }) => {
	await page.goto(`${app.origin}/classes/${app.ids.currentClass}`);
	const introduction = await page.locator('.directory-introduction').boundingBox();
	const directory = await page.locator('.directory-content').boundingBox();
	expect(introduction).not.toBeNull();
	expect(directory).not.toBeNull();
	expect(introduction!.y + introduction!.height).toBeLessThanOrEqual(directory!.y);
});

test('students can filter published modules and recover an empty search', async ({ app, page }, info) => {
	await page.goto(`${app.origin}/classes/${app.ids.currentClass}`);
	await expect(page.getByRole('banner')).not.toContainText('B2 Demo');
	const courses = page.getByRole('link', { name: /^Ouvrir le cours/ });
	const count = await courses.count();
	expect(count).toBeGreaterThan(0);
	const search = page.getByRole('searchbox', { name: 'Rechercher un cours' });
	const results = page.getByRole('status', { name: 'Résultats de la recherche', exact: true });
	await expect(results).toHaveText(`${count} cours affiché${count > 1 ? 's' : ''} sur ${count}`);
	await search.fill('Sans correspondance fictive');
	await expect(page.getByRole('heading', { name: 'Aucun cours trouvé', exact: true })).toBeVisible();
	await expect(courses).toHaveCount(0);
	await expect(results).toHaveText(`0 cours affiché sur ${count}`);
	await page.getByRole('button', { name: 'Afficher tous les cours', exact: true }).click();
	await expect(courses).toHaveCount(count);
	await expect(search).toBeFocused();
	await expect(page.getByRole('heading', { name: 'B2 Demo', exact: true })).toBeVisible();
	await page.screenshot({ path: info.outputPath('public-directory.png'), fullPage: true });
	await expect(results).toHaveCSS('clip-path', 'inset(50%)');
	await courses.first().click();
	await expect(page.getByRole('banner')).not.toContainText('B2 Demo');
});

test('students can navigate a published course', async ({ app, page }, info) => {
	await page.goto(`${app.origin}/classes/${app.ids.currentClass}`);
	const courses = page.getByRole('link', { name: /^Ouvrir le cours/ });
	await courses.first().click();
	await expect(page.getByRole('region', { name: 'Supports du cours', exact: true })).toBeVisible();
	await page.screenshot({ path: info.outputPath('public-course.png'), fullPage: true });
	await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
	if (info.project.name === 'desktop') {
		const tabs = page.getByRole('tablist', { name: 'Contenu du module' });
		await expect(tabs).toHaveAttribute('aria-orientation', 'vertical');
		const supports = tabs.getByRole('tab', { name: 'Supports du cours', exact: true });
		await expect(supports).toHaveAttribute('aria-controls', /^\S+$/);
		await supports.focus();
		await page.keyboard.press('ArrowDown');
		await expect(tabs.getByRole('tab', { name: 'Consignes et barèmes', exact: true })).toBeFocused();
		await tabs.getByRole('tab', { name: 'Échéances et remise', exact: true }).click();
	} else {
		const trigger = page.getByRole('button', { name: /^Changer de rubrique :/ });
		const dialog = page.getByRole('dialog', { name: 'Contenu du cours', exact: true });
		await expect(async () => {
			await trigger.click();
			await expect(dialog).toBeVisible({ timeout: 1000 });
		}).toPass();
		await dialog.getByRole('button', { name: 'Échéances et remise', exact: true }).click();
		await expect(dialog).toHaveCount(0);
	}
	await expect(page.getByRole('region', { name: 'Échéances et remise', exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
	await page.screenshot({
		path: info.outputPath('public-course-dark-reduced.png'),
		fullPage: true
	});
});

test('student course navigation stays compact on mobile and retains all six sections', async ({ app, page }) => {
	await page.goto(`${app.origin}/modules/${app.ids.publicationContext}`);
	const trigger = page.getByRole('button', { name: /^Changer de rubrique :/ });
	const dialog = page.getByRole('dialog', { name: 'Contenu du cours', exact: true });
	const section = page.getByRole('region', { name: 'Vu en cours / à faire', exact: true });
	for (const width of [320, 390, 810]) {
		await page.setViewportSize({ width, height: 900 });
		await expect(trigger).toBeVisible();
		await expect(page.getByRole('tablist')).toHaveCount(0);
		const triggerBox = await trigger.boundingBox();
		if (!triggerBox) throw new Error('The compact course navigation is missing.');
		expect(triggerBox.height).toBeGreaterThanOrEqual(44);
		expect(triggerBox.height).toBeLessThanOrEqual(56);
		await expect(async () => {
			await trigger.click();
			await expect(dialog).toBeVisible({ timeout: 1000 });
		}).toPass();
		const choices = dialog.getByRole('navigation', { name: 'Rubriques du cours', exact: true });
		const buttons = choices.getByRole('button');
		await expect(buttons).toHaveCount(6);
		const bounds = await choices.boundingBox();
		if (!bounds) throw new Error('The course section list is missing.');
		for (const button of await buttons.all()) {
			const box = await button.boundingBox();
			if (!box) throw new Error('A course section is missing.');
			expect(box.x, `${await button.innerText()} starts inside the navigation at ${width}px`).toBeGreaterThanOrEqual(
				bounds.x - 1
			);
			expect(box.x + box.width, `${await button.innerText()} is fully visible at ${width}px`).toBeLessThanOrEqual(
				Math.min(bounds.x + bounds.width, width) + 1
			);
			expect(box.height).toBeGreaterThanOrEqual(48);
		}
		await buttons.last().focus();
		await page.keyboard.press('Enter');
		await expect(dialog).toHaveCount(0);
		await expect(section).toBeFocused();
		await expect(section.getByRole('heading', { name: 'Vu en cours / à faire', exact: true })).toBeInViewport();
		await expect(trigger).toHaveText('Vu en cours / à faire');
		await trigger.click();
		await expect(dialog).toBeVisible();
		await expect(buttons.last()).toHaveAttribute('aria-current', 'location');
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		await expect(trigger).toBeFocused();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	}
	await trigger.click();
	await expect(dialog).toBeVisible();
	for (const width of [1024, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		await expect(dialog).toHaveCount(0);
		await expect(trigger).toBeHidden();
		const tabs = page.getByRole('tablist', { name: 'Contenu du module', exact: true });
		await expect(tabs).toHaveAttribute('aria-orientation', 'vertical');
		await expect(tabs.getByRole('tab')).toHaveCount(6);
		await expect(tabs.getByRole('tab', { name: 'Vu en cours / à faire', exact: true })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await expect(page.getByRole('tabpanel')).toHaveAccessibleName('Vu en cours / à faire');
	}
});
