import { openModulePages, closeModulePages } from './support/module-navigation.js';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';

test('student navigation opens published pages while keeping the draft private', async ({
	page,
	app,
	request
}, info) => {
	const privatePath = '/enseignant/vue-etudiante';
	const guarded = await request.get(app.origin + privatePath, { maxRedirects: 0 });
	expect(guarded.status()).toBe(303);
	expect(guarded.headers().location).toBe('/connexion');
	await activate(page, app);
	if (info.project.name === 'mobile') {
		await expect(async () => {
			const show = page.getByRole('button', { name: /^(Ouvrir|Afficher) la navigation$/ });
			if (await show.isVisible()) await show.click();
			await expect(page.getByRole('link', { name: 'Pages publiées', exact: true })).toBeVisible({
				timeout: 1000
			});
		}).toPass({ timeout: 60000 });
	}
	const account = page.getByRole('button', { name: /Menu utilisateur de/ });
	const applications = page.getByRole('menuitem', { name: 'Applications connectées' });
	await expect(async () => {
		if (!(await applications.isVisible())) await account.click();
		await expect(applications).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 30000 });
	await expect(applications).toHaveCount(1);
	await expect(applications).toHaveAttribute('href', '/enseignant/applications');
	await expect(page.getByRole('menuitem', { name: 'Notifications' })).toHaveCount(0);
	await page.keyboard.press('Escape');
	const nav = page.getByRole('link', { name: 'Pages publiées', exact: true });
	await expect(nav).not.toHaveAttribute('target', '_blank');
	await nav.click();
	const choice = page;
	await expect(choice).toHaveURL(app.origin + privatePath);
	await expect(choice.getByRole('heading', { name: 'Pages publiées', exact: true })).toBeVisible();
	const list = choice.getByRole('list', { name: 'Classes avec des pages publiées' });
	await expect(list.getByRole('link')).toHaveCount(1);
	await choice.screenshot({
		path: info.outputPath('student-view-class-choice.png'),
		fullPage: true
	});
	const publicOpened = choice.waitForEvent('popup');
	await list.getByRole('link').click();
	const publicClass = await publicOpened;
	await expect(publicClass).toHaveURL(app.origin + '/classes/' + app.ids.currentClass);
	await expect(publicClass.getByRole('heading', { name: 'B2 Demo', exact: true })).toBeVisible();
	expect(await publicClass.content()).not.toContain('PRIVATE');
	await page.goto(app.origin + '/enseignant/modules/' + app.ids.publicationModule);
	await readyModuleEditor(page);
	const title = page.getByLabel('Nom du module', { exact: true });
	await title.fill('PRIVATE_UNSAVED_STUDENT_NAVIGATION');
	const published = page.getByRole('link', { name: /Voir la page publiée/ });
	await expect(published).toHaveAttribute('href', '/modules/' + app.ids.publicationContext);
	await expect((await openModulePages(page)).getByRole('link', { name: 'Publication', exact: true })).toHaveAttribute(
		'href',
		/\/enseignant\/modules\/.+\/publication/
	);
	await closeModulePages(page);
	const moduleOpened = page.waitForEvent('popup');
	await published.click();
	const publicModule = await moduleOpened;
	await expect(
		publicModule.getByRole('heading', { name: 'Application web · publication démo', exact: true })
	).toBeVisible();
	await expect(publicModule.getByRole('navigation', { name: 'Navigation principale' })).toHaveCount(0);
	await expect(publicModule.getByRole('link', { name: 'Voir mes modules' })).toHaveCount(0);
	await expect(publicModule.getByRole('link', { name: 'Publication', exact: true })).toHaveCount(0);
	expect(await publicModule.content()).not.toContain('PRIVATE_UNSAVED_STUDENT_NAVIGATION');
	await expect(title).toHaveValue('PRIVATE_UNSAVED_STUDENT_NAVIGATION');
	await publicModule.screenshot({
		path: info.outputPath('published-module-new-tab.png'),
		fullPage: true
	});
	await (await openModulePages(page)).getByRole('link', { name: 'Barème', exact: true }).click();
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(title).toHaveValue('PRIVATE_UNSAVED_STUDENT_NAVIGATION');
});

