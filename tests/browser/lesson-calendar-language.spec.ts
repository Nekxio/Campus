import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('the lesson calendar announces its displayed month in French and retains session days', async ({ app, page }) => {
	await activate(page, app);
	const route = join(app.manifest.directory, 'src/routes/__lesson-calendar-language');
	await mkdir(route, { recursive: true });
	await writeFile(
		join(route, '+page.svelte'),
		`<script lang="ts">
import { page } from '$app/state';
import LessonCalendar from '#lib/components/teacher/LessonCalendar.svelte';
import * as Tooltip from '#lib/components/ui/tooltip/index.js';
const month = $derived(page.url.searchParams.get('mois') ?? '2026-10');
const data = $derived({ month, lessonDates: [month + '-05'], lessonTimes: { [month + '-05']: [
  { startsAt: month + '-05T07:00:00Z', endsAt: month + '-05T09:00:00Z' },
  { startsAt: month + '-05T12:00:00Z', endsAt: month + '-05T14:00:00Z' }
] } });
</script>
<a href="?mois=2026-10">Octobre 2026</a>
<a href="?mois=2027-02">Février 2027</a>
<Tooltip.Provider><LessonCalendar {data} /></Tooltip.Provider>`
	);
	await page.goto(app.origin + '/__lesson-calendar-language');
	const calendar = page.locator('.lesson-calendar');
	await expect(calendar.getByRole('heading', { name: 'Calendrier des séances octobre 2026', exact: true })).toHaveCount(
		1
	);
	await expect(calendar.getByText('lundi 5 octobre 2026, séance planifiée', { exact: true })).toHaveCount(1);
	const day = calendar.getByRole('button', { name: 'lundi 5 octobre 2026, séance planifiée' });
	await day.focus();
	await expect(page.getByRole('tooltip')).toContainText('09 h 00 – 11 h 00');
	await expect(page.getByRole('tooltip')).toContainText('14 h 00 – 16 h 00');
	await page.keyboard.press('Escape');
	await expect(page.getByRole('tooltip')).toBeHidden();
	if ((page.viewportSize()?.width ?? 1440) < 768) await day.tap();
	else await day.click();
	await expect(page.getByRole('tooltip')).toBeVisible();
	await page.getByRole('link', { name: 'Février 2027', exact: true }).focus();
	await page.keyboard.press('Enter');
	await expect(calendar.getByRole('heading', { name: 'Calendrier des séances février 2027', exact: true })).toHaveCount(
		1
	);
	await expect(calendar.getByText('vendredi 5 février 2027, séance planifiée', { exact: true })).toHaveCount(1);
	await page.goBack();
	await expect(calendar.getByRole('heading', { name: 'Calendrier des séances octobre 2026', exact: true })).toHaveCount(
		1
	);
	await expect(calendar.getByRole('button', { name: 'lundi 5 octobre 2026, séance planifiée' })).toHaveCount(1);
});
