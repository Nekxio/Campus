import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('agent buttons copy connection commands and recover from unavailable clipboard access', async ({
	page,
	context,
	app
}, info) => {
	const capture = async (name: string) => {
		await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
		await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true });
	};
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.origin });
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/applications');
	await expect(page.getByRole('heading', { name: 'Applications autorisées', exact: true })).toBeVisible();
	const commands = {
		Codex: `codex mcp add campus-app --url '${app.origin}/mcp'`,
		Claude: `claude mcp add --transport http --scope user campus-app '${app.origin}/mcp' && claude mcp login campus-app`
	};
	const success = page.locator('[data-sonner-toast][data-type="success"]').filter({ hasText: 'Commande copiée' });
	for (const agent of ['Codex', 'Claude'] as const) {
		const button = page.getByRole('button', { name: agent, exact: true });
		await expect(button).toBeEnabled({ timeout: 60000 });
		await expect(button.locator('svg[aria-hidden="true"]')).toBeVisible();
		await button.focus();
		await page.keyboard.press('Enter');
		await expect(success).toBeVisible();
		await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(commands[agent]);
		if (agent === 'Codex') {
			await expect(success).toHaveCSS('opacity', '1');
			await capture('applications-copied');
		}
		await success.getByRole('button', { name: 'Fermer la notification' }).click();
		await expect(success).toHaveCount(0);
	}
	await expect(page.getByRole('heading', { name: 'Aucune application autorisée' })).toBeVisible();
	for (const theme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
		await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
		await page.getByRole('button', { name: 'Codex', exact: true }).focus();
		await capture(`applications-${theme}`);
	}
	await page.evaluate(() => {
		Object.defineProperty(navigator.clipboard, 'writeText', {
			configurable: true,
			value: async () => {
				throw new DOMException('Clipboard access denied', 'NotAllowedError');
			}
		});
	});
	await page.getByRole('button', { name: 'Codex', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Copie impossible');
	const fallback = page.getByRole('textbox', { name: 'Commande Codex à copier' });
	await expect(fallback).toHaveValue(commands.Codex);
	await expect(fallback).toBeFocused();
	await expect(success).toHaveCount(0);
	await page.evaluate(() => {
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
	});
	await page.getByRole('button', { name: 'Claude', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Commande Claude à copier' })).toHaveValue(commands.Claude);
	await expect(success).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await capture('applications-copy-error');
});
