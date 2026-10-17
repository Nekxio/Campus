import { writeFile } from 'node:fs/promises';
import type { Locator } from '@playwright/test';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';

test('fields, dense grading and containers retain readable spacing and keyboard focus', async ({
	page,
	app
}, testInfo) => {
	test.setTimeout(360000);
	const measures: Record<string, unknown>[] = [];
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
	async function capture(name: string, field?: Locator, fullPage = true) {
		await page.evaluate(() => document.fonts.ready);
		await page.screenshot({ path: testInfo.outputPath(`${name}-rest.png`), fullPage });
		const state = await page.evaluate(() => ({
			overflow: document.documentElement.scrollWidth - innerWidth,
			fields: [
				...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
					'[data-slot="input"], [data-slot="textarea"], [data-slot="native-select"]'
				)
			]
				.filter((node) => node.getBoundingClientRect().width > 0)
				.map((node) => {
					const style = getComputedStyle(node);
					return {
						id: node.id,
						height: node.getBoundingClientRect().height,
						radius: style.borderTopLeftRadius,
						fontSize: style.fontSize,
						padding: style.padding,
						minHeight: style.minHeight
					};
				})
		}));
		expect(state.overflow, `${name}: page overflow`).toBeLessThanOrEqual(1);
		measures.push({ name, ...state });
		for (const field of state.fields) {
			expect(parseFloat(field.radius), `${name}: ${field.id} corners`).toBeLessThanOrEqual(10);
			expect(field.height, `${name}: ${field.id} target`).toBeGreaterThanOrEqual(
				testInfo.project.name === 'mobile' ? 44 : 32
			);
			if (testInfo.project.name === 'mobile') expect(parseFloat(field.fontSize)).toBe(16);
		}
		if (field && (await field.isVisible()) && (await field.isEnabled())) {
			await field.click();
			const pointer = await field.evaluate((node) => {
				const style = getComputedStyle(node);
				return {
					outline: style.outlineStyle,
					offset: style.outlineOffset,
					shadow: style.boxShadow
				};
			});
			expect(pointer.shadow).toBe('none');
			if (pointer.outline !== 'none') expect(parseFloat(pointer.offset)).toBeLessThanOrEqual(0);
			await field.focus();
			await page.keyboard.press('Tab');
			await page.keyboard.press('Shift+Tab');
			await expect(field).toBeFocused();
			const focus = await field.evaluate((node) => {
				const style = getComputedStyle(node);
				return {
					visible: node.matches(':focus-visible'),
					outline: style.outlineStyle,
					field: ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName),
					border: style.borderColor,
					offset: style.outlineOffset,
					shadow: style.boxShadow,
					ring: style.getPropertyValue('--tw-ring-shadow').trim()
				};
			});
			expect(focus.visible).toBe(true);
			if (focus.field) expect(focus.outline).toBe('none');
			else expect(parseFloat(focus.offset)).toBeLessThanOrEqual(0);
			expect(focus.shadow).toBe('none');
			expect(focus.ring, `${name}: no stacked focus halo`).toBe('0 0 #0000');
			measures.push({ name: `${name}-focus`, ...focus });
			await page.screenshot({ path: testInfo.outputPath(`${name}-focus.png`), fullPage });
		}
		for (const width of testInfo.project.name === 'desktop' ? [768, 1440] : [320, 768, 390]) {
			await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
				`${name}: ${width}px`
			).toBeLessThanOrEqual(1);
			if (testInfo.project.name === 'mobile') {
				const touchFields = await page
					.locator(
						'[data-slot="input"]:visible, [data-slot="textarea"]:visible, [data-slot="native-select"]:visible'
					)
					.evaluateAll((nodes) =>
						nodes.map((node) => ({
							height: node.getBoundingClientRect().height,
							font: parseFloat(getComputedStyle(node).fontSize)
						}))
					);
				for (const field of touchFields) {
					expect(field.height, `${name}: touch target at ${width}px`).toBeGreaterThanOrEqual(44);
					expect(field.font, `${name}: touch text at ${width}px`).toBe(16);
				}
			}
		}
	}
	await activate(page, app);
	await capture('home');
	await page.goto(`${app.origin}/enseignant/classes?classe=${app.ids.currentClass}`);
	await expect(
		page.getByRole('button', { name: 'Ajouter un étudiant', exact: true })
	).toBeVisible();
	await capture('classes');
	await expect(async () => {
		if (!(await page.getByRole('dialog').isVisible()))
			await page.getByRole('button', { name: 'Ajouter un étudiant', exact: true }).click();
		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await capture(
		'student-dialog',
		page.getByRole('dialog').getByLabel('Nom complet', { exact: true }),
		false
	);
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: 'Modifier la classe', exact: true }).click();
	await capture(
		'class-dialog',
		page.getByRole('dialog').getByLabel('Nom de la classe', { exact: true }),
		false
	);
	await page.keyboard.press('Escape');
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.publicationModule}`);
	await readyModuleEditor(page);
	await capture('module', page.getByLabel('Nom du module (obligatoire)', { exact: true }));
	const section = page.getByLabel('Section du module', { exact: true });
	if (await section.isVisible()) await section.selectOption('planning');
	else await page.getByRole('tab', { name: 'Classes et planning', exact: true }).click();
	await capture('planning');
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}/bareme?retour=module`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await capture('rubric', page.locator('input:not([type=hidden]):visible').first());
	await page.goto(
		`${app.origin}/enseignant/notation?module=${app.ids.module}&contexte=${app.ids.currentContext}`
	);
	await expect(page.getByLabel('Rechercher un étudiant', { exact: true })).toBeVisible();
	await capture('grade-grid', page.getByLabel('Rechercher un étudiant', { exact: true }));
	await page.goto(
		`${app.origin}/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`
	);
	const point = page.locator('input[inputmode="numeric"]').first();
	await expect(point).toBeVisible();
	await capture('correction', point, false);
	expect((await point.boundingBox())?.height).toBe(testInfo.project.name === 'mobile' ? 44 : 32);
	await expect(point).toHaveAccessibleName('Total de points');
	await expect(point).toHaveAccessibleDescription(/Maximum : 15 points/);
	if (testInfo.project.name === 'desktop') {
		await expect(page.getByRole('region', { name: 'Contexte de la correction' })).toBeInViewport();
		await expect(
			page.getByRole('button', { name: 'Enregistrer Quiz', exact: true })
		).toBeInViewport();
	}
	await page
		.locator('.criterion-list')
		.screenshot({ path: testInfo.outputPath('criterion-rows.png') });
	const savedPoint = await point.inputValue();
	await point.fill('-1');
	await page.keyboard.press('Tab');
	await expect(point).toHaveAttribute('aria-invalid', 'true');
	await capture('correction-invalid', point, false);
	await point.fill(savedPoint);
	await page.keyboard.press('Tab');
	await page.getByRole('button', { name: 'Modifier la remise', exact: true }).click();
	await capture('submission', page.getByLabel('Lien de la remise', { exact: true }), false);
	await page.emulateMedia({ colorScheme: 'dark' });
	await capture('correction-dark', point, false);
	await page.emulateMedia({ colorScheme: 'light' });
	await page.getByLabel('Évaluation', { exact: true }).selectOption('1');
	await expect(point).toBeVisible();
	await capture('project-criteria', point, false);
	const lastPoint = page.locator('input[inputmode="numeric"]:visible').last();
	await lastPoint.focus();
	await page.keyboard.press('Tab');
	await page.keyboard.press('Shift+Tab');
	await expect(lastPoint).toBeFocused();
	await expect(lastPoint).toBeInViewport();
	if (testInfo.project.name === 'desktop') {
		await expect(page.getByRole('region', { name: 'Contexte de la correction' })).toBeInViewport();
		await expect(
			page.getByRole('button', { name: 'Enregistrer Projet', exact: true })
		).toBeInViewport();
	}
	await page.screenshot({ path: testInfo.outputPath('project-last-field-focus.png') });
	await page.goto(`${app.origin}/enseignant/propositions?proposition=${app.ids.proposals[0]}`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await capture('proposal-review', page.locator('input[inputmode="numeric"]').first(), false);
	await page.goto(`${app.origin}/enseignant/classes/annees?annee=2026-2027`);
	await expect(
		page.getByRole('button', { name: 'Préparer la clôture', exact: true })
	).toBeEnabled();
	await page.getByRole('button', { name: 'Préparer la clôture', exact: true }).click();
	const annualDialog = page.getByRole('alertdialog');
	await expect(annualDialog).toBeVisible();
	await capture('annual-dialog', undefined, false);
	await annualDialog.getByLabel('Recopiez l’année 2026-2027', { exact: true }).focus();
	await page.screenshot({ path: testInfo.outputPath('annual-dialog-bottom-focus.png') });
	await page.keyboard.press('Escape');
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`
	);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await capture('publication-preview');
	await page.goto(`${app.origin}/modules/${app.ids.publicationContext}`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await capture('public-module', page.getByRole('tab').first());
	await page.emulateMedia({ colorScheme: 'dark' });
	await capture('public-dark', page.getByRole('tab').first());
	await page.goto(`${app.origin}/classes/${app.ids.currentClass}`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await capture('public-class');
	await writeFile(
		testInfo.outputPath('measurements.json'),
		JSON.stringify({ measures, errors }, null, 2)
	);
	expect(errors).toEqual([]);
});
