import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('a native submission before hydration keeps private input out of the URL', async ({
	app,
	page,
	browser,
	context
}) => {
	await activate(page, app);
	const nativeContext = await browser.newContext({
		javaScriptEnabled: false,
		storageState: await context.storageState()
	});
	try {
		const nativePage = await nativeContext.newPage();
		await nativePage.goto(app.origin + '/enseignant/compte');
		await nativePage.getByRole('textbox', { name: 'Nom et prénom' }).fill('Private fictional input');
		const request = nativePage.waitForRequest((candidate) => candidate.isNavigationRequest());
		const navigation = nativePage.waitForNavigation();
		// Exercise the browser fallback without the application's submit listener.
		await nativePage.locator('#profile-form').evaluate((form: HTMLFormElement) => form.submit());
		const submitted = await request;
		const response = await navigation;
		expect(submitted.method()).toBe('POST');
		expect(new URL(submitted.url()).search).toBe('?/updateProfile');
		expect(submitted.postData()).toContain('Private fictional input');
		expect(response?.status()).toBe(200);
		expect(nativePage.url()).toBe(app.origin + '/enseignant/compte?/updateProfile');
		await expect(nativePage.getByRole('textbox', { name: 'Nom et prénom' })).toHaveValue('Private fictional input');
		const persisted = await page.request.get(app.origin + '/enseignant/compte/__data.json');
		expect(await persisted.text()).toContain('Private fictional input');
		await nativePage.getByRole('textbox', { name: 'Nom et prénom' }).fill('');
		const invalid = nativePage.waitForResponse((candidate) => candidate.request().method() === 'POST');
		await nativePage.getByRole('button', { name: 'Enregistrer', exact: true }).click();
		expect((await invalid).status()).toBe(422);
		await expect(nativePage.getByText('Indiquez votre nom et prénom.', { exact: true })).toBeVisible();
		const unchanged = await page.request.get(app.origin + '/enseignant/compte/__data.json');
		expect(await unchanged.text()).toContain('Private fictional input');
	} finally {
		await nativeContext.close();
	}
});
