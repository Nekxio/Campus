import { createClient } from '@libsql/client';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../../src/lib/server/db/index.js';
import * as tables from '../../src/lib/server/db/schema.js';
import { test, expect } from './fixtures.js';

test('public directories identify the class and year with and without published modules', async ({
	app,
	page,
	request
}, info) => {
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	const classId = crypto.randomUUID();
	try {
		await createDatabase(client)
			.insert(tables.classes)
			.values({ id: classId, name: 'Classe sans publication', academicYear: '2027-2028' });
	} finally {
		client.close();
	}
	for (const [id, name, year, empty] of [
		[classId, 'Classe sans publication', '2027-2028', true],
		[app.ids.currentClass, 'B2 Demo', '2026-2027', false]
	] as const) {
		const response = await page.goto(`${app.origin}/classes/${id}`);
		expect(response?.headers()['cache-control']).toContain('no-store');
		expect(response?.headers()['x-robots-tag']).toContain('noindex');
		await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
		await expect(page.getByText(`Année ${year}`, { exact: true })).toBeVisible();
		if (empty) {
			await expect(page.getByText('Aucun module publié pour le moment', { exact: true })).toBeVisible();
			await expect(page.getByRole('contentinfo')).toBeInViewport();
			const geometry = await page.evaluate(() => {
				const main = document.querySelector('main')!.getBoundingClientRect();
				const footer = document.querySelector('footer')!.getBoundingClientRect();
				return {
					overflow: document.documentElement.scrollHeight - innerHeight,
					footerBottom: footer.bottom,
					viewportHeight: innerHeight,
					contentBottom: main.bottom,
					footerTop: footer.top
				};
			});
			expect(
				geometry.overflow,
				'A short class page does not force scrolling just to reach the footer'
			).toBeLessThanOrEqual(1);
			expect(
				Math.abs(geometry.footerBottom - geometry.viewportHeight),
				'The footer reaches the viewport bottom'
			).toBeLessThanOrEqual(1);
			expect(geometry.contentBottom).toBeLessThanOrEqual(geometry.footerTop + 1);
		} else {
			const course = page.getByRole('link', { name: /^Ouvrir le cours/ }).first();
			await course.focus();
			await expect(course).toBeFocused();
		}
		const data = await request.get(`${app.origin}/classes/${id}/__data.json`);
		expect(data.status()).toBe(200);
		expect(await data.text()).not.toMatch(/Aline Moreau|PRIVATE_BROWSER|private-submission|sourcePath|passkey/);
		expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
		await page.screenshot({
			path: info.outputPath(empty ? 'public-directory-empty.png' : 'public-directory-published.png'),
			fullPage: true
		});
	}
});
