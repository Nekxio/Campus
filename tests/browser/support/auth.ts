import { expect, type Page } from '@playwright/test';
import type { BrowserFixture } from './process.js';

export async function activate(
	page: Page,
	app: BrowserFixture,
	beforeCreate?: () => Promise<void>
) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});
	let createdCredentials = 0;
	cdp.on('WebAuthn.credentialAdded', () => {
		createdCredentials += 1;
	});
	try {
		await page.goto(app.origin + '/activation');
		await expect(page.getByText('Invitation introuvable', { exact: true })).toBeVisible({
			timeout: 60000
		});
		// Keep the fragment out of Playwright navigation diagnostics and report steps.
		await page.evaluate((token) => {
			window.location.hash = 'token=' + token;
		}, app.invitation);
	} catch {
		throw new Error('Fictional activation navigation failed.');
	}
	await expect
		.poll(() => new URL(page.url()).hash === '', { message: 'Invitation fragment removed' })
		.toBe(true);
	const create = page.getByRole('button', { name: 'Créer ma clé d’accès', exact: true });
	await expect(create).toBeEnabled();
	await beforeCreate?.();
	await create.focus();
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(app.origin + '/');
	expect(createdCredentials, 'Real resident passkey created').toBe(1);
	return { cdp, authenticatorId };
}
