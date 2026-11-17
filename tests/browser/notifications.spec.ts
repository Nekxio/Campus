import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { fulfillFormAction } from './support/form-actions.js';

const profileAction = '**/enseignant/compte?/updateProfile';

test('class and roster actions toast once after save and keep destructive confirmation separate', async ({
	page,
	app
}) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/classes');
	await expect(async () => {
		await page.getByRole('button', { name: 'Nouvelle classe', exact: true }).click();
		await expect(page.getByRole('dialog', { name: 'Nouvelle classe' })).toBeVisible({
			timeout: 1000
		});
	}).toPass({ timeout: 60000 });
	const dialog = page.getByRole('dialog', { name: 'Nouvelle classe' });
	await dialog.getByRole('textbox', { name: 'Nom de la classe' }).fill('Classe notifications fictive');
	await dialog.getByRole('button', { name: 'Créer la classe', exact: true }).click();
	await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'La classe a été créée.' })).toHaveCount(1);
	await expect(page.getByRole('button', { name: 'Ajouter un étudiant', exact: true })).toBeEnabled();
	await page.getByRole('button', { name: 'Ajouter un étudiant', exact: true }).click();
	const add = page.getByRole('dialog', { name: 'Ajouter un étudiant', exact: true });
	await add.getByRole('textbox', { name: 'Nom complet' }).fill('Étudiant fictif notifications');
	await add.getByRole('button', { name: 'Ajouter l’étudiant', exact: true }).click();
	await expect(
		page.locator('[data-sonner-toast]').filter({ hasText: 'L’étudiant a été ajouté à la classe.' })
	).toHaveCount(1);
	await page.getByRole('button', { name: 'Supprimer Étudiant fictif notifications' }).click();
	const confirmation = page.getByRole('alertdialog');
	await expect(confirmation).toBeVisible();
	await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'ont été supprimés' })).toHaveCount(0);
	await confirmation.getByRole('button', { name: 'Supprimer définitivement', exact: true }).click();
	await expect(
		page
			.locator('[data-sonner-toast]')
			.filter({ hasText: 'L’étudiant et ses données associées ont été supprimés de la classe.' })
	).toHaveCount(1);
	await expect(page.getByRole('button', { name: 'Supprimer Étudiant fictif notifications' })).toHaveCount(0);
});

test('action toasts wait for the server, preserve errors and drafts, and work with keyboard and themes', async ({
	page,
	app
}, info) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/compte');
	await expect(page.locator('#profile-form')).toHaveAttribute('data-enhanced', 'true');
	const name = page.getByRole('textbox', { name: 'Nom et prénom' });
	const save = page.getByRole('button', { name: 'Enregistrer', exact: true });
	await expect(save).toBeDisabled();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let requested = false;
	await page.route(profileAction, async (route) => {
		requested = true;
		await gate;
		await route.continue();
	});
	await expect(async () => {
		await name.fill('Enseignant notifications fictif');
		await expect(save).toBeEnabled({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await save.focus();
	await page.keyboard.press('Enter');
	await expect.poll(() => requested).toBe(true);
	await expect(page.getByRole('button', { name: 'Enregistrement…' })).toBeDisabled();
	const success = page
		.locator('[data-sonner-toast][data-type="success"]')
		.filter({ hasText: 'Votre nom a été enregistré.' });
	await expect(success).toHaveCount(0);
	release();
	await expect(success).toBeVisible();
	await expect(success).toHaveCount(1);
	await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('data-x-position', 'right');
	await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('data-y-position', 'bottom');
	await page.keyboard.press('Alt+t');
	await expect(page.locator('[data-sonner-toaster]')).toBeFocused();
	for (const theme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
		await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('data-sonner-theme', theme);
		await page.screenshot({ path: info.outputPath(`notification-${theme}.png`) });
	}
	const close = success.getByRole('button', { name: 'Fermer la notification' });
	const size = await close.boundingBox();
	expect(Math.round(size?.width ?? 0)).toBeGreaterThanOrEqual(44);
	expect(Math.round(size?.height ?? 0)).toBeGreaterThanOrEqual(44);
	const toastBox = await success.boundingBox();
	const glyph = await close.locator('svg').boundingBox();
	expect(size && toastBox && glyph).toBeTruthy();
	if (!size || !toastBox || !glyph) throw new Error('Missing notification geometry');
	expect(Math.abs(size.y - toastBox.y)).toBeLessThanOrEqual(1);
	expect(Math.abs(size.x + size.width - toastBox.x - toastBox.width)).toBeLessThanOrEqual(1);
	expect(glyph.width).toBeLessThanOrEqual(14.1);
	expect(glyph.height).toBeLessThanOrEqual(14.1);
	await expect(close).toHaveCSS('transform', 'none');
	await expect(close).toHaveCSS('border-top-width', '0px');
	await expect(close).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
	await close.focus();
	await expect(close).toBeFocused();
	await expect(close).toHaveCSS('outline-style', 'solid');
	await page.screenshot({ path: info.outputPath('notification-close-focus.png') });
	await page.keyboard.press('Enter');
	await expect(success).toHaveCount(0);
	await page.unroute(profileAction);
	await page.route(profileAction, (route) =>
		fulfillFormAction(route, { status: 409, message: 'Votre compte a changé. Vos saisies sont conservées.' })
	);
	await name.fill('Brouillon à conserver');
	await save.click();
	const error = page.locator('[data-sonner-toast][data-type="error"]');
	await expect(page.getByRole('alert')).toContainText('Votre compte a changé. Vos saisies sont conservées.');
	// Inline diagnostics and Sonner announce the same failed submission.
	await page.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
	);
	await expect(error.filter({ hasText: 'Votre compte a changé.' })).toHaveCount(1);
	await expect(name).toHaveValue('Brouillon à conserver');
	await expect(success).toHaveCount(0);
	await expect(page.locator('body')).toHaveJSProperty(
		'scrollWidth',
		await page.locator('body').evaluate((el) => el.clientWidth)
	);
	await page.screenshot({ path: info.outputPath('notification-error.png') });
	await page.unroute(profileAction);
	await page.route(profileAction, (route) => fulfillFormAction(route, { receipt: {} }));
	await save.click();
	await expect(page.getByRole('alert')).toContainText('Réponse indisponible. Vos saisies sont conservées ; réessayez.');
	await page.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
	);
	await expect(error.filter({ hasText: 'Réponse indisponible. Vos saisies sont conservées ; réessayez.' })).toHaveCount(
		1
	);
	await expect(success).toHaveCount(0);
	await expect(name).toHaveValue('Brouillon à conserver');
	await page.unroute(profileAction);
	await save.click();
	await expect(success).toBeVisible();
});
