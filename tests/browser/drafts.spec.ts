import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import type { BrowserFixture } from './support/process.js';
import type { ModuleDetail, ModuleDraft } from '../../src/lib/teaching/types.js';
import { editableModule } from '../../src/lib/teaching/types.js';

function clientDiagnostics(page: Page, app: BrowserFixture, testInfo: TestInfo) {
	const errors: { stage: string; name: string; message: string; frames: string[] }[] = [];
	const failedModules: { origin: string; path: string; status: number | null; code?: string }[] =
		[];
	let stage = 'activation';
	const started = performance.now();
	const phases: { stage: string; elapsedMs: number }[] = [{ stage, elapsedMs: 0 }];
	const location = (value: string) => {
		const url = new URL(value);
		return { origin: url.origin, path: url.pathname };
	};
	const sanitize = (value: string) =>
		value
			.replaceAll(app.invitation, '[redacted]')
			.replace(/https?:\/\/[^\s)]+/g, (value) => {
				const frame = value.match(/:\d+:\d+$/)?.[0] ?? '';
				const url = new URL(value.replace(/:\d+:\d+$/, ''));
				return url.origin + url.pathname + frame;
			})
			.replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]');
	page.on('pageerror', (error) => {
		errors.push({
			stage,
			name: error.name,
			message: sanitize(error.message),
			frames: (error.stack ?? '').split('\n').slice(1).map(sanitize)
		});
	});
	page.on('requestfailed', (request) => {
		if (request.resourceType() !== 'script') return;
		failedModules.push({
			...location(request.url()),
			status: null,
			code: request.failure()?.errorText.match(/net::[A-Z_]+/)?.[0]
		});
	});
	page.on('response', (response) => {
		if (response.request().resourceType() === 'script' && response.status() >= 400)
			failedModules.push({ ...location(response.url()), status: response.status() });
	});
	return {
		assertClean() {
			expect(errors, 'Client page errors').toEqual([]);
			expect(failedModules, 'Failed script/module requests').toEqual([]);
		},
		phase(value: string) {
			stage = value;
			phases.push({ stage, elapsedMs: Math.round(performance.now() - started) });
		},
		async failure() {
			const diagnostic = {
				timings: app.timings,
				phases,
				failedStage: stage,
				errors,
				failedModules
			};
			console.info('Sanitized draft failure diagnostic:', JSON.stringify(diagnostic));
			await testInfo.attach('sanitized-draft-failure-diagnostic', {
				body: JSON.stringify(diagnostic, null, 2),
				contentType: 'application/json'
			});
		}
	};
}

async function moduleSection(page: Page, value: string, label: string) {
	const select = page.getByLabel('Section du module', { exact: true });
	if (await select.isVisible()) await select.selectOption(value);
	else await page.getByRole('tab', { name: label, exact: true }).click();
}

async function listedModuleIds(context: BrowserContext, app: BrowserFixture) {
	const html = await (await context.request.get(app.origin + '/')).text();
	return [
		...new Set(
			[...html.matchAll(/href="\/enseignant\/modules\/([a-f\d-]{36})"/g)].map((match) => match[1])
		)
	];
}

async function lostCreation(page: Page, app: BrowserFixture, name: string) {
	await page.goto(app.origin + '/enseignant/modules/nouveau');
	await readyModuleEditor(page);
	const title = page.getByLabel('Nom du module (obligatoire)', { exact: true });
	await title.fill(name);
	const commands: { id: string; payload: ModuleDraft }[] = [];
	const committed = Promise.withResolvers<ModuleDetail>();
	await page.route(app.origin + '/api/teaching/modules', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		commands.push({
			id: route.request().headers()['idempotency-key'],
			payload: route.request().postDataJSON()
		});
		if (commands.length > 1) return route.continue();
		const response = await route.fetch();
		if (response.status() !== 200) throw new Error('Fictional creation did not commit.');
		committed.resolve(await response.json());
		await route.abort('failed');
	});
	await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
	const saved = await committed.promise;
	expect(saved.id).toBe(commands[0].id);
	await expect(
		page.getByText('Connexion interrompue. Vos saisies sont conservées ; réessayez.', {
			exact: true
		})
	).toBeVisible();
	return { saved, commands, title };
}

