import { writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('lesson calendar keeps its title and weekday columns aligned in both themes', async ({ page, app }, info) => {
	await activate(page, app);
	const expandable = page.locator('details').filter({
		has: page.getByText('Afficher le calendrier du mois', { exact: true })
	});
	if (await expandable.isVisible()) {
		await expandable.locator('summary').focus();
		await page.keyboard.press('Enter');
		await expect(expandable).toHaveAttribute('open', '');
	}
	const calendar = page.locator('.lesson-calendar:visible');
	await expect(calendar).toHaveCount(1);
	const measurements = [];
	for (const theme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
		await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
		await page.evaluate(() => document.fonts.ready);
		const geometry = await calendar.evaluate((root) => {
			const box = (element: Element | Range) => {
				const { x, y, width, height } = element.getBoundingClientRect();
				return { x, y, width, height, center: x + width / 2 };
			};
			const heading = root.querySelector('[data-calendar-header]');
			const grid = root.querySelector('[role="grid"]');
			if (!heading || !grid) throw new Error('Visible calendar structure missing.');
			const title = document.createRange();
			title.selectNodeContents(heading);
			const headers = [...grid.querySelectorAll('th')].map(box);
			const rows = [...grid.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map(box));
			return {
				heading: box(title),
				grid: box(grid),
				headers,
				rows,
				overflow: document.documentElement.scrollWidth - window.innerWidth,
				buttons: root.querySelectorAll('button').length
			};
		});
		measurements.push({ theme, viewport: page.viewportSize(), ...geometry });
		await calendar.screenshot({ path: info.outputPath(`calendar-${theme}.png`) });
		expect(Math.abs(geometry.heading.center - geometry.grid.center)).toBeLessThanOrEqual(1);
		expect(geometry.headers).toHaveLength(7);
		expect(geometry.rows.length).toBeGreaterThanOrEqual(4);
		for (const row of geometry.rows) {
			expect(row).toHaveLength(7);
			for (const [index, cell] of row.entries()) {
				expect(Math.abs(cell.center - geometry.headers[index].center)).toBeLessThanOrEqual(1);
			}
			const center = (row[0].x + row[6].x + row[6].width) / 2;
			expect(Math.abs(center - geometry.grid.center)).toBeLessThanOrEqual(1);
		}
		expect(geometry.overflow).toBeLessThanOrEqual(1);
		await expect(calendar.getByRole('button', { name: 'Mois précédent', exact: true })).toBeVisible();
		await expect(calendar.getByRole('button', { name: 'Mois suivant', exact: true })).toBeVisible();
		expect(geometry.buttons).toBeGreaterThanOrEqual(2);
	}
	await writeFile(info.outputPath('calendar-geometry.json'), JSON.stringify(measurements, null, 2));
});
