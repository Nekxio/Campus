import type { Page, Route } from '@playwright/test';
import { test, expect } from './fixtures.js';
import type { PublicQuizList } from '../../src/lib/quizzes/student-client.js';

const rooms: PublicQuizList = [
	{
		id: '9a7de9b8-1c76-4721-b144-f52bebd54d01',
		title: 'Quiz disponible',
		lessonId: '9a7de9b8-1c76-4721-b144-f52bebd54d02',
		durationSeconds: 600,
		status: 'lobby',
		runId: '9a7de9b8-1c76-4721-b144-f52bebd54d03'
	}
];

const selectSection = async (page: Page, name: string) => {
	if (page.viewportSize()!.width >= 1024) {
		const tab = page.getByRole('tab', { name, exact: true });
		await expect(async () => {
			await tab.click({ timeout: 1000 });
			await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
		}).toPass({ timeout: 30000 });
		return;
	}
	const dialog = page.getByRole('dialog', { name: 'Contenu du cours', exact: true });
	await expect(async () => {
		await page.getByRole('button', { name: /^Changer de rubrique :/ }).click();
		await expect(dialog).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 30000 });
	await dialog.getByRole('button', { name, exact: true }).click();
	await expect(dialog).toHaveCount(0);
};

const setDocumentVisible = async (page: Page, visible: boolean) =>
	page.evaluate((value) => {
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			value: value ? 'visible' : 'hidden'
		});
		Object.defineProperty(document, 'hidden', { configurable: true, value: !value });
		document.dispatchEvent(new Event('visibilitychange'));
	}, visible);

test('public quiz polling follows the active section and document visibility', async ({ app, page }) => {
	let requests = 0;
	await page.route(`**/api/quizzes/${app.ids.publicationContext}`, (route) => {
		requests += 1;
		return route.fulfill({ json: rooms });
	});
	await page.clock.install();
	await page.goto(`${app.origin}/modules/${app.ids.publicationContext}`);
	await selectSection(page, 'Consignes et barèmes');
	await selectSection(page, 'Supports du cours');
	await page.clock.runFor(45_000);
	expect(requests).toBe(0);

	await selectSection(page, 'Quiz');
	const section = page.getByRole('region', { name: 'Quiz en classe', exact: true });
	await expect(section.getByRole('heading', { name: rooms[0].title, exact: true })).toBeVisible();
	expect(requests).toBe(1);
	await page.clock.runFor(20_000);
	await expect.poll(() => requests).toBe(2);

	await selectSection(page, 'Supports du cours');
	await page.clock.runFor(45_000);
	expect(requests).toBe(2);
	await setDocumentVisible(page, false);
	await setDocumentVisible(page, true);
	await page.clock.runFor(20_000);
	expect(requests).toBe(2);

	await selectSection(page, 'Quiz');
	await expect.poll(() => requests).toBe(3);
	await expect(section.getByRole('button', { name: 'Actualiser les salles', exact: true })).toBeEnabled();
	await setDocumentVisible(page, false);
	await page.clock.runFor(45_000);
	expect(requests).toBe(3);
	await setDocumentVisible(page, true);
	await expect.poll(() => requests).toBe(4);
	await page.clock.runFor(20_000);
	await expect.poll(() => requests).toBe(5);

	await page.getByRole('link', { name: 'Retour à la classe', exact: true }).click();
	await expect(page).toHaveURL(/\/classes\//);
	await page.clock.runFor(45_000);
	expect(requests).toBe(5);
});

test('wide quiz sections retain loaded rooms and do not overlap refreshes after repeated visits', async ({
	app,
	page
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'Wide tabs retain their mounted content.');
	let requests = 0;
	let holdResponse = false;
	const pending: Route[] = [];
	await page.route(`**/api/quizzes/${app.ids.publicationContext}`, (route) => {
		requests += 1;
		if (holdResponse) {
			pending.push(route);
			return;
		}
		return route.fulfill({ json: rooms });
	});
	await page.clock.install();
	await page.goto(`${app.origin}/modules/${app.ids.publicationContext}`);
	await selectSection(page, 'Quiz');
	const section = page.getByRole('region', { name: 'Quiz en classe', exact: true });
	const room = section.getByRole('heading', { name: rooms[0].title, exact: true });
	await expect(room).toBeVisible();
	expect(requests).toBe(1);

	for (let repetition = 0; repetition < 3; repetition += 1) {
		await selectSection(page, 'Supports du cours');
		holdResponse = true;
		await selectSection(page, 'Quiz');
		await expect.poll(() => pending.length).toBe(1);
		await expect(room).toBeVisible();
		await expect(section.getByText('Recherche des salles ouvertes…', { exact: true })).toHaveCount(0);
		await page.clock.runFor(45_000);
		expect(requests).toBe(repetition + 2);
		expect(pending).toHaveLength(1);
		holdResponse = false;
		await pending.pop()!.fulfill({ json: rooms });
		await expect(section.getByRole('button', { name: 'Actualiser les salles', exact: true })).toBeEnabled();
	}
});
