import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

type RenderSample = {
	elapsed: number;
	controlAvailable: boolean;
	closingNavigation: boolean;
	snapshotAnimation: string;
	snapshotHeight: string;
};
type RenderProbe = {
	samples: RenderSample[];
	readyAt: number;
	longTasks: number[];
};

const recordNavigation = async (page: Page, href: string, title: string) => {
	const result = page.evaluate(
		async ({ href, title }): Promise<RenderProbe> => {
			const samples: RenderSample[] = [];
			const longTasks: number[] = [];
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) longTasks.push(entry.duration);
			});
			observer.observe({ type: 'longtask' });
			const startedAt = performance.now();
			let readyAt = 0;
			return new Promise((resolve, reject) => {
				let frameId = 0;
				const timeout = setTimeout(() => {
					cancelAnimationFrame(frameId);
					observer.disconnect();
					reject(new Error('Navigation did not render.'));
				}, 15000);
				const frame = () => {
					const heading = document.querySelector('h1');
					if (location.pathname === href && heading?.textContent?.trim() === title) {
						readyAt ||= performance.now();
						const control = document.querySelector('[aria-label="Choisir le thème"]');
						const bounds = control?.getBoundingClientRect();
						const target = bounds
							? document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
							: null;
						const snapshot = getComputedStyle(document.documentElement, '::view-transition-group(workspace)');
						samples.push({
							elapsed: performance.now() - readyAt,
							controlAvailable: !!target && !!control?.contains(target),
							closingNavigation: !!document.querySelector('[data-mobile="true"][data-state="closed"]'),
							snapshotAnimation: snapshot.animationName,
							snapshotHeight: snapshot.height
						});
					}
					if (readyAt && performance.now() - readyAt >= 500) {
						clearTimeout(timeout);
						observer.disconnect();
						resolve({ samples, readyAt: readyAt - startedAt, longTasks });
					} else frameId = requestAnimationFrame(frame);
				};
				frameId = requestAnimationFrame(frame);
			});
		},
		{ href, title }
	);
	await page.locator(`a[href="${href}"]`).first().click();
	return result;
};

test('rendered page controls remain available during navigation with motion enabled', async ({ page, app }, info) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await activate(page, app);
	await page.goto(app.origin + '/enseignant/modules');
	await expect(page.getByRole('heading', { name: 'Mes modules', exact: true })).toBeVisible();
	const theme = page.getByRole('button', { name: 'Choisir le thème', exact: true });
	await expect(async () => {
		await theme.click();
		await expect(page.getByRole('menu')).toBeVisible({ timeout: 1000 });
	}).toPass();
	await page.keyboard.press('Escape');
	const results: RenderProbe[] = [];
	for (const [href, title] of [
		['/enseignant/classes', 'Mes classes'],
		['/enseignant/modules', 'Mes modules'],
		['/enseignant/classes', 'Mes classes']
	]) {
		if (info.project.name === 'mobile') {
			await page.getByRole('button', { name: 'Ouvrir la navigation', exact: true }).click();
		}
		results.push(await recordNavigation(page, href, title));
		await expect(page.getByRole('dialog', { name: 'Navigation principale', exact: true })).toBeHidden();
	}
	await writeFile(info.outputPath('rendering.json'), JSON.stringify(results, null, 2));
	console.info(
		'Navigation rendering:',
		results.map((result) => ({
			readyMs: Math.round(result.readyAt),
			blockedFrames: result.samples.filter((sample) => !sample.controlAvailable && !sample.closingNavigation).length,
			menuClosingFrames: result.samples.filter((sample) => sample.closingNavigation).length,
			lastBlockedMs: Math.round(
				result.samples.findLast((sample) => !sample.controlAvailable && !sample.closingNavigation)?.elapsed ?? 0
			),
			longTasks: result.longTasks.map(Math.round),
			snapshotAnimations: [...new Set(result.samples.map((sample) => sample.snapshotAnimation))]
		}))
	);
	for (const result of results) {
		expect(result.samples.some((sample) => sample.controlAvailable)).toBe(true);
		// A closing modal intentionally shields the page until its local exit animation finishes.
		expect(result.samples.filter((sample) => !sample.controlAvailable && !sample.closingNavigation)).toEqual([]);
	}
});