test('compact theme menu preserves preferences and focus stays inside controls', async ({ page, app }, info) => {
	await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/modules/' + app.ids.module);
	await readyModuleEditor(page);
	const trigger = page.locator('header').getByRole('button', { name: 'Choisir le thème', exact: true });
	await expect(page.getByRole('button', { name: 'Choisir le thème', exact: true })).toHaveCount(1);
	await expect(trigger).toBeInViewport();
	const dimensions = await trigger.boundingBox();
	expect(dimensions!.width).toBeGreaterThanOrEqual(44);
	expect(dimensions!.height).toBeGreaterThanOrEqual(44);
	for (const [name, dark] of [
		['Thème sombre', true],
		['Thème clair', false],
		['Thème système', false]
	] as const) {
		await trigger.click();
		await page.getByRole('menuitemradio', { name, exact: true }).click();
		await expect(page.locator('html')).toHaveClass(dark ? /dark/ : /^(?!.*dark)/);
		await page.reload();
		await readyModuleEditor(page);
		await trigger.click();
		await expect(page.getByRole('menuitemradio', { name, exact: true })).toHaveAttribute('aria-checked', 'true');
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toHaveCount(0);
	}
	await trigger.click();
	await expect(page.getByRole('menuitemradio', { name: 'Thème système', exact: true })).toBeVisible();
	const menu = page.getByRole('menu');
	await expect(menu).toHaveCSS('opacity', '1');
	await expect(menu).toHaveCSS('outline-style', 'none');
	const menuBounds = await menu.boundingBox();
	expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
	expect(menuBounds!.y).toBeGreaterThanOrEqual(0);
	expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
	await page.screenshot({
		path: info.outputPath('compact-theme-menu.png'),
		animations: 'disabled'
	});
	await page.keyboard.press('Escape');
	const title = page.getByLabel('Nom du module', { exact: true });
	for (const dark of [false, true]) {
		await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
		await title.click();
		const pointer = await title.evaluate((node) => ({
			outline: getComputedStyle(node).outlineStyle,
			shadow: getComputedStyle(node).boxShadow
		}));
		expect(pointer).toEqual({ outline: 'none', shadow: 'none' });
		await page.keyboard.press('Tab');
		const keyboard = await page.locator(':focus').evaluate((node) => {
			const s = getComputedStyle(node);
			return {
				visible: node.matches(':focus-visible'),
				outline: s.outlineStyle,
				offset: s.outlineOffset,
				shadow: s.boxShadow
			};
		});
		expect(keyboard.visible).toBe(true);
		expect(keyboard.shadow).toBe('none');
		if (keyboard.outline !== 'none') expect(parseFloat(keyboard.offset)).toBeLessThanOrEqual(0);
	}

	// Text, multiline and native-select controls share the same pointer treatment.
	const fields = page.locator(
		'[data-slot="input"]:visible, [data-slot="textarea"]:visible, [data-slot="native-select"]:visible'
	);
	for (const field of await fields.all()) {
		if (!(await field.isEnabled())) continue;
		await field.click();
		const style = await field.evaluate((node) => ({
			outline: getComputedStyle(node).outlineStyle,
			shadow: getComputedStyle(node).boxShadow
		}));
		expect(style).toEqual({ outline: 'none', shadow: 'none' });
		await page.keyboard.press('Escape');
	}
	const save = page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first();
	await save.focus();
	await page.keyboard.press('Tab');
	await page.keyboard.press('Shift+Tab');
	await expect(save).toBeFocused();
	const primaryFocus = await save.evaluate((node) => {
		const style = getComputedStyle(node);
		return {
			visible: node.matches(':focus-visible'),
			outlineColor: style.outlineColor,
			textColor: style.color,
			offset: style.outlineOffset,
			shadow: style.boxShadow
		};
	});
	expect(primaryFocus.visible).toBe(true);
	await expect
		.poll(async () =>
			save.evaluate((node) => {
				const style = getComputedStyle(node);
				return style.outlineColor === style.color;
			})
		)
		.toBe(true);
	await expect.poll(async () => save.evaluate((node) => getComputedStyle(node).outlineOffset)).toBe('-2px');
	expect(primaryFocus.shadow).toBe('none');
	await page.screenshot({
		path: info.outputPath('keyboard-focus-inside-control.png'),
		fullPage: true
	});
});
