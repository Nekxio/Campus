import { access, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import { hash, adapterPath, requireOwnedOrigin, copyFixture } from './support/fixture-copy.js';
import { startFixture, FixtureStartupError } from './support/process.js';
import type { FixtureSessionState } from '../../scripts/browser-fixture.js';

test('fixture isolation keeps original guards and removes owned storage after failure', async ({
	app,
	page
}) => {
	const differences = Object.entries(app.manifest.files)
		.filter(([, hashes]) => hashes.original !== hashes.copied)
		.map(([file]) => file);
	expect(differences).toEqual([adapterPath]);
	for (const [file, hashes] of Object.entries(app.manifest.files)) {
		expect(hash(await readFile(join(process.cwd(), file)))).toBe(hashes.original);
		expect(hash(await readFile(join(app.manifest.directory, file)))).toBe(hashes.copied);
	}
	expect((await stat(app.manifest.databasePath)).mode & 0o777).toBe(0o600);
	expect(await app.call('probe-adapter')).toBe(true);
	expect(() => requireOwnedOrigin('https://example.test', app.origin)).toThrow();
	await page.goto(app.origin + '/enseignant/classes');
	await expect(page).toHaveURL(app.origin + '/connexion');
	const failed = await startFixture(true).catch((cause: unknown) => cause);
	expect(failed).toBeInstanceOf(FixtureStartupError);
	if (!(failed instanceof FixtureStartupError) || !failed.directory)
		throw new Error('Missing owned failure path.');
	await expect(access(failed.directory)).rejects.toThrow();
	const incompleteSource = join(app.manifest.directory, 'incomplete-owned-source');
	await mkdir(incompleteSource);
	await expect(copyFixture(incompleteSource)).rejects.toThrow();
	expect(await readdir(join(incompleteSource, '.svelte-kit/browser-fixture'))).toEqual([]);
	const serverPid = await app.call<number>('suspend-server');
	expect(() => process.kill(serverPid, 0)).not.toThrow();
	await app.stop();
	expect(() => process.kill(serverPid, 0)).toThrow();
	await expect(access(app.manifest.directory)).rejects.toThrow();
});

test('authentication creates and uses a verified resident passkey', async ({
	app,
	page,
	context
}) => {
	await activate(page, app);
	const response = await context.request.post(app.origin + '/api/auth/sign-out', {
		headers: { Origin: app.origin },
		data: {}
	});
	expect(response.ok()).toBe(true);
	await page.goto(app.origin + '/connexion');
	await page.getByRole('button', { name: 'Me connecter', exact: true }).click();
	await expect(page).toHaveURL(app.origin + '/');
});

test('authentication boundaries refuse anonymous writes before decoding and keep public readers anonymous', async ({
	app,
	page,
	request
}) => {
	const roster = await app.call<{ names: string[] }>('complete-class');
	const mutation = await request.post(app.origin + '/api/teaching/modules', {
		headers: { Origin: app.origin, 'Content-Type': 'application/json' },
		data: '{broken'
	});
	expect(mutation.status()).toBe(401);
	await page.goto(app.origin + '/modules/' + app.ids.publicationContext);
	await expect(
		page.getByRole('heading', { name: 'Application web · publication démo', exact: true })
	).toBeVisible();
	const publicData = await request.get(
		app.origin + '/modules/' + app.ids.publicationContext + '/__data.json'
	);
	expect(publicData.ok()).toBe(true);
	for (const body of [await page.content(), await publicData.text()]) {
		for (const name of roster.names) expect(body).not.toContain(name);
		expect(body).not.toMatch(
			/PRIVATE_BROWSER_COMMENT_MARKER|Préparation privée fictive|private-submission-marker/
		);
		expect(body).not.toMatch(
			/"(?:corrections|scores|retiredScores|semesterComment|submissionUrl|teacherId)"/
		);
	}
});

test('session renewal forwards the same private cookie expiry and refuses expired or revoked sessions', async ({
	app,
	page,
	context
}) => {
	await activate(page, app);
	const credential = async () => {
		const all = await context.cookies(app.origin);
		const session = all.find((cookie) => cookie.name === 'coursely.session_token');
		if (!session) throw new Error('Missing fictional session cookie.');
		return session;
	};
	const before = await credential();
	const initial = await app.call<FixtureSessionState>('session-state');
	expect(initial.count).toBe(1);
	if (!initial.session) throw new Error('Missing fictional session row.');
	// Cookie expiry has second-level precision; cross its original issuance boundary before aging.
	await expect
		.poll(() => Math.floor(Date.now() / 1000), { timeout: 3000, intervals: [25, 50, 100] })
		.toBeGreaterThan(Math.floor(before.expires - 28800));
	const aged = await app.call<FixtureSessionState>('age-session');
	await page.goto(app.origin + '/enseignant/classes');
	await expect(page).toHaveURL(app.origin + '/enseignant/classes');
	const renewed = await credential();
	const stored = await app.call<FixtureSessionState>('session-state');
	expect(stored.count).toBe(1);
	expect(stored.session?.id).toBe(initial.session.id);
	expect(stored.session?.userId).toBe(initial.session.userId);
	expect(stored.session!.expiresAt).toBeGreaterThan(aged.session!.expiresAt);
	expect(
		decodeURIComponent(renewed.value) === decodeURIComponent(before.value),
		'Renewal preserves the same credential in memory'
	).toBe(true);
	expect(renewed.expires).toBeGreaterThan(before.expires);
	expect(renewed.httpOnly).toBe(true);
	expect(renewed.sameSite).toBe('Strict');
	expect(renewed.path).toBe('/');
	expect(renewed.secure).toBe(false);
	await page.reload();
	const again = await credential();
	const unaged = await app.call<FixtureSessionState>('session-state');
	expect(
		decodeURIComponent(again.value) === decodeURIComponent(renewed.value),
		'Immediate read preserves the same credential'
	).toBe(true);
	expect(again.expires).toBe(renewed.expires);
	expect(unaged.session?.expiresAt).toBe(stored.session?.expiresAt);
	const data = await context.request.get(app.origin + '/enseignant/classes/__data.json');
	expect(data.ok()).toBe(true);
	expect(data.headers()['cache-control']).toBe('private, no-store');
	for (const body of [await page.content(), await data.text()]) {
		expect(
			!/"(?:token|session)"\s*:/.test(body),
			'Private page data excludes session credential fields'
		).toBe(true);
		expect(
			!body.includes(renewed.value),
			'Cookie value is not serialized into the private page'
		).toBe(true);
	}
	await app.call('expire-session');
	await page.goto(app.origin + '/enseignant/classes');
	await expect(page).toHaveURL(app.origin + '/connexion');
	expect((await app.call<FixtureSessionState>('session-state')).count).toBe(0);
	expect(
		(await context.cookies(app.origin)).some((cookie) => cookie.name === 'coursely.session_token'),
		'Expired credential removed'
	).toBe(false);
	await page.getByRole('button', { name: 'Me connecter', exact: true }).click();
	await expect(page).toHaveURL(app.origin + '/');
	const signedIn = await app.call<FixtureSessionState>('session-state');
	expect(signedIn.count).toBe(1);
	expect(signedIn.session?.userId).toBe(initial.session.userId);
	await app.call('revoke-session');
	await page.goto(app.origin + '/enseignant/classes');
	await expect(page).toHaveURL(app.origin + '/connexion');
	expect((await app.call<FixtureSessionState>('session-state')).count).toBe(0);
	expect(
		(await context.cookies(app.origin)).some((cookie) => cookie.name === 'coursely.session_token'),
		'Revoked credential removed'
	).toBe(false);
});