async function reloadModule(page: Page, confirm = true) {
	await page.getByRole('button', { name: 'Recharger la version actuelle', exact: true }).click();
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toBeVisible();
	await dialog
		.getByRole('button', {
			name: confirm ? 'Recharger et remplacer' : 'Continuer à modifier',
			exact: true
		})
		.click();
}

test('module creation unchanged retry resolves the original command and navigates safely', async ({
	app,
	page,
	context
}, testInfo) => {
	const diagnostic = clientDiagnostics(page, app, testInfo);
	try {
		await activate(page, app);
		const before = new Set(await listedModuleIds(context, app));
		const { saved, commands, title } = await lostCreation(page, app, 'Création inchangée fictive');
		diagnostic.phase('unchanged exact replay');
		const replay = page.waitForResponse(
			(response) =>
				response.url() === app.origin + '/api/teaching/modules' &&
				response.request().method() === 'POST'
		);
		await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
		expect((await replay).status()).toBe(200);
		expect(commands).toHaveLength(2);
		expect(commands[1]).toEqual(commands[0]);
		await expect(page).toHaveURL(app.origin + '/enseignant/modules/' + saved.id);
		await expect(title).toHaveValue(saved.title);
		const stored = (await (
			await context.request.get(app.origin + '/api/teaching/modules/' + saved.id)
		).json()) as ModuleDetail;
		expect(stored.revision).toBe(1);
		expect((await listedModuleIds(context, app)).filter((id) => !before.has(id))).toEqual([
			saved.id
		]);
		diagnostic.assertClean();
	} catch (error) {
		await diagnostic.failure();
		throw error;
	}
});

test('module creation stale replay keeps its command through GET failures and 404 until explicit discard', async ({
	app,
	page,
	context
}, testInfo) => {
	const diagnostic = clientDiagnostics(page, app, testInfo);
	try {
		await activate(page, app);
		const before = new Set(await listedModuleIds(context, app));
		const { saved, commands, title } = await lostCreation(
			page,
			app,
			'Création avant autre fenêtre'
		);
		const endpoint = app.origin + '/api/teaching/modules/' + saved.id;
		const other = await context.request.patch(endpoint, {
			headers: { Origin: app.origin },
			data: {
				...editableModule(saved),
				title: 'Version sauvegardée par autre fenêtre',
				expectedRevision: saved.revision
			}
		});
		expect(other.status()).toBe(200);
		await title.fill('Modifications locales conservées');
		const failures = [503, 404];
		const patches: unknown[] = [];
		await page.route(endpoint, async (route) => {
			if (route.request().method() === 'PATCH') patches.push(route.request().postDataJSON());
			const status = route.request().method() === 'GET' ? failures.shift() : undefined;
			if (status)
				await route.fulfill({
					status,
					json: { message: 'Lecture fictive temporairement indisponible.' }
				});
			else await route.continue();
		});
		for (const readStatus of [503, 404, 200]) {
			diagnostic.phase('stale replay and recovery GET ' + readStatus);
			const replay = page.waitForResponse(
				(response) =>
					response.url() === app.origin + '/api/teaching/modules' &&
					response.request().method() === 'POST'
			);
			const read = page.waitForResponse(
				(response) => response.url() === endpoint && response.request().method() === 'GET'
			);
			await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
			expect((await replay).status()).toBe(409);
			expect((await read).status()).toBe(readStatus);
			await expect(page.locator('#module-form')).toHaveAttribute('aria-busy', 'false');
			await expect(title).toHaveValue('Modifications locales conservées');
			expect(commands.at(-1)).toEqual(commands[0]);
			expect(patches).toHaveLength(0);
			await expect(
				page.getByRole('heading', { name: 'Créer un module', exact: true })
			).toBeVisible();
			if (readStatus !== 200)
				await expect(
					page.getByText(
						'Actualisation impossible. Vos saisies et la tentative de création sont conservées ; réessayez.',
						{ exact: true }
					)
				).toBeVisible();
		}
		await expect(page.getByText('Version à actualiser', { exact: true })).toBeVisible();
		await reloadModule(page, false);
		await expect(title).toHaveValue('Modifications locales conservées');
		await reloadModule(page);
		await expect(title).toHaveValue('Version sauvegardée par autre fenêtre');
		await expect(page.getByText('Version actuelle rechargée.', { exact: true })).toBeVisible();
		await expect(page).toHaveURL(app.origin + '/enseignant/modules/nouveau');
		expect(patches).toHaveLength(0);
		expect((await listedModuleIds(context, app)).filter((id) => !before.has(id))).toEqual([
			saved.id
		]);
		diagnostic.assertClean();
	} catch (error) {
		await diagnostic.failure();
		throw error;
	}
});

