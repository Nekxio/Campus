import type { NativeQuizFixture } from '../../src/lib/server/db/testing/quiz-fixtures.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

for (const failure of ['prepared reload', 'corrected name', 'lost claim response', 'two tabs'] as const) {
	test(`first quiz admission recovers from ${failure}`, async ({ app, page, context }) => {
		await activate(page, app);
		const fixture = await app.call<NativeQuizFixture>('native-quiz');
		const path = `/api/quizzes/${fixture.contextId}/rooms/${fixture.runId}`;
		const teacherPath = `/api/teaching/quiz-rooms/${fixture.runId}`;
		const url = `${app.origin}/modules/${fixture.contextId}/quiz/${fixture.runId}`;
		const opened = await context.request.post(`${app.origin}/api/teaching/quizzes/${fixture.quizId}/rooms`, {
			headers: { Origin: app.origin },
			data: { id: fixture.runId, quizId: fixture.quizId, expectedQuizRevision: fixture.quizRevision }
		});
		expect(opened.status()).toBe(200);
		await context.addInitScript(() => Object.defineProperty(document, 'fullscreenEnabled', { value: false }));
		await page.goto(url);
		const name = page.getByLabel('Votre prénom et nom', { exact: true });
		await name.selectOption(fixture.roster[0].id);
		const join = page.getByRole('button', { name: 'Rejoindre la salle', exact: true });
		if (failure === 'two tabs') {
			const second = await context.newPage();
			await second.goto(url);
			await second.getByLabel('Votre prénom et nom', { exact: true }).selectOption(fixture.roster[1].id);
			const admissionResponses: number[] = [];
			context.on('response', (response) => {
				if (new URL(response.url()).pathname === path && ['PUT', 'POST'].includes(response.request().method()))
					admissionResponses.push(response.status());
			});
			await Promise.all([
				join.click(),
				second.getByRole('button', { name: 'Rejoindre la salle', exact: true }).click()
			]);
			await expect.poll(() => [...admissionResponses].sort()).toEqual([200, 200, 409]);
			const state = await (await context.request.get(app.origin + teacherPath)).json();
			expect(state.view.participants.filter((entry: { status: string }) => entry.status !== 'not_joined')).toHaveLength(
				1
			);
			const publicState = await (await context.request.get(app.origin + path)).json();
			expect(publicState.joined).toBe(true);
			const cookie = (await context.cookies(app.origin + path)).find((entry) => entry.name === 'coursely_quiz');
			expect(cookie?.httpOnly).toBe(true);
			await Promise.all([page.reload(), second.reload()]);
			await expect(page.getByRole('heading', { name: 'Vous êtes dans la salle' })).toBeVisible();
			await expect(second.getByRole('heading', { name: 'Vous êtes dans la salle' })).toBeVisible();
			return;
		}
		let failed = false;
		await page.route('**' + path, async (route) => {
			if (route.request().method() !== 'POST' || failed) return route.continue();
			failed = true;
			if (failure === 'lost claim response') expect((await route.fetch()).status()).toBe(200);
			await route.abort('failed');
		});
		await join.click();
		await expect.poll(() => failed).toBe(true);
		await expect(join).toBeEnabled();
		const cookie = (await context.cookies(app.origin + path)).find((entry) => entry.name === 'coursely_quiz');
		expect(cookie?.httpOnly).toBe(true);
		expect(cookie?.sameSite).toBe('Strict');
		expect(cookie?.path).toBe(path);
		if (failure === 'prepared reload' || failure === 'corrected name') {
			const prepared = await (await context.request.get(app.origin + path)).json();
			expect(prepared).toMatchObject({ joined: false, preparedParticipantId: fixture.roster[0].id });
			await page.reload();
			await expect(name).toHaveValue(fixture.roster[0].id);
			await expect(name).toBeEnabled();
			if (failure === 'corrected name') await name.selectOption(fixture.roster[1].id);
			await join.click();
		} else {
			const started = await context.request.post(app.origin + teacherPath, {
				headers: { Origin: app.origin },
				data: { type: 'start', requestId: crypto.randomUUID() }
			});
			expect(started.status()).toBe(200);
			await join.click();
		}
		if (failure === 'prepared reload' || failure === 'corrected name')
			await expect(page.getByRole('heading', { name: 'Vous êtes dans la salle', exact: true })).toBeVisible();
		else await expect(page.locator('#quiz-question-title')).toBeVisible();
		const recoveredCookie = (await context.cookies(app.origin + path)).find((entry) => entry.name === 'coursely_quiz');
		expect(recoveredCookie?.value).toBe(cookie?.value);
		if (failure === 'corrected name') {
			const state = await (await context.request.get(app.origin + teacherPath)).json();
			expect(state.view.participants[0].status).toBe('not_joined');
			expect(state.view.participants[1].status).toBe('lobby');
			await page.reload();
			await expect(page.getByRole('heading', { name: 'Vous êtes dans la salle', exact: true })).toBeVisible();
		}
	});
}
