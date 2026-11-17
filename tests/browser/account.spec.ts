import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('teacher can save or abandon a profile name without changing identity', async ({ page, app }, info) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/compte');
	await expect(page.getByRole('heading', { name: 'Compte', exact: true })).toBeVisible();
	await expect(page.getByText('teacher-browser@example.test', { exact: true })).toBeVisible();
	await expect(page.getByText('Enseignant', { exact: true })).toBeVisible();

	const name = page.getByRole('textbox', { name: 'Nom et prénom' });
	await expect(name).toHaveAttribute('id', 'profile-full-name');
	await expect(name).toHaveAttribute('name', 'name');
	await expect(name).toHaveAttribute('type', 'text');
	await expect(name).toHaveAttribute('autocomplete', 'name');
	await expect(name).toHaveAttribute('required', '');
	await expect(page.locator('label[for="profile-full-name"]')).toHaveText('Nom et prénom');
	await expect(page.locator('#profile-form')).toHaveAttribute('novalidate', '');
	await expect(page.getByRole('button', { name: 'Annuler', exact: true })).toBeEnabled();
	await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
	await expect(name).toHaveValue('Teacher Browser Demo');
	await name.fill('Nom abandonné');
	await page.getByRole('button', { name: 'Annuler' }).click();
	await expect(name).toHaveValue('Teacher Browser Demo');

	await name.fill('Nom enregistré');
	await page.getByRole('button', { name: 'Annuler', exact: true }).focus();
	await page.keyboard.press('Tab');
	await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(
		page.locator('[data-sonner-toast][data-type="success"]').filter({ hasText: 'Votre nom a été enregistré.' })
	).toContainText('Votre nom a été enregistré.');
	await expect(name).toHaveValue('Nom enregistré');
	for (const theme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: theme });
		await page.screenshot({ path: info.outputPath(`compte-${theme}.png`), fullPage: true });
	}
	const openNavigation = page.getByRole('button', { name: /^(Ouvrir|Afficher) la navigation$/ });
	const mobile = await openNavigation.isVisible();
	if (mobile) await openNavigation.click();
	await expect(page.getByRole('button', { name: 'Menu utilisateur de Nom enregistré' })).toBeVisible();
	if (mobile) await page.getByRole('button', { name: 'Fermer le panneau' }).click();

	let saveRequests = 0;
	page.on('request', (request) => {
		if (request.method() === 'POST' && request.url().endsWith('/enseignant/compte?/updateProfile')) saveRequests += 1;
	});
	await name.fill('');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByText('Indiquez votre nom et prénom.', { exact: true })).toBeVisible();
	await expect(name).toHaveAttribute('aria-invalid', 'true');
	await expect(name).toBeFocused();
	await expect(name).toHaveAttribute('aria-describedby', /(?:^|\s)profile-full-name-error(?:\s|$)/);
	await expect(
		page.locator('[data-sonner-toast][data-type="error"]').filter({ hasText: 'Vérifiez les champs signalés.' }).last()
	).toBeVisible();
	await name.fill('   ');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.getByText('Indiquez votre nom et prénom.', { exact: true })).toBeVisible();
	await expect.poll(() => saveRequests).toBe(0);
	await page.getByRole('button', { name: 'Annuler' }).click();
	await expect(name).toHaveValue('Nom enregistré');
	await expect(name).not.toHaveAttribute('aria-invalid', 'true');
});

test('a confirmed profile save preserves a newer edit while the response is pending', async ({ page, app }) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/compte');
	await expect(page.locator('#profile-form')).toHaveAttribute('data-enhanced', 'true');
	let release!: () => void;
	let confirmed = false;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route('**/enseignant/compte?/updateProfile', async (route) => {
		const response = await route.fetch();
		confirmed = true;
		await gate;
		await route.fulfill({ response });
	});
	const name = page.getByRole('textbox', { name: 'Nom et prénom' });
	await name.fill('First saved name');
	await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
	await expect.poll(() => confirmed).toBe(true);
	await name.fill('Newer unsaved name');
	await page
		.getByRole('navigation', { name: 'Sections du compte', exact: true })
		.getByRole('link', { name: 'Applications connectées', exact: true })
		.click();
	const confirmation = page.getByRole('alertdialog', { name: 'Quitter les informations du compte ?', exact: true });
	await expect(confirmation.getByRole('button', { name: 'Quitter sans enregistrer', exact: true })).toBeDisabled();
	await confirmation.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(name).toHaveValue('Newer unsaved name');
	release();
	await expect(page.getByRole('button', { name: 'Enregistrer', exact: true })).toBeEnabled();
	await expect(name).toHaveValue('Newer unsaved name');
	await page.getByRole('button', { name: 'Annuler', exact: true }).click();
	await expect(name).toHaveValue('First saved name');
});