test('module creation pending navigation retains identity with an invalid current title and allows explicit discard', async ({
	app,
	page,
	context
}, testInfo) => {
	const diagnostic = clientDiagnostics(page, app, testInfo);
	try {
		await activate(page, app);
		const before = new Set(await listedModuleIds(context, app));
		const { saved, commands, title } = await lostCreation(page, app, 'Création avant navigation');
		await title.fill('');
		await page.getByRole('button', { name: 'Annuler', exact: true }).click();
		const dialog = page.getByRole('alertdialog');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
		await expect(title).toHaveValue('');
		diagnostic.phase('pending replay before invalid title validation');
		const replay = page.waitForResponse(
			(response) =>
				response.url() === app.origin + '/api/teaching/modules' &&
				response.request().method() === 'POST'
		);
		await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
		expect((await replay).status()).toBe(200);
		expect(commands[1]).toEqual(commands[0]);
		await expect(title).toHaveValue('');
		await expect(page).toHaveURL(app.origin + '/enseignant/modules/nouveau');
		await expect(
			page.getByText('Brouillon créé. Vos modifications actuelles restent à enregistrer.', {
				exact: true
			})
		).toBeVisible();
		await page.getByRole('button', { name: 'Annuler', exact: true }).click();
		await dialog.getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click();
		await expect(page).toHaveURL(app.origin + '/#modules');
		expect((await listedModuleIds(context, app)).filter((id) => !before.has(id))).toEqual([
			saved.id
		]);
		expect(commands).toHaveLength(2);
		diagnostic.assertClean();
	} catch (error) {
		await diagnostic.failure();
		throw error;
	}
});

