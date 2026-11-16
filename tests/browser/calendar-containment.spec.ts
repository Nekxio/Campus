import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

const months = [
	{ value: '2026-10', label: 'octobre 2026', days: 31, rows: 5, dates: [28, 31] },
	{ value: '2026-02', label: 'février 2026', days: 28, rows: 5, dates: [25, 28] },
	{ value: '2028-02', label: 'février 2028', days: 29, rows: 5, dates: [28, 29] },
	{ value: '2026-04', label: 'avril 2026', days: 30, rows: 5, dates: [28, 30] },
	{ value: '2026-08', label: 'août 2026', days: 31, rows: 6, dates: [28, 31] }
];

test('lesson dates and markers stay inside padded calendar cells in short and long months', async ({
	app,
	page
}, info) => {
	await activate(page, app);
	const route = join(app.manifest.directory, 'src/routes/__calendar-containment');
	await mkdir(route, { recursive: true });
	await writeFile(
		join(route, '+page.svelte'),
		`<script lang="ts">
import { page } from '$app/state';
import TeacherHome from '#lib/components/teacher/TeacherHome.svelte';
import type { HomeData } from '#lib/teaching/types.js';
const months = ${JSON.stringify(months)};
const selected = $derived(months.find((month) => month.value === page.url.searchParams.get('mois')) ?? months[0]);
const data: HomeData = $derived({
	modules: [],
	calendar: { month: selected.value, lessonDates: selected.dates.map((day) => selected.value + '-' + day) },
	nextLesson: null
});
</script>
<TeacherHome userName="Enseignant fictif" {data} />`
	);
	const measurements = [];
	const widths = info.project.name === 'mobile' ? [375, 320, 390] : [1728, 1280];
	for (const width of widths) {
		await page.setViewportSize({ width, height: width < 400 ? 667 : 851 });
		for (const theme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
			for (const month of months) {
				await page.goto(`${app.origin}/__calendar-containment?mois=${month.value}`);
				await page.waitForLoadState('networkidle');
				const disclosure = page.locator('.mobile-calendar:visible');
				if (await disclosure.isVisible()) {
					await disclosure.locator('summary').focus();
					await page.keyboard.press('Enter');
				}
				const calendar = page.locator('.lesson-calendar:visible');
				await expect(calendar.getByText(month.label, { exact: true })).toBeVisible();
				const previous = calendar.getByRole('button', { name: 'Mois précédent', exact: true });
				await previous.focus();
				await expect(previous).toBeFocused();
				const geometry = await calendar.evaluate((container) => {
					const grid = container.querySelector('[role="grid"]');
					const root = grid?.closest('[data-calendar-root]');
					if (!grid || !root) throw new Error('Calendar root and grid are required.');
					const box = (element: Element) => {
						const { x, y, width, height, bottom, right } = element.getBoundingClientRect();
						return { x, y, width, height, bottom, right };
					};
					const headers = [...grid.querySelectorAll('th')].map(box);
					const rows = [...grid.querySelectorAll('tbody tr')].map((row) =>
						[...row.querySelectorAll('td')].map((cell) => {
							const day = cell.querySelector('.lesson-day');
							const number = day?.querySelector('span[aria-hidden="true"]');
							const marker = day?.querySelector('.lesson-dot');
							return {
								cell: box(cell),
								day: day ? box(day) : null,
								number: number ? box(number) : null,
								marker: marker ? box(marker) : null
							};
						})
					);
					return {
						root: box(root),
						grid: box(grid),
						days: grid.querySelectorAll('.lesson-day:not(.outside)').length,
						headers,
						rows,
						controls: [...root.querySelectorAll('button')].map(box),
						overflow: document.documentElement.scrollWidth - window.innerWidth
					};
				});
				measurements.push({ width, theme, month: month.value, ...geometry });
				await writeFile(info.outputPath('calendar-containment.json'), JSON.stringify(measurements, null, 2));
				if (month.value === '2026-10' || month.rows === 6)
					await calendar.screenshot({
						path: info.outputPath(`calendar-${width}-${theme}-${month.value}.png`)
					});
				expect(geometry.rows).toHaveLength(month.rows);
				expect(geometry.days).toBe(month.days);
				expect(geometry.headers).toHaveLength(7);
				expect(geometry.overflow).toBeLessThanOrEqual(1);
				expect(geometry.grid.x - geometry.root.x, 'Room for left focus outline').toBeGreaterThan(3);
				expect(geometry.root.right - geometry.grid.right, 'Room for right focus outline').toBeGreaterThan(3);
				expect(geometry.root.bottom - geometry.grid.bottom, 'Room below the last week').toBeGreaterThan(3);
				const marked = geometry.rows.flat().filter((day) => day.marker);
				expect(marked).toHaveLength(month.dates.length);
				for (const row of geometry.rows) {
					expect(row).toHaveLength(7);
					for (const [index, { cell, day, marker, number }] of row.entries()) {
						expect(
							Math.abs(cell.x + cell.width / 2 - geometry.headers[index].x - geometry.headers[index].width / 2)
						).toBeLessThanOrEqual(1);
						expect(day).not.toBeNull();
						expect(day!.height).toBeLessThanOrEqual(cell.height + 1);
						if (marker && number) {
							expect(marker.y).toBeGreaterThanOrEqual(number.bottom);
							expect(marker.bottom).toBeLessThanOrEqual(cell.bottom);
							expect(marker.bottom).toBeLessThan(geometry.root.bottom - 3);
						}
					}
				}
				for (const control of geometry.controls) {
					expect(control.width).toBeGreaterThanOrEqual(44);
					expect(control.height).toBeGreaterThanOrEqual(44);
					expect(control.x - geometry.root.x).toBeGreaterThan(3);
					expect(control.y - geometry.root.y).toBeGreaterThan(3);
				}
			}
		}
	}
});
