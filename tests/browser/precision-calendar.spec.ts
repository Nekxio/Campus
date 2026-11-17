import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { createDatabase } from '../../src/lib/server/db/index.js';
import * as tables from '../../src/lib/server/db/schema.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('the calendar shows the next lesson, browses real month data and handles year boundaries', async ({
	app,
	page
}, info) => {
	page.setDefaultTimeout(15000);
	page.setDefaultNavigationTimeout(15000);
	await activate(page, app);
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		await createDatabase(client)
			.insert(tables.lessons)
			.values([
				{
					contextId: app.ids.currentContext,
					title: 'Séance du mois suivant',
					startsAt: new Date('2026-11-02T08:00:00Z'),
					endsAt: new Date('2026-11-02T10:00:00Z')
				},
				{
					contextId: app.ids.currentContext,
					title: 'Autre séance de novembre',
					startsAt: new Date('2026-11-15T08:00:00Z'),
					endsAt: new Date('2026-11-15T10:00:00Z')
				},
				{
					contextId: app.ids.currentContext,
					title: 'Séance du nouvel an à Paris',
					startsAt: new Date('2026-12-31T23:30:00Z'),
					endsAt: new Date('2027-01-01T01:00:00Z')
				}
			]);
	} finally {
		client.close();
	}
	const directory = join(app.manifest.directory, 'src/routes/__precision-calendar');
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(directory, '+page.svelte'),
		`<script lang="ts">
import TeacherHome from '#lib/components/teacher/TeacherHome.svelte';
import type { HomeData } from '#lib/teaching/types.js';
let { data }: { data: HomeData } = $props();
</script>
<TeacherHome userName="Enseignant fictif" {data} />`
	);
	await writeFile(
		join(directory, '+page.server.ts'),
		`import { requireTeacherPage } from '#lib/server/auth/page-access.js';
import { withTeacherDatabase } from '#lib/server/teaching/database.js';
import { getHomeData } from '#lib/server/teaching/service.js';
import { validTeachingMonth } from '#lib/teaching/calendar.js';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals, url }) => {
requireTeacherPage(locals);
const now = new Date(url.searchParams.has('noLesson') ? '2028-12-31T23:30:00Z' : '2026-10-29T12:00:00Z');
return withTeacherDatabase(locals, (db) => getHomeData(db, now, validTeachingMonth(url.searchParams.get('mois'))));
};`
	);
	const openCalendar = async (query = '') => {
		await page.goto(app.origin + '/__precision-calendar' + query);
		await page.waitForLoadState('networkidle');
		const disclosure = page.locator('.mobile-calendar:visible');
		if (await disclosure.isVisible()) await disclosure.locator('summary').click();
	};
	await openCalendar();
	const calendar = page.locator('.lesson-calendar:visible');
	await expect(calendar.getByText('novembre 2026', { exact: true })).toBeVisible();
	await expect(calendar.getByText('lundi 2 novembre 2026, séance planifiée', { exact: true })).toBeVisible();
	await expect(calendar.getByText('dimanche 15 novembre 2026, séance planifiée', { exact: true })).toBeVisible();
	const previous = calendar.getByRole('button', { name: 'Mois précédent', exact: true });
	await previous.focus();
	await page.keyboard.press('Enter');
	await expect(calendar.getByText('octobre 2026', { exact: true })).toBeVisible();
	await expect(previous).toBeFocused();
	await calendar.getByRole('button', { name: 'Mois de la prochaine séance', exact: true }).click();
	await expect(calendar.getByText('novembre 2026', { exact: true })).toBeVisible();
	const next = calendar.getByRole('button', { name: 'Mois suivant', exact: true });
	await next.click();
	await expect(calendar.getByText('décembre 2026', { exact: true })).toBeVisible();
	await next.click();
	await expect(calendar.getByText('janvier 2027', { exact: true })).toBeVisible();
	await expect(calendar.getByText('vendredi 1 janvier 2027, séance planifiée', { exact: true })).toBeVisible();
	await expect(page.getByText('Séance du mois suivant', { exact: true })).toBeVisible();
	await page.goBack();
	await expect(calendar.getByText('décembre 2026', { exact: true })).toBeVisible();
	await page.reload();
	await page.waitForLoadState('networkidle');
	const disclosure = page.locator('.mobile-calendar:visible');
	if (await disclosure.isVisible()) await disclosure.locator('summary').click();
	await expect(calendar.getByText('décembre 2026', { exact: true })).toBeVisible();
	await openCalendar('?mois=2026-13');
	await expect(calendar.getByText('novembre 2026', { exact: true })).toBeVisible();
	await openCalendar('?noLesson=1');
	await expect(calendar.getByText('janvier 2029', { exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Aucune séance à venir', exact: true })).toBeVisible();
	await expect(calendar.getByText('Aucune séance planifiée pour ce mois.', { exact: true })).toBeVisible();
	for (const width of info.project.name === 'mobile' ? [375, 390] : [1280, 1728]) {
		await page.setViewportSize({ width, height: width === 375 ? 667 : 900 });
		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
			await openCalendar();
			await expect(calendar.getByText('novembre 2026', { exact: true })).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
			for (const control of [previous, next]) {
				const box = await control.boundingBox();
				expect(box?.width).toBeGreaterThanOrEqual(44);
				expect(box?.height).toBeGreaterThanOrEqual(44);
			}
			await page.screenshot({
				path: info.outputPath(`calendar-${width}-${colorScheme}.png`),
				fullPage: true
			});
		}
	}
});
