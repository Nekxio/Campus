import { openModulePages } from './support/module-navigation.js';
import type { Page } from '@playwright/test';
import { test, expect, readyModuleEditor } from './fixtures.js';
import { activate } from './support/auth.js';
import type { ModuleDetail } from '../../src/lib/teaching/types.js';

const widths = [320, 390, 768, 1440];

test('chosen compositions reflow in both themes and retain their accessible controls', async ({
	page,
	app
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'This matrix sets each viewport explicitly.');
	test.setTimeout(600000);
	const cases: Record<string, unknown>[] = [];
	const failures: string[] = [];
	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	async function inspect(name: string, current: Page = page) {
		for (const theme of ['light', 'dark'] as const) {
			await current.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
			for (const width of widths) {
				await current.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
				await expect(current.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
				await current.evaluate(() => document.fonts.ready);
				const themeControls = current.getByRole('button', {
					name: 'Choisir le thème',
					exact: true
				});
				for (const themeControl of await themeControls.all()) {
					if (await themeControl.isVisible()) await expect(themeControl).toHaveAttribute('aria-haspopup', 'menu');
				}
				const state = await current.evaluate(() => ({
					width: window.innerWidth,
					overflow: document.documentElement.scrollWidth - window.innerWidth,
					font: [...document.fonts].some((face) => face.family.includes('Inter') && face.status === 'loaded'),
					title: document.querySelector('h1')?.textContent?.trim(),
					tabs: [...document.querySelectorAll('[role="tab"]')]
						.filter((node) => (node as HTMLElement).offsetWidth > 0)
						.map((node) => node.textContent?.trim())
				}));
				cases.push({ name, theme, ...state });
				if (state.overflow > 1) failures.push(`${name} ${theme} ${width}: overflow ${state.overflow}px`);
				if (!state.font) failures.push(`${name} ${theme} ${width}: Inter did not load`);
			}
		}
	}
	await page.goto(app.origin + '/connexion');
	await expect(page.getByRole('button', { name: 'Me connecter', exact: true })).toBeEnabled();
	await inspect('sign-in');
	await activate(page, app, () => inspect('activation'));
	const paths = [
		['home', '/'],
		['classes', `/enseignant/classes?classe=${app.ids.currentClass}`],
		['module-create', '/enseignant/modules/nouveau'],
		['module-edit', `/enseignant/modules/${app.ids.publicationModule}`],
		['rubric', `/enseignant/modules/${app.ids.module}/bareme?retour=module`],
		['grid', `/enseignant/notation?module=${app.ids.module}&contexte=${app.ids.currentContext}`],
		['correction', `/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`],
		['proposals', `/enseignant/propositions?proposition=${app.ids.proposals[0]}`],
		[
			'publication',
			`/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`
		],
		['annual', '/enseignant/classes/annees?annee=2026-2027'],
		['public-class', `/classes/${app.ids.currentClass}`],
		['public-module', `/modules/${app.ids.publicationContext}`]
	];
	for (const [name, path] of paths) {
		await page.goto(app.origin + path);
		await expect(page.locator('h1').first()).toBeVisible();
		await inspect(name);
	}
	expect(failures).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(cases).toHaveLength(112);
});

test('calendar, draft recovery, contextual returns and public preview keep the chosen scope', async ({ page, app }) => {
	test.setTimeout(600000);
	await activate(page, app);
	await page.setViewportSize({ width: 390, height: 844 });
	const month = page.locator('details').filter({ has: page.getByText('Afficher le calendrier du mois') });
	await expect(month).not.toHaveAttribute('open', '');
	await month.locator('summary').focus();
	await page.keyboard.press('Enter');
	await expect(month).toHaveAttribute('open', '');
	await expect(month.getByRole('grid')).toBeVisible();
	await expect(month.getByText('Jour avec une séance', { exact: true })).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`${app.origin}/enseignant/classes?classe=${app.ids.currentClass}`);
	await expect(async () => {
		if (!(await page.getByRole('dialog').isVisible()))
			await page.getByRole('button', { name: 'Ajouter un étudiant', exact: true }).click();
		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Nom complet', { exact: true }).fill('Fictional retained draft');
	await page.keyboard.press('Escape');
	await expect(dialog).not.toBeVisible();
	await expect(async () => {
		if (!(await page.getByRole('dialog').isVisible()))
			await page.getByRole('button', { name: 'Ajouter un étudiant', exact: true }).click();
		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await expect(dialog.getByLabel('Nom complet', { exact: true })).toHaveValue('Fictional retained draft');
	await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
	await page.getByRole('button', { name: 'Modifier la classe', exact: true }).click();
	await page.getByRole('dialog').getByLabel('Nom de la classe', { exact: true }).fill('Fictional unsaved class');
	await page.keyboard.press('Escape');
	await expect(page.getByRole('alertdialog')).toBeVisible();
	await page.getByRole('button', { name: 'Continuer à modifier', exact: true }).click();
	await expect(page.getByRole('dialog').getByLabel('Nom de la classe', { exact: true })).toHaveValue(
		'Fictional unsaved class'
	);
	await page.getByRole('dialog').getByRole('button', { name: 'Annuler', exact: true }).click();
	await page.getByRole('button', { name: 'Abandonner la saisie', exact: true }).click();
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}/bareme?retour=module`);
	const projectTab = page.getByRole('tab', { name: 'Projet 100 pts', exact: true });
	await expect(async () => {
		await projectTab.click();
		await expect(projectTab).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await (await openModulePages(page)).getByRole('link', { name: 'Préparer', exact: true }).click();
	await expect.poll(() => new URL(page.url()).pathname).toBe(`/enseignant/modules/${app.ids.module}`);
	await page.goto(`${app.origin}/enseignant/notation/${app.ids.currentContext}/${app.ids.students[3]}`);
	const studentName = await page.locator('.correction h1').innerText();
	await page.getByRole('link', { name: 'Retour à la grille', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`etudiant=${app.ids.students[3]}`));
	await expect(page.locator('#selected-student-summary')).toContainText(studentName);
	await page.goto(`${app.origin}/enseignant/propositions?proposition=${app.ids.proposals[0]}`);
	await expect(page.getByRole('button', { name: 'Reprendre le commentaire', exact: true })).toHaveCount(0);
	await expect(async () => {
		if (!(await page.locator('#proposal-comment-comparison').isVisible()))
			await page.getByRole('button', { name: 'Examiner le commentaire', exact: true }).click();
		await expect(page.locator('#proposal-comment-comparison')).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await expect(page.locator('#proposal-comment-comparison')).toBeFocused();
	await expect(page.getByRole('button', { name: 'Reprendre le commentaire', exact: true })).toBeVisible();
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`
	);
	const preview = page.locator('.preview-content');
	const sectionLabels = [
		'Supports du cours',
		'Consignes et barèmes',
		'Échéances et remise',
		'Ressources complémentaires',
		'Vu en cours / à faire'
	];
	await expect(preview.getByRole('tab')).toHaveCount(0);
	const sectionTrigger = page.getByRole('button', { name: /^Sections/ });
	if (await sectionTrigger.isVisible()) await sectionTrigger.click();
	const navigation = page.getByRole('navigation', { name: 'Sections de l’aperçu', exact: true });
	await expect(navigation.getByRole('link')).toHaveCount(5);
	for (const label of sectionLabels)
		await expect(navigation.getByRole('link').filter({ hasText: label })).toBeVisible();
	if (await page.getByRole('dialog', { name: 'Choisir une section', exact: true }).isVisible())
		await page.keyboard.press('Escape');
	await expect(preview.locator('.deadline-reminder')).toBeVisible();
	await page.goto(`${app.origin}/modules/${app.ids.publicationContext}`);
	await expect(page.getByRole('tab')).toHaveText([sectionLabels[0], 'Quiz', ...sectionLabels.slice(1)]);
	await expect(page.locator('.deadline-reminder')).toBeVisible();
	await page.goto(app.origin + '/modules/00000000-0000-4000-8000-000000000099');
	await expect(page.getByText('Demandez le lien du cours à votre enseignant.', { exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: /accueil|connexion|cours de la classe/i })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Réessayer', exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Réessayer', exact: true })).toHaveCount(0);
	await page.goto(app.origin + '/enseignant/classes/annees');
	await expect(page.getByLabel('Année à consulter', { exact: true })).toHaveValue('');
});

