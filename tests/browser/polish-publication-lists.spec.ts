import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { readFormActionCommand } from './support/form-actions.js';

test('module tasks are explicit and published pages use the full library width', async ({ app, page }, info) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules`);
	const title = 'Application web · publication démo';
	const tasks = page.getByRole('navigation', { name: `Travailler sur ${title}`, exact: true });
	await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0);
	await expect(tasks.getByRole('link')).toHaveCount(3);
	for (const label of ['Préparer', 'Barème', 'Publication']) {
		await expect(tasks.getByRole('link', { name: label, exact: true })).toBeVisible();
	}
	const libraryWidth = await page
		.locator('.module-library')
		.evaluate((element) => element.getBoundingClientRect().width);
	if (info.project.name === 'mobile') {
		const boxes = await tasks.getByRole('link').evaluateAll((elements) =>
			elements.map((element) => {
				const { top, width, height } = element.getBoundingClientRect();
				return { top, width, height };
			})
		);
		expect(new Set(boxes.map((box) => Math.round(box.top))).size).toBe(1);
		expect(Math.max(...boxes.map((box) => box.width)) - Math.min(...boxes.map((box) => box.width))).toBeLessThan(1);
		for (const box of boxes) expect(box.height).toBeGreaterThanOrEqual(44);
	}
	await page.screenshot({ path: info.outputPath('module-actions.png'), fullPage: true });
	await tasks.getByRole('link', { name: 'Publication', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/enseignant/modules/${app.ids.publicationModule}/publication`));
	await page.goto(`${app.origin}/enseignant/vue-etudiante`);
	const published = page.getByRole('list', { name: 'Classes avec des pages publiées', exact: true });
	await expect(published).toBeVisible();
	const publishedWidth = await published.evaluate((element) => element.getBoundingClientRect().width);
	expect(Math.abs(publishedWidth - libraryWidth)).toBeLessThan(1);
	const classLink = published.getByRole('link').first();
	await expect(classLink).toHaveAttribute('target', '_blank');
	await classLink.focus();
	await expect(classLink).toBeFocused();
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
	await page.screenshot({ path: info.outputPath('published-pages.png'), fullPage: true });
	if (info.project.name === 'mobile') {
		await page.setViewportSize({ width: 320, height: 844 });
		await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
		await expect(page.locator('html')).toHaveClass(/dark/);
		expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
		await page.screenshot({ path: info.outputPath('published-pages-dark-320.png'), fullPage: true });
	}
});

test('the single publication command saves the reviewed scope and exposes pending state', async ({
	app,
	page
}, info) => {
	await activate(page, app);
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`
	);
	const top = page.getByRole('group', { name: 'Actions de publication', exact: true });
	await expect(page.getByRole('group', { name: 'Rappel des actions de publication', exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Publier la mise à jour', exact: true })).toHaveCount(1);
	const topPublish = top.getByRole('button', { name: 'Publier la mise à jour', exact: true });
	await expect(topPublish).toBeEnabled();
	await expect(topPublish).toBeInViewport();
	const preview = await page.locator('.preview-content').textContent();
	let release = () => {};
	const hold = new Promise<void>((resolve) => {
		release = resolve;
	});
	const commands: unknown[] = [];
	await page.route('**/publication?/decidePublication', async (route) => {
		commands.push(await readFormActionCommand(route.request()));
		await hold;
		await route.continue();
	});
	await topPublish.click();
	try {
		await expect(top.getByRole('button', { name: 'Enregistrement…', exact: true })).toBeDisabled();
		await expect(page.locator('.publication-scope').getByRole('combobox')).toHaveCount(0);
		await expect(page.getByLabel('Classe sélectionnée', { exact: true })).toBeVisible();
		expect(await page.locator('.preview-content').textContent()).toBe(preview);
	} finally {
		release();
	}
	await expect(topPublish).toBeDisabled();
	await expect(page.locator('.publication-state')).toContainText(
		'Le brouillon enregistré correspond à la version publiée.'
	);
	expect(commands).toHaveLength(1);
	expect(commands[0]).toMatchObject({ contextId: app.ids.publicationContext, action: 'publish', confirm: true });
	await page.screenshot({ path: info.outputPath('publication-actions.png'), fullPage: true });
	if (info.project.name === 'mobile') {
		await page.setViewportSize({ width: 320, height: 844 });
		await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
		await expect(page.locator('html')).toHaveClass(/dark/);
		expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
		await page.screenshot({ path: info.outputPath('publication-actions-dark-320.png'), fullPage: true });
	}
});

test('session cards lead with the title and preserve keyboard return focus', async ({ app, page }, info) => {
	await page.goto(`${app.origin}/modules/${app.ids.publicationContext}`);
	const external = page.getByRole('link', {
		name: 'Diaporama du module · démo · lien externe, nouvel onglet',
		exact: true
	});
	await expect(external).toHaveAttribute('href', 'https://example.test/course.pdf');
	await expect(external).toHaveAttribute('target', '_blank');
	const compactNavigation = page.getByRole('button', { name: /^Changer de rubrique :/ });
	if (info.project.name === 'mobile') {
		const dialog = page.getByRole('dialog', { name: 'Contenu du cours', exact: true });
		await expect(async () => {
			await compactNavigation.click();
			await expect(dialog).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 60000 });
		await dialog.getByRole('button', { name: 'Vu en cours / à faire', exact: true }).click();
		await expect(dialog).toHaveCount(0);
	} else {
		const tab = page.getByRole('tab', { name: 'Vu en cours / à faire', exact: true });
		await expect(tab).toHaveAttribute('aria-controls', /^\S+$/);
		await tab.click();
	}
	const lesson = page.getByRole('button', { name: 'Du brief à la navigation', exact: true });
	await expect(lesson).toBeVisible();
	await expect(page.getByText('Séance 1', { exact: true })).toBeVisible();
	await lesson.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'Du brief à la navigation', exact: true })).toBeFocused();
	await expect(
		page.getByText('Nous avons travaillé le brief, les parcours et la structure de l’application.')
	).toBeVisible();
	await page.getByRole('button', { name: 'Retour aux séances', exact: true }).click();
	await expect(lesson).toBeFocused();
	await page.screenshot({ path: info.outputPath('session-cards.png'), fullPage: true });
	await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
	await expect(page.locator('html')).toHaveClass(/dark/);
	if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 844 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
	await page.screenshot({ path: info.outputPath('session-cards-dark.png'), fullPage: true });
});
