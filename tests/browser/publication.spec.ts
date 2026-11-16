import { readFormActionCommand, readFormActionReceipt } from './support/form-actions.js';
import type { Page } from '@playwright/test';
import { test as base, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';
import type { BrowserFixture } from './support/process.js';
import {
	publicationDecisionSchema,
	publicationReceiptSchema,
	type PublicationDecision
} from '../../src/lib/domain/publication.js';

type ExpectedFailure = { path: string; status: number | 'net::ERR_FAILED' };
const test = base.extend<{ runtime: ExpectedFailure[] }>({
	runtime: [
		async ({ context, app }, use) => {
			// Keep the server alive until runtime assertions finish.
			const expected: ExpectedFailure[] = [];
			const errors: string[] = [];
			const matches = (url: string, status: ExpectedFailure['status']) =>
				expected.some((failure) => failure.path === new URL(url).pathname && failure.status === status);
			const observe = (page: Page) => {
				page.on('pageerror', (error) => errors.push(error.message));
				page.on('console', (message) => {
					if (message.type() !== 'error') return;
					const url = message.location().url;
					if (
						message.text().startsWith('TypeError: Failed to fetch') &&
						message.text().includes('/src/runtime/app/forms/client.js') &&
						expected.some((failure) => failure.status === 'net::ERR_FAILED' && failure.path.startsWith('/enseignant/'))
					)
						return;
					// Only Chromium's resource diagnostic for an explicitly expected fault is allowed.
					if (
						url &&
						expected.some(
							(failure) =>
								matches(url, failure.status) &&
								message.text() ===
									(typeof failure.status === 'number'
										? `Failed to load resource: the server responded with a status of ${failure.status} (Conflict)`
										: 'Failed to load resource: net::ERR_FAILED')
						)
					)
						return;
					errors.push(message.text());
				});
			};
			context.pages().forEach(observe);
			context.on('page', observe);
			context.on('response', (response) => {
				if (response.status() >= 400 && !matches(response.url(), response.status()))
					errors.push(`HTTP ${response.status()} ${response.url()}`);
			});
			context.on('requestfailed', (request) => {
				if (!matches(request.url(), 'net::ERR_FAILED') || request.failure()?.errorText !== 'net::ERR_FAILED')
					errors.push(`${request.failure()?.errorText} ${request.url()}`);
			});
			try {
				await use(expected);
			} finally {
				expect(errors, `No unexpected JavaScript, console, HTTP or network errors on ${app.origin}`).toEqual([]);
			}
		},
		{ auto: true }
	]
});

function reviewUrl(app: BrowserFixture) {
	return `${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`;
}
function publishButton(page: Page) {
	return page
		.getByRole('group', { name: 'Actions de publication', exact: true })
		.getByRole('button', { name: /^Publier (pour cette classe|la mise à jour)$/ });
}
async function decide(page: Page, app: BrowserFixture, action: PublicationDecision['action']) {
	const response = page.waitForResponse(
		(response) =>
			response.url() ===
				`${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?/decidePublication` &&
			response.request().method() === 'POST'
	);
	if (action === 'publish') await publishButton(page).click();
	else {
		await page.getByRole('button', { name: 'Dépublier', exact: true }).click();
		const dialog = page.getByRole('alertdialog', { name: 'Dépublier ce module ?', exact: true });
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Dépublier ce module', exact: true }).click();
	}
	const saved = await response;
	expect(saved.status()).toBe(200);
	const command = publicationDecisionSchema.parse(await readFormActionCommand(saved.request()));
	expect(command.action).toBe(action);
	const receipt = publicationReceiptSchema.parse(await readFormActionReceipt(saved));
	expect(receipt.requestId).toBe(command.requestId);
	expect(receipt.contextId).toBe(app.ids.publicationContext);
	expect(receipt.publicPath).toBe('/modules/' + app.ids.publicationContext);
	await expect(page.getByRole('button', { name: 'Actualiser les références', exact: true }).first()).toBeEnabled();
	return { command, receipt };
}

test('history navigation restores the reviewed context and publication command', async ({ app, page }) => {
	await activate(page, app);
	const route = `${app.origin}/enseignant/modules/${app.ids.module}/publication`;
	const archivedUrl = `${route}?contexte=${app.ids.oldContext}`;
	const currentUrl = `${route}?contexte=${app.ids.currentContext}`;
	await page.goto(currentUrl);
	await expect(publishButton(page)).toBeEnabled();
	const currentPreview = await page.locator('.preview-content').innerText();
	expect(currentPreview).not.toBe('');
	const documentStartedAt = await page.evaluate(() => performance.timeOrigin);
	const expectCurrentContext = async () => {
		await expect(page).toHaveURL(currentUrl);
		await expect(page.getByLabel('Classe sélectionnée', { exact: true })).not.toContainText('2025-2026');
		await expect(page.locator('.preview-content')).toHaveText(currentPreview, { useInnerText: true });
		await expect(publishButton(page)).toBeEnabled();
	};
	const expectArchivedContext = async () => {
		await expect(page).toHaveURL(archivedUrl);
		await expect(page.getByLabel('Classe sélectionnée', { exact: true })).toContainText('2025-2026');
		await expect(page.getByText('Classe archivée', { exact: true })).toBeVisible();
		await expect(publishButton(page)).toHaveCount(0);
	};

	// The one-active-class rule hides the selector; a same-origin link exercises the real client router.
	await page.evaluate((href) => {
		const link = document.createElement('a');
		link.href = href;
		link.textContent = 'Open archived publication context';
		link.dataset.testid = 'publication-context-navigation';
		document.querySelector('main')!.prepend(link);
	}, archivedUrl);
	await page.getByTestId('publication-context-navigation').click();
	await expectArchivedContext();
	await page.evaluate(() => document.querySelector('[data-testid="publication-context-navigation"]')?.remove());
	await page.goBack();
	await expectCurrentContext();
	await page.goForward();
	await expectArchivedContext();
	await page.goBack();
	await expectCurrentContext();
	expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStartedAt);

	const saved = page.waitForResponse(
		(response) => response.url() === `${route}?/decidePublication` && response.request().method() === 'POST'
	);
	await publishButton(page).click();
	const response = await saved;
	expect(response.status()).toBe(200);
	const command = publicationDecisionSchema.parse(await readFormActionCommand(response.request()));
	const receipt = publicationReceiptSchema.parse(await readFormActionReceipt(response));
	expect(command.contextId).toBe(app.ids.currentContext);
	expect(receipt.contextId).toBe(app.ids.currentContext);
	expect(receipt.publicPath).toBe(`/modules/${app.ids.currentContext}`);
});

