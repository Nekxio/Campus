import type { Page } from '@playwright/test';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';

const chooseSection = async (page: Page, title: string) => {
	const select = page.getByLabel('Section du barème', { exact: true });
	await expect(async () => {
		if (await select.isVisible()) {
			const option = select.getByRole('option').filter({ hasText: title });
			await select.selectOption((await option.getAttribute('value'))!);
		} else await page.getByRole('tab', { name: new RegExp(`^${title}`) }).click();
		await expect(page.getByRole('tabpanel').getByLabel('Nom de la section', { exact: true })).toHaveValue(title, {
			timeout: 1000
		});
	}).toPass({ timeout: 60000 });
};

test('rubric navigation retains draft fields and header save synchronizes both controls', async ({
	page,
	app
}, info) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}/bareme?retour=module`);
	await chooseSection(page, 'Projet');
	await expect(page.getByRole('navigation', { name: 'Sections du barème', exact: true })).toHaveCount(0);
	const saves = page.getByRole('button', { name: 'Enregistrer le barème', exact: true });
	await expect(saves).toHaveCount(2);
	await expect(saves.first()).toBeDisabled();
	await expect(saves.last()).toBeDisabled();
	const name = page.getByRole('tabpanel').getByLabel('Nom de la section', { exact: true });
	await name.fill('Projet ajusté démo');
	await chooseSection(page, 'Quiz');
	await chooseSection(page, 'Projet ajusté démo');
	await expect(saves.first()).toBeEnabled();
	await expect(saves.last()).toBeEnabled();
	const saved = page.waitForResponse(
		(response) => response.request().method() === 'POST' && response.url().includes('?/saveRubric')
	);
	await saves.first().click();
	expect((await saved).ok()).toBe(true);
	await expect(saves.first()).toBeDisabled();
	await expect(saves.last()).toBeDisabled();
	await page.reload();
	await chooseSection(page, 'Projet ajusté démo');
	const geometry = await page.evaluate(() => {
		const bounds = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
		const definition = bounds('#rubric-definition');
		const calculation = bounds('#rubric-calculation');
		const deadlines = bounds('.deadline-surface');
		const legend = bounds('#echeances > legend');
		const list = document.querySelector('.section-list')!;
		return {
			pageOverflow: document.documentElement.scrollWidth - innerWidth,
			listOverflow: list.scrollWidth - list.clientWidth,
			calculationBelow: calculation.top >= definition.bottom,
			legendContained: legend.top >= deadlines.top && legend.left >= deadlines.left && legend.right <= deadlines.right
		};
	});
	expect(geometry.pageOverflow).toBeLessThanOrEqual(1);
	expect(geometry.listOverflow).toBeLessThanOrEqual(1);
	expect(geometry.calculationBelow).toBe(true);
	expect(geometry.legendContained).toBe(true);
	await page.getByText('Configurer les résultats existants', { exact: true }).click();
	for (const summary of await page.locator('.component-editor details > summary').all()) await summary.click();
	const checkboxes = page.locator('.assessment-options [data-slot="checkbox"]');
	await expect(checkboxes.first()).toBeVisible();
	for (const checkbox of await checkboxes.all()) {
		await expect(checkbox).toHaveCSS('width', '20px');
		await expect(checkbox).toHaveCSS('height', '20px');
	}
	await page.screenshot({ path: info.outputPath('rubric-expanded-entry.png'), fullPage: true });
});

test('lesson fields use available width and keep the removal action with their heading', async ({
	page,
	app
}, info) => {
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.publicationModule}`);
	await readyModuleEditor(page);
	const section = page.getByLabel('Section du module', { exact: true });
	if (await section.isVisible()) await section.selectOption('planning');
	else await page.getByRole('tab', { name: 'Classe et planning', exact: false }).click();
	const lesson = page.locator('.planning-lesson').first();
	await expect(lesson.getByLabel('Intitulé de la séance', { exact: true })).toHaveValue('Du brief à la navigation');
	const bounds = await lesson.evaluate((element) => {
		const box = (selector: string) => {
			const rect = element.querySelector(selector)!.getBoundingClientRect();
			return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width };
		};
		return {
			heading: box('.lesson-heading'),
			remove: box('button'),
			title: box('input[id$="-title"]'),
			start: box('input[id$="-startsAt"]'),
			end: box('input[id$="-endsAt"]'),
			recap: box('textarea[id$="-recap"]'),
			toDo: box('textarea[id$="-toDo"]'),
			viewport: innerWidth,
			pageWidth: document.documentElement.scrollWidth
		};
	});
	expect(bounds.remove.y).toBeGreaterThanOrEqual(bounds.heading.y);
	expect(bounds.remove.bottom).toBeLessThanOrEqual(bounds.heading.bottom);
	expect(bounds.pageWidth).toBeLessThanOrEqual(bounds.viewport + 1);
	expect(bounds.recap.y).toBeGreaterThan(bounds.start.y);
	expect(bounds.recap.y).toBeGreaterThan(bounds.end.y);
	if (bounds.viewport >= 1440) {
		expect(bounds.title.y).toBe(bounds.start.y);
		expect(bounds.start.y).toBe(bounds.end.y);
		expect(bounds.recap.y).toBe(bounds.toDo.y);
		expect(bounds.start.width).toBeGreaterThanOrEqual(224);
	} else expect(bounds.toDo.y).toBeGreaterThan(bounds.recap.y);
	await page.screenshot({ path: info.outputPath('lesson-rows.png'), fullPage: true });
});