test('publication desktop keeps stable document dimensions and a scrollable preview', async ({
	page,
	app
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'The preview scrolls independently on desktop.');
	test.setTimeout(300000);
	await page.setViewportSize({ width: 1440, height: 600 });
	await activate(page, app);
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`
	);
	for (const theme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
		await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
		await page.evaluate(() => document.fonts.ready);
		// Read after consecutive rendered frames; no viewport changes or full-page auto-resize races.
		await page.evaluate(
			() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))
		);
		const state = await page.evaluate(() => {
			const workspace = document.getElementById('workspace-content')!;
			const preview = document.querySelector<HTMLElement>('.preview-content')!;
			return {
				height: document.documentElement.scrollHeight,
				viewport: innerHeight,
				workspace: workspace.getBoundingClientRect().toJSON(),
				previewHeight: preview.clientHeight,
				previewScrollHeight: preview.scrollHeight
			};
		});
		expect(state.height - state.workspace.bottom, 'No blank document after the workspace').toBeLessThan(16);
		expect(state.previewScrollHeight).toBeGreaterThan(state.previewHeight);
	}
	const preview = page.locator('.preview-content');
	const sectionLinks = page.getByRole('navigation', { name: 'Sections de l’aperçu', exact: true }).getByRole('link');
	await expect(sectionLinks).toHaveCount(5);
	await expect(preview.getByRole('tab')).toHaveCount(0);
	for (const link of await sectionLinks.all()) {
		await link.focus();
		await page.keyboard.press('Enter');
		await expect(link).toHaveAttribute('aria-current', 'location');
		await expect(preview.locator('.course-section')).toHaveCount(1);
		await expect(preview.locator('.course-section')).toBeFocused();
	}
	await sectionLinks.first().click();
	const lastLink = preview.getByRole('link').last();
	await lastLink.focus();
	const previewFocus = await lastLink.evaluate((element) => ({
		linkBottom: element.getBoundingClientRect().bottom,
		previewBottom: element.closest('.preview-content')!.getBoundingClientRect().bottom
	}));
	expect(previewFocus.linkBottom).toBeLessThanOrEqual(previewFocus.previewBottom);
	await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
	const privacy = page.getByText(
		'Aucun nom d’étudiant, note individuelle ou commentaire privé ne figure dans cet aperçu.',
		{ exact: true }
	);
	const privacyBounds = await privacy.evaluate((element) => ({
		privacyBottom: element.getBoundingClientRect().bottom,
		railBottom: element.closest('.review-rail')!.getBoundingClientRect().bottom
	}));
	expect(privacyBounds.privacyBottom).toBeLessThanOrEqual(privacyBounds.railBottom);
});

test('finish corrections preserve theme selection, class provenance and responsive page bounds', async ({
	page,
	app
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'This verification sets desktop and mobile widths.');
	test.setTimeout(600000);
	await activate(page, app);
	await page.waitForLoadState('networkidle');
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.setViewportSize({ width: 1440, height: 900 });
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const rubricReturn = async (label: string, path: string) => {
		await expect(async () => {
			const control =
				label === 'Retour au module'
					? (await openModulePages(page)).getByRole('link', { name: 'Préparer', exact: true })
					: page.getByRole('button', { name: label, exact: true });
			await control.click({ timeout: 1000 });
			await expect(page).toHaveURL(new RegExp(path), { timeout: 1000 });
		}).toPass({ timeout: 60000 });
	};
	const inspectResponsiveBounds = async () => {
		for (const theme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: theme });
			await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
			for (const width of [1440, 390]) {
				await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
				await page.evaluate(() => document.fonts.ready);
				const state = await page.evaluate(() => ({
					overflow: document.documentElement.scrollWidth - innerWidth,
					height: document.documentElement.scrollHeight
				}));
				expect(state.overflow).toBeLessThan(2);
			}
		}
		await page.setViewportSize({ width: 1440, height: 900 });
	};
	for (const name of ['Thème clair', 'Thème sombre', 'Thème système']) {
		const trigger = page.getByRole('button', { name: 'Choisir le thème', exact: true });
		const menu = page.getByRole('menu');
		const radio = page.getByRole('menuitemradio', { name, exact: true });
		await expect(async () => {
			if (!(await menu.isVisible())) {
				await trigger.focus();
				await page.keyboard.press('Enter');
			}
			await expect(radio).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 60000 });
		await expect(menu).toHaveCSS('opacity', '1');
		await expect.poll(() => menu.evaluate((node) => node.contains(document.activeElement))).toBe(true);
		await radio.focus();
		await expect(radio).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(menu).toHaveCount(0);
		await trigger.focus();
		await page.keyboard.press('Enter');
		await expect(radio).toHaveAttribute('aria-checked', 'true');
		await expect(page.getByRole('menuitemradio', { checked: true })).toHaveCount(1);
		await page.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		await expect(trigger).toBeFocused();
	}
	await inspectResponsiveBounds();
	await page.goto(app.origin + '/enseignant/classes/annees?annee=2026-2027');
	await page.getByRole('button', { name: 'Préparer la clôture', exact: true }).click();
	const annualSummary = page.getByRole('region', { name: 'Bilan de l’année', exact: true });
	await expect(annualSummary).toContainText('1 commentaire');
	await expect(annualSummary).not.toContainText('1 commentaires');
	await inspectResponsiveBounds();
	const headers = { origin: app.origin };
	const created = await page.request.post(app.origin + '/api/teaching/classes', {
		headers,
		data: { name: 'C3 Fictional provenance', academicYear: '2026-2027' }
	});
	expect(created.status()).toBe(200);
	const secondClass = ((await created.json()) as { id: string }).id;
	const module = (await (
		await page.request.get(`${app.origin}/api/teaching/modules/${app.ids.publicationModule}`)
	).json()) as ModuleDetail;
	const attached = await page.request.post(`${app.origin}/api/teaching/classes/${secondClass}/modules`, {
		headers,
		data: { moduleId: module.id, moduleRevision: module.revision, expectedRevision: 1 }
	});
	expect(attached.status()).toBe(200);
	const { id: secondContext, moduleId: secondModule } = (await attached.json()) as {
		id: string;
		moduleId: string;
	};
	expect(secondModule).not.toBe(module.id);
	await page.goto(`${app.origin}/enseignant/classes?classe=${secondClass}`);
	await page
		.locator('section[aria-labelledby="class-modules-title"]')
		.getByRole('link', { name: /Application web/ })
		.click();
	await expect(page.getByRole('tabpanel', { name: 'Classe et planning', exact: false })).toBeVisible();
	await expect(page.locator('.module-editor')).toContainText('C3 Fictional provenance · 2026-2027');
	await page.getByRole('link', { name: 'Régler les échéances des évaluations', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`contexte=${secondContext}`));
	await expect(page).toHaveURL(new RegExp(`#echeances-${secondContext}$`));
	await rubricReturn('Retour au module', `/enseignant/modules/${secondModule}\\?`);
	await expect(page).toHaveURL(new RegExp(`classe=${secondClass}`));
	await expect(page.getByRole('tabpanel', { name: 'Classe et planning', exact: false })).toBeVisible();
	await inspectResponsiveBounds();
	await (await openModulePages(page)).getByRole('link', { name: 'Barème', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`contexte=${secondContext}`));
	await inspectResponsiveBounds();
	await rubricReturn('Retour au module', `/enseignant/modules/${secondModule}\\?`);
	await (await openModulePages(page)).getByRole('link', { name: 'Publication', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`contexte=${secondContext}`));
	await expect(page.getByLabel('Classe sélectionnée', { exact: true })).toHaveText('C3 Fictional provenance');
	await (await openModulePages(page)).getByRole('link', { name: 'Préparer', exact: true }).click();
	await expect(page.getByRole('tabpanel', { name: 'Classe et planning', exact: false })).toBeVisible();
	await (await openModulePages(page)).getByRole('link', { name: 'Notation', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`contexte=${secondContext}`));
	await expect(page.getByText('Aucun étudiant dans cette classe', { exact: true })).toBeVisible();
	for (const route of [
		`/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`,
		`/enseignant/propositions?proposition=${app.ids.proposals[0]}`
	]) {
		await page.goto(app.origin + route);
		await page.getByRole('link', { name: 'Voir le barème', exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`contexte=${app.ids.currentContext}`));
		await rubricReturn('Retour à la grille', '/enseignant/notation\\?');
		await expect(page).toHaveURL(new RegExp(`contexte=${app.ids.currentContext}`));
	}
	await page.goto(`${app.origin}/enseignant/modules/${secondModule}?classe=${secondClass}&section=information`);
	await readyModuleEditor(page);
	await page.getByLabel('Objectifs pédagogiques (optionnel)', { exact: true }).focus();
	const focus = await page.evaluate(() => {
		const input = document.activeElement!.getBoundingClientRect();
		const footer = document.querySelector('.editor-save-bar')!.getBoundingClientRect();
		const descriptions = (document.activeElement!.getAttribute('aria-describedby') ?? '')
			.split(' ')
			.map((id) => document.getElementById(id))
			.filter((element) => element && element.getBoundingClientRect().height > 0)
			.map((element) => element!.getBoundingClientRect().bottom);
		return {
			inputBottom: input.bottom,
			descriptionBottom: Math.max(input.bottom, ...descriptions),
			footerTop: footer.top
		};
	});
	expect(focus.inputBottom).toBeLessThanOrEqual(focus.footerTop);
	expect(focus.descriptionBottom).toBeLessThanOrEqual(focus.footerTop);
	await page.goto(`${app.origin}/modules/${app.ids.publicationContext}`);
	await inspectResponsiveBounds();
	expect(errors).toEqual([]);
});