test('module creation recovers a committed lost response before saving later edits', async ({
	app,
	page,
	context
}, testInfo) => {
	const diagnostic = clientDiagnostics(page, app, testInfo);
	const moduleIds = async () => {
		const html = await (await context.request.get(app.origin + '/')).text();
		return [
			...new Set(
				[...html.matchAll(/href="\/enseignant\/modules\/([a-f\d-]{36})"/g)].map((match) => match[1])
			)
		];
	};
	try {
		await activate(page, app);
		diagnostic.phase('new module readiness');
		const before = new Set(await moduleIds());
		await page.goto(app.origin + '/enseignant/modules/nouveau');
		await readyModuleEditor(page);
		const title = page.getByLabel('Nom du module (obligatoire)', { exact: true });
		await title.fill('Création fictive originale');
		await moduleSection(page, 'preparation', 'Préparation');
		await page
			.getByLabel('Cadrage pédagogique', { exact: true })
			.fill('Préparation fictive originale');
		await moduleSection(page, 'resources', 'Liens étudiants');
		await page.getByRole('button', { name: 'Ajouter un support', exact: true }).click();
		await page.getByLabel('Intitulé (obligatoire)', { exact: true }).fill('Support fictif');
		await page
			.getByLabel('Lien HTTPS (obligatoire)', { exact: true })
			.fill('https://example.test/support');
		await moduleSection(page, 'planning', 'Classes et planning');
		await page.getByLabel('Classe à associer', { exact: true }).selectOption(app.ids.currentClass);
		await page.getByRole('button', { name: 'Associer cette classe', exact: true }).click();
		await page.getByRole('button', { name: 'Ajouter une séance', exact: true }).click();
		await page
			.getByLabel('Intitulé de la séance (obligatoire)', { exact: true })
			.fill('Séance fictive');
		await page.getByLabel('Début (obligatoire)', { exact: true }).fill('2026-10-20T10:00');
		await page.getByLabel('Fin (obligatoire)', { exact: true }).fill('2026-10-20T11:00');
		await moduleSection(page, 'information', 'Informations');
		const commands: { id: string; payload: ModuleDraft }[] = [];
		const committed = Promise.withResolvers<ModuleDetail>();
		await page.route(app.origin + '/api/teaching/modules', async (route) => {
			const request = route.request();
			if (request.method() !== 'POST') return route.continue();
			commands.push({ id: request.headers()['idempotency-key'], payload: request.postDataJSON() });
			if (commands.length > 1) return route.continue();
			const response = await route.fetch();
			if (response.status() !== 200) throw new Error('Fictional initial creation did not commit.');
			committed.resolve(await response.json());
			await route.abort('failed');
		});
		await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
		diagnostic.phase('committed creation and lost delivery');
		const saved = await committed.promise;
		expect(saved.id).toBe(commands[0].id);
		await expect(
			page.getByText('Connexion interrompue. Vos saisies sont conservées ; réessayez.', {
				exact: true
			})
		).toBeVisible();
		const after = await moduleIds();
		expect(after.filter((id) => !before.has(id))).toEqual([saved.id]);
		const patches: (ModuleDraft & { expectedRevision: number })[] = [];
		await page.route(app.origin + '/api/teaching/modules/' + saved.id, async (route) => {
			if (route.request().method() === 'PATCH') patches.push(route.request().postDataJSON());
			await route.continue();
		});
		diagnostic.phase('edited creation replay');
		await title.fill('Création fictive avec modifications locales');
		await moduleSection(page, 'preparation', 'Préparation');
		await page
			.getByLabel('Cadrage pédagogique', { exact: true })
			.fill('Préparation fictive modifiée localement');
		await moduleSection(page, 'resources', 'Liens étudiants');
		const supportUrl = page.getByLabel('Lien HTTPS (obligatoire)', { exact: true });
		await supportUrl.fill('');
		await moduleSection(page, 'information', 'Informations');
		const replay = page.waitForResponse(
			(response) =>
				response.url() === app.origin + '/api/teaching/modules' &&
				response.request().method() === 'POST'
		);
		await page.getByRole('button', { name: 'Créer le brouillon', exact: true }).click();
		const replayResponse = await replay;
		console.info('Fictional module creation replay status:', replayResponse.status());
		expect(replayResponse.status(), 'Exact original command should recover creation').toBe(200);
		expect(commands[1]).toEqual(commands[0]);
		await expect(title).toHaveValue('Création fictive avec modifications locales');
		await expect(page).toHaveURL(app.origin + '/enseignant/modules/nouveau');
		await expect(
			page.getByText('Brouillon créé. Vos modifications actuelles restent à enregistrer.', {
				exact: true
			})
		).toBeVisible();
		const original = (await (
			await context.request.get(app.origin + '/api/teaching/modules/' + saved.id)
		).json()) as ModuleDetail;
		expect(original.title).toBe('Création fictive originale');
		expect(original.preparation.framing).toBe('Préparation fictive originale');
		expect(original.revision).toBe(1);
		expect(patches).toHaveLength(0);
		await title.fill(original.title);
		await moduleSection(page, 'preparation', 'Préparation');
		await page
			.getByLabel('Cadrage pédagogique', { exact: true })
			.fill(original.preparation.framing);
		await moduleSection(page, 'resources', 'Liens étudiants');
		await supportUrl.fill(original.resources[0].url);
		await moduleSection(page, 'information', 'Informations');
		await expect(page.getByText('Brouillon créé.', { exact: true })).toBeVisible();
		await expect(
			page.getByText('Brouillon créé. Vos modifications actuelles restent à enregistrer.', {
				exact: true
			})
		).not.toBeVisible();
		await title.fill('Création fictive avec modifications locales');
		await moduleSection(page, 'preparation', 'Préparation');
		await page
			.getByLabel('Cadrage pédagogique', { exact: true })
			.fill('Préparation fictive modifiée localement');
		await moduleSection(page, 'resources', 'Liens étudiants');
		await supportUrl.fill('');
		await moduleSection(page, 'information', 'Informations');
		diagnostic.phase('explicit invalid save without PATCH');
		await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).click();
		await expect(
			page.getByText('Vérifiez les champs indiqués. Vos saisies sont conservées.', { exact: true })
		).toBeVisible();
		await expect(page.locator('#module-form')).toHaveAttribute('aria-busy', 'false');
		await expect(
			page.getByRole('button', { name: 'Enregistrer le module', exact: true })
		).toBeEnabled();
		expect(patches).toHaveLength(0);
		await expect(supportUrl).toHaveValue('');
		await supportUrl.fill('https://example.test/support');
		await moduleSection(page, 'information', 'Informations');
		diagnostic.phase('explicit valid PATCH');
		const update = page.waitForResponse(
			(response) =>
				response.url() === app.origin + '/api/teaching/modules/' + saved.id &&
				response.request().method() === 'PATCH'
		);
		await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).click();
		expect((await update).status()).toBe(200);
		expect(patches).toHaveLength(1);
		expect(patches[0].contexts[0].id).toBe(commands[0].payload.contexts[0].id);
		expect(patches[0].contexts[0].expectedRevision).toBe(1);
		expect(patches[0].contexts[0].lessons).toEqual(commands[0].payload.contexts[0].lessons);
		expect(patches[0].resources[0].id).toBe(commands[0].payload.resources[0].id);
		const updated = (await (
			await context.request.get(app.origin + '/api/teaching/modules/' + saved.id)
		).json()) as ModuleDetail;
		expect(updated.title).toBe('Création fictive avec modifications locales');
		expect(updated.preparation.framing).toBe('Préparation fictive modifiée localement');
		expect(updated.contexts[0].lessons).toEqual(original.contexts[0].lessons);
		expect(updated.resources[0].id).toBe(original.resources[0].id);
		await title.fill('Texte local après récupération et PATCH');
		const changed = await context.request.patch(app.origin + '/api/teaching/modules/' + saved.id, {
			headers: { Origin: app.origin },
			data: {
				...editableModule(updated),
				title: 'Autre fenêtre après récupération',
				expectedRevision: updated.revision
			}
		});
		expect(changed.status()).toBe(200);
		diagnostic.phase('later PATCH conflict on recovered nouveau route');
		const conflict = page.waitForResponse(
			(response) =>
				response.url() === app.origin + '/api/teaching/modules/' + saved.id &&
				response.request().method() === 'PATCH'
		);
		await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).click();
		expect((await conflict).status()).toBe(409);
		await expect(title).toHaveValue('Texte local après récupération et PATCH');
		let readFails = true;
		await page.route(app.origin + '/api/teaching/modules/' + saved.id, async (route) => {
			if (route.request().method() === 'GET' && readFails)
				await route.fulfill({ status: 503, json: { message: 'Lecture fictive indisponible.' } });
			else await route.fallback();
		});
		await reloadModule(page);
		await expect(
			page.getByText('Actualisation impossible. Vos saisies sont conservées ; réessayez.', {
				exact: true
			})
		).toBeVisible();
		await expect(page.locator('#module-form')).toHaveAttribute('aria-busy', 'false');
		await expect(title).toHaveValue('Texte local après récupération et PATCH');
		await expect(page.getByText('Version actuelle rechargée.', { exact: true })).not.toBeVisible();
		readFails = false;
		await reloadModule(page);
		await expect(title).toHaveValue('Autre fenêtre après récupération');
		await expect(page.getByText('Version actuelle rechargée.', { exact: true })).toBeVisible();
		await expect(page).toHaveURL(app.origin + '/enseignant/modules/nouveau');
		expect((await moduleIds()).filter((id) => !before.has(id))).toEqual([saved.id]);
		diagnostic.assertClean();
	} catch (error) {
		await diagnostic.failure();
		throw error;
	}
});