test('a long section index scrolls vertically without clipping keyboard focus', async ({ page, app }, info) => {
	test.skip(info.project.name !== 'desktop', 'The same test checks the narrow selector after the desktop index.');
	await page.setViewportSize({ width: 1728, height: 900 });
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}/bareme?retour=module`);
	await chooseSection(page, 'Projet');
	for (let index = 0; index < 6; index++) {
		await page.getByRole('button', { name: 'Ajouter une section', exact: true }).click();
		await page
			.getByRole('tabpanel')
			.getByLabel('Nom de la section', { exact: true })
			.fill(`Section fictive ${index + 1} · RéférencesSansEspacesQuiDoiventRevenirÀLaLigneDansLeMenu`);
	}
	const list = page.getByRole('tablist', { name: 'Sections du module', exact: true });
	const selected = list.getByRole('tab', { selected: true });
	await selected.focus();
	await page.keyboard.press('Tab');
	await page.keyboard.press('Shift+Tab');
	await expect(selected).toBeFocused();
	expect(await selected.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
	const geometry = await list.evaluate((element) => {
		const focused = element.querySelector(':focus')!;
		const list = element.getBoundingClientRect();
		const choice = focused.getBoundingClientRect();
		const style = getComputedStyle(focused);
		const outline = Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset);
		return {
			height: element.clientHeight,
			hasScroll: element.scrollHeight > element.clientHeight,
			overflow: element.scrollWidth - element.clientWidth,
			labelsContained: [...element.querySelectorAll('[role="tab"]')].every(
				(choice) => choice.scrollHeight <= choice.clientHeight + 1
			),
			focusInside:
				choice.left - outline >= list.left &&
				choice.right + outline <= list.right &&
				choice.bottom + outline <= list.bottom
		};
	});
	expect(geometry.height).toBeLessThanOrEqual(320);
	expect(geometry.hasScroll).toBe(true);
	expect(geometry.overflow).toBeLessThanOrEqual(1);
	expect(geometry.labelsContained).toBe(true);
	expect(geometry.focusInside).toBe(true);
	await page.screenshot({ path: info.outputPath('long-section-index-focus.png'), fullPage: true });
	await page.setViewportSize({ width: 320, height: 740 });
	await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
	const select = page.getByLabel('Section du barème', { exact: true });
	await expect(select).toBeVisible();
	await select.focus();
	await expect(select).toBeFocused();
	await select.selectOption({ label: 'Quiz' });
	await expect(page.getByRole('tabpanel').getByLabel('Nom de la section', { exact: true })).toHaveValue('Quiz');
	await page.screenshot({ path: info.outputPath('narrow-section-selector-dark.png'), fullPage: true });
	const overflow = await page.evaluate(() => ({
		width: document.documentElement.scrollWidth - innerWidth,
		elements: [...document.querySelectorAll('main *')]
			.filter((element) => element.getBoundingClientRect().right > innerWidth)
			.map((element) => ({
				tag: element.tagName,
				class: element.className,
				text: element.textContent?.slice(0, 150),
				width: element.getBoundingClientRect().width
			}))
	}));
	expect(overflow.width, JSON.stringify(overflow.elements)).toBeLessThanOrEqual(1);
});