test('preview scroll chains to the page at its boundaries', async ({ app, page }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The preview has its own scroll area on desktop.');
	await page.setViewportSize({ width: 1440, height: 800 });
	await activate(page, app);
	await page.goto(reviewUrl(app));
	const preview = page.getByRole('region', {
		name: 'Contenu de l’aperçu, défilement au clavier'
	});
	await preview.scrollIntoViewIfNeeded();
	await preview.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await preview.hover();
	const before = await page.evaluate(() => window.scrollY);
	await page.mouse.wheel(0, 500);
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
});

test('publication snapshot stays stable while a private module draft changes', async ({ app, page, request }) => {
	const path = app.origin + '/modules/' + app.ids.publicationContext;
	const before = await request.get(path + '/__data.json');
	expect(before.ok()).toBe(true);
	const snapshot = await before.text();
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/modules/' + app.ids.publicationModule);
	await readyModuleEditor(page);
	await page.getByLabel('Nom du module', { exact: true }).fill('PRIVATE_UNPUBLISHED_TITLE_MARKER');
	const saved = page.waitForResponse(
		(response) =>
			response.url().endsWith('/enseignant/modules/' + app.ids.publicationModule + '?/saveModule') &&
			response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).first().click();
	expect((await saved).status()).toBe(200);
	const after = await request.get(path + '/__data.json');
	expect(await after.text()).toBe(snapshot);
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`
	);
	await expect(page.getByText('Titre, description ou objectifs modifiés', { exact: true })).toBeVisible();
	await expect(page.locator('.preview-content')).toContainText('PRIVATE_UNPUBLISHED_TITLE_MARKER');
	await page.goto(path);
	await expect(page.getByRole('heading', { name: 'Application web · publication démo', exact: true })).toBeVisible();
	expect(await page.content()).not.toContain('PRIVATE_UNPUBLISHED_TITLE_MARKER');
	await expect(page.getByRole('region', { name: 'Supports du cours', exact: true })).toBeVisible();
});

test('publish, unpublish and republish retain the exact module and class URLs', async ({ app, page, request }) => {
	await activate(page, app);
	await page.goto(reviewUrl(app));
	const modulePath = '/modules/' + app.ids.publicationContext;
	const classPath = '/classes/' + app.ids.currentClass;
	const publicLink = page.getByRole('link', {
		name: 'Voir la page publiée · nouvel onglet',
		exact: true
	});
	await expect(publicLink).toHaveAttribute('href', modulePath);
	const published = await decide(page, app, 'publish');
	await expect(page.locator('.publication-state')).toContainText(
		'Le brouillon enregistré correspond à la version publiée.'
	);
	await expect(publicLink).toHaveAttribute('href', modulePath);
	const first = await request.get(app.origin + modulePath + '/__data.json');
	expect(first.status()).toBe(200);
	expect(first.headers()['cache-control']).toBe('no-store');
	expect(first.headers()['x-robots-tag']).toBe('noindex, nofollow');
	expect(await first.text()).toContain('course-version-2.pdf');
	const directory = await request.get(app.origin + classPath);
	expect(directory.status()).toBe(200);
	expect(await directory.text()).toContain(`href="${modulePath}"`);
	const unpublished = await decide(page, app, 'unpublish');
	expect(unpublished.receipt.revision).toBe(published.receipt.revision + 1);
	expect(unpublished.receipt.unpublishedAt).not.toBeNull();
	await expect(publicLink).toHaveCount(0);
	await expect(page.locator('.publication-state')).toContainText('La page du module n’est plus consultable.');
	const unavailable = await request.get(app.origin + modulePath);
	expect(unavailable.status()).toBe(404);
	expect(unavailable.headers()['cache-control']).toBe('no-store');
	expect(unavailable.headers()['x-robots-tag']).toBe('noindex, nofollow');
	const emptyDirectory = await request.get(app.origin + classPath);
	expect(emptyDirectory.status()).toBe(200);
	expect(await emptyDirectory.text()).not.toContain(`href="${modulePath}"`);
	const republished = await decide(page, app, 'publish');
	expect(republished.receipt.revision).toBe(unpublished.receipt.revision + 1);
	expect(republished.receipt.unpublishedAt).toBeNull();
	await expect(publicLink).toHaveAttribute('href', modulePath);
	const restored = await request.get(app.origin + modulePath + '/__data.json');
	expect(restored.status()).toBe(200);
	const restoredSnapshot = await restored.text();
	const restoredDirectory = await request.get(app.origin + classPath);
	expect(restoredDirectory.status()).toBe(200);
	expect((await restoredDirectory.text()).split(`href="${modulePath}"`)).toHaveLength(2);
	// A delayed retry of the earlier unpublish must not undo the newer republication.
	const replay = await page.request.post(
		`${app.origin}/api/teaching/modules/${app.ids.publicationModule}/publication`,
		{
			headers: { Origin: app.origin, 'Idempotency-Key': unpublished.command.requestId },
			data: unpublished.command
		}
	);
	expect(replay.status()).toBe(200);
	expect(publicationReceiptSchema.parse(await replay.json())).toEqual(unpublished.receipt);
	const afterReplay = await request.get(app.origin + modulePath + '/__data.json');
	expect(afterReplay.status()).toBe(200);
	expect(await afterReplay.text()).toBe(restoredSnapshot);
});

test('a real second window causes 409 without replacing the reviewed preview before manual refresh', async ({
	app,
	page,
	context,
	request,
	runtime
}) => {
	const endpoint = `/enseignant/modules/${app.ids.publicationModule}/publication?/decidePublication`;
	runtime.push({ path: endpoint.split('?')[0], status: 409 });
	await activate(page, app);
	await page.goto(reviewUrl(app));
	await expect(publishButton(page)).toBeEnabled();
	const preview = page.locator('.preview-content');
	const reviewed = await preview.textContent();
	const publicBefore = await request.get(`${app.origin}/modules/${app.ids.publicationContext}/__data.json`);
	expect(publicBefore.status()).toBe(200);
	const other = await context.newPage();
	try {
		await other.goto(`${app.origin}/enseignant/modules/${app.ids.publicationModule}`);
		await readyModuleEditor(other);
		await other.getByLabel('Nom du module', { exact: true }).fill('Version enregistrée dans la deuxième fenêtre');
		const saved = other.waitForResponse(
			(response) =>
				response.url().endsWith('/enseignant/modules/' + app.ids.publicationModule + '?/saveModule') &&
				response.request().method() === 'POST'
		);
		await other.getByRole('button', { name: 'Enregistrer le module', exact: true }).first().click();
		expect((await saved).status()).toBe(200);
		await other.goto(reviewUrl(app));
		await expect(other.locator('.preview-content')).toContainText('Version enregistrée dans la deuxième fenêtre');
		await decide(other, app, 'publish');
		await expect(other.locator('.publication-state')).toContainText(
			'Le brouillon enregistré correspond à la version publiée.'
		);
		const changedPublic = await request.get(`${app.origin}/modules/${app.ids.publicationContext}/__data.json`);
		expect(changedPublic.status()).toBe(200);
		const publishedSnapshot = await changedPublic.text();
		expect(publishedSnapshot).not.toBe(await publicBefore.text());
		expect(publishedSnapshot).toContain('Version enregistrée dans la deuxième fenêtre');
		expect(await preview.textContent()).toBe(reviewed);
		const conflicted = page.waitForResponse(
			(response) => response.url().endsWith(endpoint) && response.request().method() === 'POST'
		);
		await publishButton(page).click();
		expect((await conflicted).status()).toBe(409);
		const feedback = page.getByRole('alert').filter({ hasText: 'Version à vérifier de nouveau' });
		await expect(feedback).toBeVisible();
		await expect(feedback).toContainText('Votre aperçu est conservé.');
		expect(await preview.textContent()).toBe(reviewed);
		await expect(preview).not.toContainText('Version enregistrée dans la deuxième fenêtre');
		await expect(publishButton(page)).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Dépublier', exact: true })).toBeDisabled();
		const afterConflict = await request.get(`${app.origin}/modules/${app.ids.publicationContext}/__data.json`);
		expect(afterConflict.status()).toBe(200);
		expect(await afterConflict.text()).toBe(publishedSnapshot);
		await page.getByRole('button', { name: 'Actualiser les références', exact: true }).first().click();
		await expect(preview).toContainText('Version enregistrée dans la deuxième fenêtre');
		await expect(feedback).toHaveCount(0);
		await expect(page.locator('.publication-state')).toContainText(
			'Le brouillon enregistré correspond à la version publiée.'
		);
		await expect(publishButton(page)).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Dépublier', exact: true })).toBeEnabled();
	} finally {
		await other.close();
	}
});

test('a committed publication with a lost response retries the identical command and receipt', async ({
	app,
	page,
	request,
	runtime
}) => {
	const endpoint = `/enseignant/modules/${app.ids.publicationModule}/publication?/decidePublication`;
	runtime.push({ path: endpoint.split('?')[0], status: 'net::ERR_FAILED' });
	await activate(page, app);
	await page.goto(reviewUrl(app));
	await expect(publishButton(page)).toBeEnabled();
	const reviewed = await page.locator('.preview-content').textContent();
	const commands: { body: string | null; key: string | undefined }[] = [];
	const receipts: ReturnType<typeof publicationReceiptSchema.parse>[] = [];
	await page.route(app.origin + endpoint, async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		const command = await readFormActionCommand<PublicationDecision>(route.request());
		commands.push({ body: JSON.stringify(command), key: command.requestId });
		const saved = await route.fetch();
		expect(saved.status()).toBe(200);
		receipts.push(publicationReceiptSchema.parse(await readFormActionReceipt(saved)));
		if (commands.length === 1) await route.abort('failed');
		else await route.fulfill({ response: saved });
	});
	await publishButton(page).click();
	await expect(page.getByRole('alert').filter({ hasText: 'Publication interrompue' })).toBeVisible();
	await expect(page.getByText('La page du module est publiée.', { exact: true })).toHaveCount(0);
	expect(await page.locator('.preview-content').textContent()).toBe(reviewed);
	expect(commands).toHaveLength(1);
	expect(receipts).toHaveLength(1);
	const committed = await request.get(`${app.origin}/modules/${app.ids.publicationContext}/__data.json`);
	expect(committed.status()).toBe(200);
	const snapshot = await committed.text();
	expect(snapshot).toContain('course-version-2.pdf');
	await expect(publishButton(page)).toBeEnabled();
	const retried = await decide(page, app, 'publish');
	expect(commands).toHaveLength(2);
	expect(commands[1]).toEqual(commands[0]);
	expect(commands[0].key).toBe(retried.command.requestId);
	expect(receipts[1]).toEqual(receipts[0]);
	expect(retried.receipt).toEqual(receipts[0]);
	await expect(page.locator('.publication-state')).toContainText(
		'Le brouillon enregistré correspond à la version publiée.'
	);
	const afterRetry = await request.get(`${app.origin}/modules/${app.ids.publicationContext}/__data.json`);
	expect(afterRetry.status()).toBe(200);
	expect(await afterRetry.text()).toBe(snapshot);
	await page.unroute(app.origin + endpoint);
	await decide(page, app, 'unpublish');
	await expect(page.locator('.publication-state')).toContainText('La page du module n’est plus consultable.');
	// The old successful publish receipt is still exact after the opposite decision.
	const replay = await page.request.post(
		`${app.origin}/api/teaching/modules/${app.ids.publicationModule}/publication`,
		{
			headers: { Origin: app.origin, 'Idempotency-Key': retried.command.requestId },
			data: retried.command
		}
	);
	expect(replay.status()).toBe(200);
	expect(publicationReceiptSchema.parse(await replay.json())).toEqual(retried.receipt);
	expect((await request.get(`${app.origin}/modules/${app.ids.publicationContext}`)).status()).toBe(404);
});

test('a failed manual refresh or mismatched read preserves the review and blocks decisions until a validated read', async ({
	app,
	page,
	runtime
}) => {
	const endpoint = `/api/teaching/modules/${app.ids.publicationModule}/publication`;
	runtime.push({ path: endpoint, status: 'net::ERR_FAILED' });
	await activate(page, app);
	await page.goto(reviewUrl(app));
	await expect(publishButton(page)).toBeEnabled();
	const preview = page.locator('.preview-content');
	const reviewed = await preview.textContent();
	const refresh = page.getByRole('button', { name: 'Actualiser les références', exact: true }).first();
	let attempts = 0;
	const read = (url: URL) => url.origin === app.origin && url.pathname === endpoint;
	await page.route(read, async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		attempts += 1;
		if (attempts === 1) return route.abort('failed');
		const response = await route.fetch();
		expect(response.status()).toBe(200);
		const data = await response.json();
		data.module = {
			id: '00000000-0000-4000-8000-000000000099',
			title: 'WRONG_REVIEW_MUST_NOT_BE_APPLIED'
		};
		await route.fulfill({ response, json: data });
	});
	for (let attempt = 1; attempt <= 2; attempt += 1) {
		await refresh.click();
		await expect(page.getByRole('alert')).toContainText('La version que vous avez examinée est conservée.');
		await expect(refresh).toBeEnabled();
		expect(attempts).toBe(attempt);
		expect(await preview.textContent()).toBe(reviewed);
		await expect(page.getByText('WRONG_REVIEW_MUST_NOT_BE_APPLIED', { exact: true })).toHaveCount(0);
		await expect(publishButton(page)).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Dépublier', exact: true })).toBeDisabled();
	}
	await page.unroute(read);
	const loaded = page.waitForResponse(
		(response) => new URL(response.url()).pathname === endpoint && response.request().method() === 'GET'
	);
	await refresh.click();
	expect((await loaded).status()).toBe(200);
	await expect(page.getByRole('alert')).toHaveCount(0);
	expect(await preview.textContent()).toBe(reviewed);
	await expect(publishButton(page)).toBeEnabled();
	await decide(page, app, 'publish');
	await expect(page.locator('.publication-state')).toContainText(
		'Le brouillon enregistré correspond à la version publiée.'
	);
});

test('a valid publication receipt followed by a failed refresh remains a confirmed write', async ({
	app,
	page,
	request,
	runtime
}) => {
	const dataPath = `/api/teaching/modules/${app.ids.publicationModule}/publication`;
	runtime.push({ path: dataPath, status: 'net::ERR_FAILED' });
	await activate(page, app);
	await page.goto(reviewUrl(app));
	await expect(publishButton(page)).toBeEnabled();
	const reviewed = await page.locator('.preview-content').textContent();
	let refreshAttempts = 0;
	const failedRefresh = (url: URL) => url.origin === app.origin && url.pathname === dataPath;
	await page.route(failedRefresh, async (route) => {
		if (route.request().method() !== 'GET') return route.fallback();
		expect(new URL(route.request().url()).searchParams.get('contexte')).toBe(app.ids.publicationContext);
		refreshAttempts += 1;
		await route.abort('failed');
	});
	const saved = await decide(page, app, 'publish');
	expect(saved.receipt.unpublishedAt).toBeNull();
	const warning = page.getByRole('alert').filter({ hasText: 'Décision enregistrée' });
	await expect(warning).toBeVisible();
	await expect(warning).toContainText('La décision est enregistrée, mais l’actualisation a échoué.');
	expect(refreshAttempts).toBe(1);
	await expect(page.getByRole('alert').filter({ hasText: 'Publication interrompue' })).toHaveCount(0);
	await expect(page.getByText('La page du module est publiée.', { exact: true })).toBeVisible();
	expect(await page.locator('.preview-content').textContent()).toBe(reviewed);
	await expect(publishButton(page)).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Dépublier', exact: true })).toBeDisabled();
	const committed = await request.get(`${app.origin}/modules/${app.ids.publicationContext}/__data.json`);
	expect(committed.status()).toBe(200);
	expect(await committed.text()).toContain('course-version-2.pdf');
	await page.getByRole('button', { name: 'Actualiser les références', exact: true }).first().click();
	await expect(warning).toContainText('La version que vous avez examinée est conservée.');
	expect(refreshAttempts).toBe(2);
	expect(await page.locator('.preview-content').textContent()).toBe(reviewed);
	await expect(publishButton(page)).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Dépublier', exact: true })).toBeDisabled();
	await page.unroute(failedRefresh);
	await page.getByRole('button', { name: 'Actualiser les références', exact: true }).first().click();
	await expect(warning).toHaveCount(0);
	await expect(page.locator('.publication-state')).toContainText(
		'Le brouillon enregistré correspond à la version publiée.'
	);
	await expect(page.getByRole('button', { name: 'Dépublier', exact: true })).toBeEnabled();
	await expect(publishButton(page)).toBeDisabled();
});