test('draft module saves, reloads and retains typed text on HTTP 409', async ({
	app,
	page
}, testInfo) => {
	const diagnostic = clientDiagnostics(page, app, testInfo);
	try {
		await activate(page, app);
		diagnostic.phase('fresh SSR module navigation and readiness');
		await page.goto(app.origin + '/enseignant/modules/' + app.ids.module);
		await readyModuleEditor(page);
		diagnostic.phase('save module');
		const title = page.getByLabel('Nom du module (obligatoire)', { exact: true });
		await title.fill('Brouillon fictif enregistré');
		const saved = page.waitForResponse(
			(response) =>
				response.url().endsWith('/api/teaching/modules/' + app.ids.module) &&
				response.request().method() === 'PATCH'
		);
		await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).click();
		expect((await saved).status()).toBe(200);
		diagnostic.phase('reload module and readiness');
		await page.reload();
		await readyModuleEditor(page);
		await expect(title).toHaveValue('Brouillon fictif enregistré');
		await title.fill('Modification ordinaire après sauvegarde');
		await expect(page.getByText('Modifications non enregistrées.', { exact: true })).toBeVisible();
		await title.fill('Brouillon fictif enregistré');
		await expect(
			page.getByText('Modifications non enregistrées.', { exact: true })
		).not.toBeVisible();
		diagnostic.phase('HTTP409 draft retention');
		await title.fill('Texte fictif conservé pendant le conflit');
		await app.call('conflict-module');
		const conflict = page.waitForResponse(
			(response) =>
				response.url().endsWith('/api/teaching/modules/' + app.ids.module) &&
				response.status() === 409
		);
		await page.getByRole('button', { name: 'Enregistrer le module', exact: true }).click();
		await conflict;
		await expect(page.getByText('Version à actualiser', { exact: true })).toBeVisible();
		await expect(title).toHaveValue('Texte fictif conservé pendant le conflit');
	} catch (error) {
		await diagnostic.failure();
		throw error;
	}
});

test('draft dirty navigation can be cancelled then confirmed with keyboard access', async ({
	app,
	page
}) => {
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/modules/' + app.ids.module);
	await readyModuleEditor(page);
	await page
		.getByLabel('Nom du module (obligatoire)', { exact: true })
		.fill('Modification fictive non enregistrée');
	await page.getByRole('button', { name: 'Annuler', exact: true }).click();
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Continuer à modifier', exact: true }).focus();
	await page.keyboard.press('Enter');
	await expect(dialog).not.toBeVisible();
	await expect(page.getByLabel('Nom du module (obligatoire)', { exact: true })).toHaveValue(
		'Modification fictive non enregistrée'
	);
	await page.getByRole('button', { name: 'Annuler', exact: true }).click();
	await dialog.getByRole('button', { name: 'Quitter sans enregistrer', exact: true }).click();
	await expect(page).toHaveURL(app.origin + '/#modules');
	const mobileNavigation = page.getByRole('button', { name: 'Ouvrir la navigation', exact: true });
	if (await mobileNavigation.isVisible()) await mobileNavigation.click();
	await expect(page.getByRole('link', { name: 'Modules', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
});
