import { readFormActionReceipt } from './support/form-actions.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test as base, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import type { BrowserFixture } from './support/process.js';
import { moduleDetailSchema } from '../../src/lib/domain/teaching.js';
import { rubricUpdateSchema } from '../../src/lib/domain/grading.js';
import { publicationReceiptSchema } from '../../src/lib/domain/publication.js';
import { editableModule } from '../../src/lib/teaching/types.js';

type InterNetwork = {
	responses: { url: string; resourceType: string; method: string; status: number }[];
	failures: { url: string; error: string | undefined }[];
};
const interNetworks = new WeakMap<Page, InterNetwork>();
const isInterFile = (url: string) => /^inter-.*\.woff2$/.test(new URL(url).pathname.split('/').at(-1) ?? '');

const test = base.extend<{ runtime: void }>({
	runtime: [
		async ({ context, app }, use) => {
			// Keep the server alive until runtime assertions finish.
			const errors: string[] = [];
			const observe = (page: Page) => {
				// Observe before activation/goto, including new public pages and memory-cache responses.
				const network: InterNetwork = { responses: [], failures: [] };
				interNetworks.set(page, network);
				page.on('response', (response) => {
					if (isInterFile(response.url()))
						network.responses.push({
							url: response.url(),
							resourceType: response.request().resourceType(),
							method: response.request().method(),
							status: response.status()
						});
				});
				page.on('requestfailed', (request) => {
					if (isInterFile(request.url()))
						network.failures.push({ url: request.url(), error: request.failure()?.errorText });
				});
				page.on('pageerror', (error) => errors.push(error.message));
				page.on('console', (message) => {
					if (message.type() === 'error') errors.push(message.text());
				});
			};
			context.pages().forEach(observe);
			context.on('page', observe);
			context.on('response', (response) => {
				if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
			});
			context.on('requestfailed', (request) => {
				errors.push(`${request.failure()?.errorText} ${request.url()}`);
			});
			try {
				await use();
			} finally {
				expect(errors, `No JavaScript, console, HTTP or network errors on ${app.origin}`).toEqual([]);
			}
		},
		{ auto: true }
	]
});

// Independent expectations: do not derive the five-section contract from the renderer under test.
const sections = [
	{ id: 'supports', label: 'Supports du cours' },
	{ id: 'consignes', label: 'Consignes et barèmes' },
	{ id: 'remise', label: 'Échéances et remise' },
	{ id: 'ressources', label: 'Ressources utiles' },
	{ id: 'suivi', label: 'Vu en cours / à faire' }
] as const;
type Section = (typeof sections)[number];
const longInstructions = (
	'Déposez le lien GitHub et la démonstration dans le devoir Teams. ' +
	'Vérifiez les droits de consultation, le README et les livrables avant la remise. '
)
	.repeat(18)
	.trim();
const deadlines = [
	{
		label: 'Projet · remise finale',
		dueAt: '2026-10-27T22:59:00.000Z',
		submissionInstructions: longInstructions
	},
	{
		label: 'Avant le changement d’heure',
		dueAt: '2026-10-25T00:30:00.000Z',
		submissionInstructions: ''
	},
	{
		label: 'Après le changement d’heure',
		dueAt: '2026-10-25T01:30:00.000Z',
		submissionInstructions: 'Remettez uniquement le lien de la démonstration.'
	},
	{
		label: 'Autre travail au même instant',
		dueAt: '2026-10-25T01:30:00.000Z',
		submissionInstructions: 'Pour ce travail distinct, remettez le compte rendu dans Teams.'
	}
];
const navigationName = 'Sections de l’aperçu';

async function enrichSavedDraft(page: Page, app: BrowserFixture, instructions = 'Consigne publique du module · 013') {
	const endpoint = `${app.origin}/api/teaching/modules/${app.ids.publicationModule}`;
	const read = await page.request.get(endpoint);
	expect(read.status()).toBe(200);
	const saved = moduleDetailSchema.parse(await read.json());
	const draft = editableModule(saved);
	draft.objectives = ['Expliquer ses choix et vérifier le parcours au clavier.'];
	draft.sourcePath = '/fictional/PRIVATE_SOURCE_PATH_013';
	draft.preparation.framing = 'PRIVATE_PREPARATION_013';
	draft.studentContent = {
		instructions,
		projectInstructions: 'Consigne publique du projet · 013',
		exercises: [
			{
				id: randomUUID(),
				title: 'Exercice libre · 013',
				instructions:
					'Construire une navigation accessible sans attendre une date de déverrouillage.\n\n## À réaliser\n\n1. Lire **le code**.\n2. Vérifier `name`.\n\n```svelte\n<script>\n  let name = "Ada";\n</script>\n```\n\nCompléter le composant.',
				solution:
					'Corrigé librement accessible · 013\n\n## Une solution\n\n- Préserver **le nom**.\n- Afficher la valeur.\n\n```svelte\nlet count = 0;\n```\n\nAfficher `count`.',
				code: 'const message = "Bonjour, 世界 👋";'
			}
		]
	};
	const updated = await page.request.patch(endpoint, {
		headers: { Origin: app.origin },
		data: { ...draft, expectedRevision: saved.revision }
	});
	expect(updated.status()).toBe(200);
	const module = moduleDetailSchema.parse(await updated.json());
	const assessments = deadlines.map((deadline, index) => {
		const groupId = randomUUID();
		return {
			id: randomUUID(),
			title: deadline.label,
			kind: index === 0 ? ('project' as const) : ('other' as const),
			purpose: 'graded' as const,
			groups: [{ id: groupId, title: 'Livrables' }],
			lines: [
				{
					id: randomUUID(),
					groupId,
					label: 'Qualité du livrable',
					description: 'Parcours au clavier et contenu lisible.',
					maxPoints: 20
				}
			]
		};
	});
	const context = module.contexts.find((context) => context.id === app.ids.publicationContext);
	if (!context) throw new Error('Missing fictional publication context.');
	const rubric = rubricUpdateSchema.parse({
		expectedRevision: module.revision,
		assessments,
		results: [
			{
				id: randomUUID(),
				title: 'Résultat fictif',
				rule: {
					kind: 'points_ratio',
					assessmentIds: assessments.map((assessment) => assessment.id)
				}
			}
		],
		contexts: [
			{
				id: context.id,
				expectedRevision: context.expectedRevision,
				deadlines: deadlines.map((deadline, index) => ({
					assessmentId: assessments[index].id,
					dueAt: deadline.dueAt,
					submissionInstructions: deadline.submissionInstructions
				}))
			}
		]
	});
	const replaced = await page.request.patch(endpoint + '/rubric', {
		headers: { Origin: app.origin },
		data: rubric
	});
	expect(replaced.status()).toBe(200);
}

async function publish(page: Page, app: BrowserFixture, moduleId: string, contextId: string) {
	const response = page.waitForResponse(
		(response) =>
			response.url() === `${app.origin}/enseignant/modules/${moduleId}/publication?/decidePublication` &&
			response.request().method() === 'POST'
	);
	const button = page
		.getByRole('group', { name: 'Actions de publication', exact: true })
		.getByRole('button', { name: /^Publier (pour cette classe|la mise à jour)$/ });
	await expect(button).toBeEnabled();
	await button.focus();
	await page.keyboard.press('Enter');
	const saved = await response;
	expect(saved.status()).toBe(200);
	const receipt = publicationReceiptSchema.parse(await readFormActionReceipt(saved));
	expect(receipt.contextId).toBe(contextId);
	await expect(page.locator('.publication-state')).toContainText(
		'Le brouillon enregistré correspond à la version publiée.'
	);
	return receipt.publicPath;
}

async function reviewNavigation(page: Page, width: number, hasObjectives = true) {
	// Review decision controls are disabled until onMount; SSR links alone are not interactive readiness.
	const readyDecision = page
		.getByRole('button', {
			name: /^(Publier pour cette classe|Publier la mise à jour|Dépublier)$/
		})
		.and(page.locator(':enabled'))
		.first();
	await expect(readyDecision, 'The review is hydrated before activating its navigation').toBeEnabled();
	const trigger = page.getByRole('button', { name: /^Sections/ });
	const navigation = page.getByRole('navigation', { name: navigationName, exact: true });
	if (width < 1024) {
		await expect(trigger).toBeVisible();
		await expect(navigation).toHaveCount(0);
		await trigger.focus();
		await page.keyboard.press('Enter');
		const dialog = page.getByRole('dialog', { name: 'Choisir une section', exact: true });
		await expect(dialog).toBeVisible();
		await expect(page.locator('[data-sonner-toaster]')).toBeHidden();
		await expect(dialog.getByRole('navigation', { name: navigationName, exact: true })).toBeVisible();
		await expect(navigation).toHaveCount(1);
		await expect
			.poll(
				async () => {
					const bounds = await dialog.boundingBox();
					return bounds ? Math.abs(bounds.y + bounds.height - page.viewportSize()!.height) : Infinity;
				},
				{ message: 'The section Sheet is attached to the bottom of the viewport' }
			)
			.toBeLessThanOrEqual(1);
	} else {
		await expect(trigger).toHaveCount(0);
		await expect(page.getByRole('dialog', { name: 'Choisir une section', exact: true })).toHaveCount(0);
		await expect(navigation).toHaveCount(1);
		await expect(navigation).toBeVisible();
	}
	for (const section of sections)
		await expect(navigation.getByRole('link').filter({ hasText: section.label })).toHaveCount(1);
	await expect(navigation.getByRole('link').filter({ hasText: 'Objectifs du module' })).toHaveCount(
		hasObjectives ? 1 : 0
	);
	await expect(navigation.getByRole('link')).toHaveCount(sections.length + Number(hasObjectives));
	await expect(navigation.locator('[aria-current="location"]')).toHaveCount(1);
	return navigation;
}

async function selectReview(page: Page, contextId: string, section: Section, width: number, hasObjectives = true) {
	const navigation = await reviewNavigation(page, width, hasObjectives);
	const link = navigation.getByRole('link').filter({ hasText: section.label });
	await expect(link).toHaveAttribute('href', `#review-${contextId}-${section.id}`);
	await link.focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('dialog', { name: 'Choisir une section', exact: true })).toHaveCount(0);
	const target = page.locator(`#review-${contextId}-${section.id}`);
	await expect(target).toBeVisible();
	await expect(target).toHaveAttribute('tabindex', '-1');
	await expect(target).toBeFocused();
	await expect(target.getByRole('heading', { name: section.label, exact: true })).toBeVisible();
	await expect(page.locator('.preview-content .course-section')).toHaveCount(1);
	const preview = page.locator('.preview-content');
	await expect(preview.getByRole('tablist')).toHaveCount(0);
	await expect(preview.getByRole('tab')).toHaveCount(0);
	await expect(preview.getByRole('tabpanel')).toHaveCount(0);
	if (width >= 1024) await expect(link).toHaveAttribute('aria-current', 'location');
	return target;
}

async function selectPublic(page: Page, contextId: string, section: Section, hasObjectives = true) {
	if (page.viewportSize()!.width < 1024) {
		const trigger = page.getByRole('button', { name: /^Changer de rubrique :/ });
		const dialog = page.getByRole('dialog', { name: 'Contenu du cours', exact: true });
		await expect(async () => {
			await trigger.click();
			await expect(dialog).toBeVisible({ timeout: 1000 });
		}).toPass();
		const navigation = dialog.getByRole('navigation', { name: 'Rubriques du cours', exact: true });
		for (const required of sections)
			await expect(navigation.getByRole('button', { name: required.label, exact: true })).toHaveCount(1);
		await expect(navigation.getByRole('button', { name: 'Quiz', exact: true })).toHaveCount(1);
		await expect(navigation.getByRole('button', { name: 'Objectifs du module', exact: true })).toHaveCount(
			hasObjectives ? 1 : 0
		);
		await expect(navigation.getByRole('button')).toHaveCount(sections.length + 1 + Number(hasObjectives));
		await navigation.getByRole('button', { name: section.label, exact: true }).focus();
		await page.keyboard.press('Enter');
		await expect(dialog).toHaveCount(0);
		const target = page.locator(`#cours-${contextId}-${section.id}`);
		await expect(target).toBeFocused();
		await expect(target.getByRole('heading', { name: section.label, exact: true })).toBeInViewport();
		await expect(trigger).toHaveText(section.label);
		await expect(page.locator('.course-section:visible')).toHaveCount(1);
		await expect(page.getByRole('tablist')).toHaveCount(0);
		return target;
	}
	const tabs = page.getByRole('tablist', { name: 'Contenu du module', exact: true });
	for (const required of sections)
		await expect(tabs.getByRole('tab', { name: required.label, exact: true })).toHaveCount(1);
	await expect(tabs.getByRole('tab', { name: 'Quiz', exact: true })).toHaveCount(1);
	await expect(tabs.getByRole('tab', { name: 'Objectifs du module', exact: true })).toHaveCount(hasObjectives ? 1 : 0);
	await expect(tabs.getByRole('tab')).toHaveCount(sections.length + 1 + Number(hasObjectives));
	const tab = tabs.getByRole('tab', { name: section.label, exact: true });
	const readAria = () =>
		page.locator('[role="tab"], [role="tabpanel"]').evaluateAll((nodes) =>
			nodes.map((node) => ({
				role: node.getAttribute('role'),
				id: node.getAttribute('id'),
				value: node.getAttribute('data-value'),
				controls: node.getAttribute('aria-controls'),
				labelledBy: node.getAttribute('aria-labelledby'),
				selected: node.getAttribute('aria-selected'),
				hidden: node.hasAttribute('hidden')
			}))
		);
	const before = await readAria();
	try {
		// Bits UI 2.19.5 registers both ARIA identities in runed.watch post-render effects.
		// The initially selected SSR tab alone does not prove that hydration has completed.
		await expect(tab).toHaveAttribute('id', /^\S+$/);
		await expect(tab).toHaveAttribute('aria-controls', /^\S+$/);
		const tabId = await tab.getAttribute('id');
		if (!tabId?.trim()) throw new Error('The hydrated public tab has no nonempty ID.');
		await tab.focus();
		await page.keyboard.press('Enter');
		await expect(tab).toHaveAttribute('aria-selected', 'true');
		await expect(tab).toBeFocused();
		const panel = page.getByRole('tabpanel');
		await expect(panel).toHaveCount(1);
		await expect(panel).toHaveAttribute('id', /^\S+$/);
		const panelId = await panel.getAttribute('id');
		if (!panelId?.trim()) throw new Error('The selected public panel has no nonempty ID.');
		await expect(tab).toHaveAttribute('aria-controls', panelId);
		await expect(panel).toHaveAttribute('aria-labelledby', tabId);
		await expect(panel).toHaveAccessibleName(section.label);
		const target = panel.locator(`#cours-${contextId}-${section.id}`);
		await expect(target).toBeVisible();
		await expect(panel.getByRole('region', { name: section.label, exact: true })).toBeVisible();
		// Bits UI retains inactive contents with hidden; only one pedagogical section is visible.
		await expect(page.locator('.course-section:visible')).toHaveCount(1);
		return target;
	} finally {
		await test.info().attach(`public-tabs-aria-${section.id}`, {
			body: JSON.stringify({ section: section.id, before, after: await readAria() }, null, 2),
			contentType: 'application/json'
		});
	}
}

async function pedagogicalContent(section: Locator) {
	return section.evaluate((node) => {
		const text = (value: string | null) => (value ?? '').replace(/\s+/g, ' ').trim();
		return {
			text: text(node.textContent),
			links: [...node.querySelectorAll('a')].map((link) => ({
				text: text(link.textContent),
				href: link.getAttribute('href'),
				target: link.getAttribute('target'),
				rel: link.getAttribute('rel')
			})),
			times: [...node.querySelectorAll('time')].map((time) => ({
				text: text(time.textContent),
				datetime: time.getAttribute('datetime')
			}))
		};
	});
}

async function projectDocuments(root: Locator, section: Section) {
	await expect(root.getByRole('complementary', { name: 'Documents du projet', exact: true })).toHaveCount(0);
	if (section.id !== 'consignes') return;
	for (const [label, url] of [
		['Consigne du projet · démo', 'https://example.test/assignment.pdf'],
		['Barème du projet · démo', 'https://example.test/rubric.pdf']
	]) {
		const link = root.getByRole('link', { name: new RegExp(label) });
		await expect(link).toHaveAttribute('href', url);
		await expect(link).toHaveAttribute('target', '_blank');
		await expect(link).toHaveAttribute('rel', /noreferrer/);
	}
}

async function deadlinePresentation(root: Locator, section: Section, reminder = deadlines[1]) {
	if (section.id !== 'remise') {
		await expect(root.locator('.deadline-reminder')).toHaveCount(1);
		await expect(root.locator('.deadline-reminder time')).toHaveCount(1);
		// Public Tabs keep the inactive remise panel mounted with hidden; it is not a visible repeat.
		for (const dueAt of new Set(deadlines.map((deadline) => deadline.dueAt))) {
			await expect(root.locator(`time[datetime="${dueAt}"]:visible`)).toHaveCount(dueAt === reminder.dueAt ? 1 : 0);
		}
		await expect(root.locator('.deadline-reminder')).toContainText(reminder.label);
		await expect(root.getByRole('button', { name: 'Voir les modalités de remise', exact: true })).toHaveCount(1);
		await expect(root.locator('.deadline:visible')).toHaveCount(0);
		for (const deadline of deadlines) {
			if (deadline.submissionInstructions)
				await expect(
					root.getByText(deadline.submissionInstructions, { exact: true }).filter({ visible: true })
				).toHaveCount(0);
		}
	} else {
		await expect(root.locator('.deadline-reminder')).toHaveCount(0);
		await expect(root.getByRole('button', { name: 'Voir les modalités de remise', exact: true })).toHaveCount(0);
		await expect(root.locator('.deadline')).toHaveCount(deadlines.length);
		await expect(root.locator('.deadline time')).toHaveCount(deadlines.length);
		await expect(root.locator('.deadline').first()).toHaveCSS('border-bottom-width', '1px');
		await expect(root.locator('.deadline').last()).toHaveCSS('border-bottom-width', '0px');
		for (const deadline of deadlines) {
			const detail = root.locator('.deadline').filter({ hasText: deadline.label });
			await expect(detail).toHaveCount(1);
			await expect(detail.locator('time')).toHaveAttribute('datetime', deadline.dueAt);
			await expect(
				detail.getByText(deadline.submissionInstructions || 'Les modalités de remise ne sont pas précisées.', {
					exact: true
				})
			).toHaveCount(1);
		}
		await expect(root.locator('time[datetime="2026-10-25T01:30:00.000Z"]')).toHaveCount(2);
		// Both sides of the Paris DST transition display 02:30, without merging their UTC instants.
		for (const utc of ['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']) {
			for (const time of await root.locator(`time[datetime="${utc}"]`).all())
				await expect(time).toContainText(/25 oct\. 2026.*02:30/);
		}
	}
}

async function capture(page: Page, app: BrowserFixture, info: TestInfo, name: string) {
	const network = interNetworks.get(page);
	if (!network) throw new Error('Inter network observation was not installed before navigation.');
	const fonts = await page.evaluate(async () => {
		const loads = await Promise.all(
			[400, 500, 600].map(async (weight) => ({
				weight,
				faces: (await document.fonts.load(`${weight} 16px "Inter Variable"`, 'Échéances à vérifier')).map((face) => ({
					family: face.family,
					status: face.status
				}))
			}))
		);
		await document.fonts.ready;
		const resources = performance.getEntriesByType('resource');
		return {
			loads,
			family: getComputedStyle(document.body).fontFamily,
			resourceTimingEntries: resources.length,
			resourceTimingLatinUrl:
				resources.find((entry) => new URL(entry.name).pathname.endsWith('/inter-latin-wght-normal.woff2'))?.name ?? null
		};
	});
	expect(fonts.family).toContain('Inter Variable');
	for (const load of fonts.loads) {
		expect(load.faces.length, `Loaded Inter faces at weight ${load.weight}`).toBeGreaterThan(0);
		for (const face of load.faces) {
			expect(face.family).toContain('Inter Variable');
			expect(face.status).toBe('loaded');
		}
	}
	// Vite may fill the document's Resource Timing buffer before its font request is recorded there.
	// Use only an actual browser font GET observed from this page, never a constructed fallback URL.
	const latinResponse = () =>
		network.responses.find(
			(response) =>
				response.resourceType === 'font' &&
				response.method === 'GET' &&
				new URL(response.url).pathname.endsWith('/inter-latin-wght-normal.woff2')
		);
	await expect
		.poll(() => Boolean(latinResponse()), {
			message: 'An actual Inter Latin font GET was observed before capture'
		})
		.toBe(true);
	const latin = latinResponse();
	if (!latin) throw new Error('No observed Inter Latin font GET before capture.');
	for (const response of network.responses)
		expect([200, 304], `${response.resourceType} ${response.url}`).toContain(response.status);
	expect(network.failures, 'No failed Inter requests').toEqual([]);
	expect(new URL(latin.url).origin).toBe(app.origin);
	const font = await page.request.get(latin.url);
	expect(font.status()).toBe(200);
	const bytes = await font.body();
	const probe = {
		url: latin.url,
		httpStatus: font.status(),
		bytes: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex')
	};
	expect(bytes.subarray(0, 4).toString()).toBe('wOF2');
	// Installed @fontsource-variable/inter Latin file, shared with correction-responsive's probe.
	expect(probe.bytes).toBe(48256);
	expect(probe.sha256).toBe('3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62');
	await info.attach(name + '-inter', {
		body: JSON.stringify({
			...fonts,
			probe,
			responses: network.responses,
			failures: network.failures
		}),
		contentType: 'application/json'
	});
	await page.evaluate(
		() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))
	);
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
		'No horizontal document overflow'
	).toBeLessThanOrEqual(1);
	await page.screenshot({ path: info.outputPath(name + '.png'), animations: 'disabled' });
}

test('the public course initially opens its first available section', async ({ app, page, context }) => {
	await activate(page, app);
	const publicPage = await context.newPage();
	const publicPath = `/modules/${app.ids.publicationContext}`;
	const expectFirstSection = async (label: string) => {
		if (publicPage.viewportSize()!.width < 1024) {
			await expect(publicPage.getByRole('button', { name: `Changer de rubrique : ${label}` })).toBeVisible();
		} else {
			const firstTab = publicPage.getByRole('tablist', { name: 'Contenu du module' }).getByRole('tab').first();
			await expect(firstTab).toHaveText(label);
			await expect(firstTab).toHaveAttribute('aria-selected', 'true');
		}
		await expect(publicPage.getByRole('heading', { name: label, exact: true })).toBeVisible();
	};
	try {
		await publicPage.goto(app.origin + publicPath);
		await expectFirstSection('Supports du cours');
		await enrichSavedDraft(page, app);
		await page.goto(
			`${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`
		);
		await publish(page, app, app.ids.publicationModule, app.ids.publicationContext);
		await publicPage.reload();
		await expectFirstSection('Objectifs du module');
		await selectPublic(publicPage, app.ids.publicationContext, sections[0]);
		await publicPage.reload();
		await expectFirstSection('Objectifs du module');
	} finally {
		await publicPage.close();
	}
});

test('shared content cards preserve preview boundaries, keyboard focus and deliberate correction access', async ({
	app,
	page,
	context
}, info) => {
	if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 844 });
	await activate(page, app);
	await enrichSavedDraft(page, app);
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`
	);
	const preview = page.getByRole('region', {
		name: 'Aperçu privé du contenu étudiant',
		exact: true
	});
	await expect(preview.getByRole('link', { name: 'Retour à la classe', exact: true })).toHaveCount(0);
	const publicPath = await publish(page, app, app.ids.publicationModule, app.ids.publicationContext);
	const publicPage = await context.newPage();
	try {
		if (info.project.name === 'mobile') await publicPage.setViewportSize({ width: 320, height: 844 });
		await publicPage.goto(app.origin + publicPath);
		const panels = [
			await selectReview(page, app.ids.publicationContext, sections[0], page.viewportSize()!.width),
			await selectPublic(publicPage, app.ids.publicationContext, sections[0])
		];
		for (const panel of panels) {
			const card = panel.getByRole('button', { name: /Exercice libre · 013/ });
			await expect(card).toHaveAccessibleName('01 Exercice libre · 013');
			await card.focus();
			await panel.page().keyboard.press('Enter');
			await expect(panel.getByRole('heading', { name: 'Exercice libre · 013', exact: true })).toBeFocused();
			const statement = panel.getByRole('tab', { name: 'Énoncé', exact: true });
			const solution = panel.getByRole('tab', { name: 'Corrigé', exact: true });
			const statementBox = await statement.boundingBox();
			const solutionBox = await solution.boundingBox();
			expect(statementBox).not.toBeNull();
			expect(solutionBox).not.toBeNull();
			expect(Math.abs(statementBox!.y - solutionBox!.y), 'Exercise tabs stay on one horizontal line').toBeLessThan(1);
			expect(solutionBox!.x).toBeGreaterThanOrEqual(statementBox!.x + statementBox!.width);
			await expect(panel.getByRole('heading', { name: 'À réaliser', exact: true })).toBeVisible();
			await expect(panel.locator('ol > li')).toHaveText(['Lire le code.', 'Vérifier name.']);
			await expect(panel.locator('ol strong')).toHaveText('le code');
			await expect(panel.getByRole('region', { name: 'Exemple de code', exact: true }).locator('code')).toHaveText(
				'<script>\n  let name = "Ada";\n</script>'
			);
			for (const theme of ['light', 'dark'] as const) {
				await panel.page().emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
				await panel.screenshot({
					path: info.outputPath(`exercise-statement-${panel === panels[0] ? 'preview' : 'public'}-${theme}.png`)
				});
			}
			await statement.focus();
			await panel.page().keyboard.press('ArrowRight');
			await expect(solution).toBeFocused();
			await expect(statement).toHaveAttribute('aria-selected', 'true');
			await expect(panel.getByText('Corrigé librement accessible · 013', { exact: true })).toBeHidden();
			await panel.page().keyboard.press('Enter');
			const confirmation = panel.page().getByRole('alertdialog', { name: 'Voir le corrigé ?' });
			await expect(confirmation).toBeVisible();
			const confirm = confirmation.getByRole('button', { name: 'Voir le corrigé', exact: true });
			await expect(confirm).not.toHaveClass(/bg-destructive/);
			await confirmation.getByRole('button', { name: 'Retour', exact: true }).click();
			await expect(panel.getByText('Corrigé librement accessible · 013', { exact: true })).toBeHidden();
			await solution.click();
			await confirm.click();
			await expect(panel.getByText('Corrigé librement accessible · 013', { exact: true })).toBeVisible();
			await expect(panel.getByRole('heading', { name: 'Une solution', exact: true })).toBeVisible();
			await expect(panel.getByRole('tabpanel', { name: 'Corrigé', exact: true }).locator('ul > li')).toHaveText([
				'Préserver le nom.',
				'Afficher la valeur.'
			]);
			await expect(panel.getByRole('region', { name: 'Exemple de code', exact: true }).locator('code')).toHaveText(
				'let count = 0;'
			);
			expect(await panel.page().evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
			const complementaryCode = panel.getByRole('region', {
				name: 'Code de l’exercice · Exercice libre · 013',
				exact: true
			});
			await complementaryCode.focus();
			await expect(complementaryCode).toBeFocused();
			await expect(complementaryCode).toHaveCSS('white-space', 'pre');
			for (const theme of ['light', 'dark'] as const) {
				await panel.page().emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
				await panel.screenshot({
					path: info.outputPath(`exercise-solution-${panel === panels[0] ? 'preview' : 'public'}-${theme}.png`)
				});
			}
			await panel.getByRole('button', { name: 'Retour aux supports', exact: true }).click();
			await expect(card).toBeFocused();
			await expect(panel.locator('button button, a button, button a, a a')).toHaveCount(0);
		}
		await expect(publicPage.getByRole('link', { name: 'Retour à la classe', exact: true })).toBeVisible();
		if (info.project.name === 'mobile') {
			await expect(
				publicPage
					.getByRole('button', { name: 'Voir les modalités de remise', exact: true })
					.getByText('Modalités de remise')
			).toBeVisible();
		}
		await publicPage.evaluate(() => {
			if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
			window.scrollTo({ top: 0, behavior: 'instant' });
		});
		for (const theme of ['light', 'dark'] as const) {
			await publicPage.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
			await publicPage.screenshot({
				path: info.outputPath(`content-cards-${theme}.png`),
				fullPage: true
			});
		}
	} finally {
		await publicPage.close();
	}
});

test('student reading preserves long text and opens each rubric independently with the keyboard', async ({
	app,
	page,
	context
}, info) => {
	const instructions =
		'Voici le début\net la suite.\n\n' +
		'Vérifiez tous les livrables et les droits de consultation avant la remise. '.repeat(12) +
		`Référence : ${'ressource'.repeat(24)}. Fin de la consigne.`;
	await activate(page, app);
	await enrichSavedDraft(page, app, instructions);
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`
	);
	const publicPath = await publish(page, app, app.ids.publicationModule, app.ids.publicationContext);
	const publicPage = await context.newPage();
	try {
		await publicPage.goto(app.origin + publicPath);
		const widths = info.project.name === 'mobile' ? [320, 390] : [1440];
		for (const width of widths) {
			for (const reducedMotion of ['no-preference', 'reduce'] as const) {
				for (const current of [page, publicPage]) {
					await current.setViewportSize({ width, height: 900 });
					await current.emulateMedia({ reducedMotion });
				}
				const panels = [
					await selectReview(page, app.ids.publicationContext, sections[1], width),
					await selectPublic(publicPage, app.ids.publicationContext, sections[1])
				];
				for (const panel of panels) {
					const current = panel.page();
					await current.bringToFront();
					const prose = panel.getByText(instructions, { exact: true });
					await expect(prose).toBeVisible();
					expect(await prose.textContent(), 'Authored line and paragraph breaks are preserved').toBe(instructions);
					await expect(prose.getByRole('paragraph')).toHaveCount(2);
					await expect(prose.getByRole('paragraph').first()).toHaveText('Voici le début\net la suite.');
					const proseBounds = await prose.boundingBox();
					expect(proseBounds!.x).toBeGreaterThanOrEqual(0);
					expect(proseBounds!.x + proseBounds!.width).toBeLessThanOrEqual(width + 1);
					expect(
						await prose.evaluate((node) => node.scrollWidth - node.clientWidth),
						'Long words wrap inside the reading area'
					).toBeLessThanOrEqual(1);
					const rubrics = panel.getByRole('region', { name: /^Grille vierge ·/ });
					await expect(rubrics).toHaveCount(deadlines.length);
					for (const [index, rubric] of (await rubrics.all()).entries()) {
						const summary = rubric.locator('summary');
						await expect(summary).toBeVisible();
						await expect(summary).toContainText(deadlines[index].label);
						await expect(summary).toContainText('Max. 20 points');
						await expect(rubric.getByText('Qualité du livrable', { exact: true })).toBeHidden();
					}
					const first = rubrics.nth(0);
					const second = rubrics.nth(1);
					for (const rubric of [first, second]) {
						await rubric.locator('summary').focus();
						await current.keyboard.press('Enter');
						await expect(rubric.locator('summary')).toBeFocused();
						await expect(rubric.getByText('Qualité du livrable', { exact: true })).toBeVisible();
					}
					await expect(first.getByText('Qualité du livrable', { exact: true })).toBeVisible();
					await expect(rubrics.nth(2).getByText('Qualité du livrable', { exact: true })).toBeHidden();
					await first.locator('summary').focus();
					await current.keyboard.press('Space');
					await expect(first.getByText('Qualité du livrable', { exact: true })).toBeHidden();
					await expect(second.getByText('Qualité du livrable', { exact: true })).toBeVisible();
					await second.locator('summary').focus();
					await current.keyboard.press('Space');
					await expect(second.getByText('Qualité du livrable', { exact: true })).toBeHidden();
					expect(await current.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(
						1
					);
				}
				expect(await pedagogicalContent(panels[0])).toEqual(await pedagogicalContent(panels[1]));
			}
		}
	} finally {
		await publicPage.close();
	}
});

test('five shared panels retain their content, deadlines and project documents across the approved navigation matrix', async ({
	app,
	page,
	context,
	request
}, info) => {
	test.setTimeout(480000);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await activate(page, app);
	await enrichSavedDraft(page, app);
	await page.clock.setFixedTime(new Date('2026-10-25T00:00:00Z'));
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`
	);
	await expect(page.getByRole('button', { name: 'Publier la mise à jour', exact: true }).first()).toBeEnabled();
	await expect(
		page
			.getByRole('region', { name: 'Aperçu privé du contenu étudiant', exact: true })
			.getByRole('link', { name: 'Retour à la classe', exact: true })
	).toHaveCount(0);
	const initialWidth = page.viewportSize()!.width;
	const changed = await reviewNavigation(page, initialWidth);
	for (const section of sections) {
		const link = changed.getByRole('link').filter({ hasText: section.label });
		await expect(link.getByText('Modifié', { exact: true })).toHaveCount(
			['supports', 'consignes', 'remise'].includes(section.id) ? 1 : 0
		);
	}
	if (initialWidth < 1024) {
		await page.keyboard.press('Escape');
		await expect(page.getByRole('button', { name: /^Sections/ })).toBeFocused();
	}
	await expect(page.getByText('Titre, description ou objectifs modifiés', { exact: true })).toBeVisible();
	const publicPath = await publish(page, app, app.ids.publicationModule, app.ids.publicationContext);
	expect(publicPath).toBe('/modules/' + app.ids.publicationContext);
	const anonymous = await request.get(app.origin + publicPath + '/__data.json');
	expect(anonymous.status()).toBe(200);
	expect(anonymous.headers()['cache-control']).toBe('no-store');
	expect(anonymous.headers()['x-robots-tag']).toBe('noindex, nofollow');
	expect(await anonymous.text()).not.toMatch(
		/PRIVATE_SOURCE_PATH_013|PRIVATE_PREPARATION_013|Aline Moreau|Camille Demo|Teacher Browser Demo|fictional-submission|semesterComment/
	);
	const publicPage = await context.newPage();
	try {
		await publicPage.emulateMedia({ reducedMotion: 'reduce' });
		await publicPage.clock.setFixedTime(new Date('2026-10-25T00:00:00Z'));
		await publicPage.goto(app.origin + publicPath);
		await expect(publicPage.getByRole('main')).toHaveCount(1);
		await expect(publicPage.getByRole('navigation', { name: 'Navigation principale', exact: true })).toHaveCount(0);
		await expect(publicPage.getByRole('link', { name: 'Publication', exact: true })).toHaveCount(0);
		const previewRoot = page.locator(`#review-${app.ids.publicationContext}`);
		const publicRoot = publicPage.locator(`#cours-${app.ids.publicationContext}`);
		const widths = info.project.name === 'mobile' ? [320, 390] : [1440];
		for (const width of widths) {
			for (const theme of ['light', 'dark'] as const) {
				await page.setViewportSize({ width, height: 900 });
				await publicPage.setViewportSize({ width, height: 900 });
				await page.emulateMedia({ colorScheme: theme });
				await publicPage.emulateMedia({ colorScheme: theme });
				for (const current of [page, publicPage])
					await expect(current.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
				await expect(page.locator('.preview-content .decision-bar')).toHaveCount(0);
				await expect(page.locator('.decision-bar')).toHaveCount(0);
				await expect(page.getByRole('button', { name: 'Dépublier', exact: true })).toBeEnabled();
				if (width < 1024) {
					await reviewNavigation(page, width);
					await capture(page, app, info, `preview-sections-${width}-${theme}`);
					await page.keyboard.press('Escape');
					await expect(page.getByRole('dialog', { name: 'Choisir une section', exact: true })).toHaveCount(0);
					await expect(page.getByRole('button', { name: /^Sections/ })).toBeFocused();
				}
				const objectiveNavigation = await reviewNavigation(page, width);
				await objectiveNavigation.getByRole('link', { name: /Objectifs du module/ }).click();
				const privateObjectives = previewRoot.locator(`#review-${app.ids.publicationContext}-objectives`);
				await expect(privateObjectives).toBeVisible();
				if (width < 1024) {
					await publicPage.getByRole('button', { name: /^Changer de rubrique :/ }).click();
					await publicPage
						.getByRole('dialog', { name: 'Contenu du cours' })
						.getByRole('button', { name: 'Objectifs du module' })
						.click();
				} else {
					await publicPage.getByRole('tab', { name: 'Objectifs du module' }).click();
				}
				const publicObjectives = publicRoot.locator(`#cours-${app.ids.publicationContext}-objectives`);
				await expect(publicObjectives).toBeVisible();
				expect(await privateObjectives.locator('li').allTextContents()).toEqual(
					await publicObjectives.locator('li').allTextContents()
				);
				for (const section of sections) {
					const privatePanel = await selectReview(page, app.ids.publicationContext, section, width);
					const publicPanel = await selectPublic(publicPage, app.ids.publicationContext, section);
					expect(
						await pedagogicalContent(privatePanel),
						`${section.label}: same saved snapshot, without teacher chrome`
					).toEqual(await pedagogicalContent(publicPanel));
					if (section.id === 'ressources') {
						await expect(privatePanel.locator('[data-slot="separator"]')).toHaveCount(0);
						await expect(publicPanel.locator('[data-slot="separator"]')).toHaveCount(0);
						await capture(publicPage, app, info, `public-ressources-${width}-${theme}`);
					}
					if (section.id === 'supports') {
						for (const panel of [privatePanel, publicPanel]) {
							await panel.page().bringToFront();
							await expect(
								panel.getByText('Construire une navigation accessible sans attendre une date de déverrouillage.')
							).toHaveCount(0);
							await expect(panel.getByText('Corrigé librement accessible · 013', { exact: true })).toHaveCount(0);
							const exerciseCard = panel.getByRole('button', { name: /Exercice libre · 013/ });
							await expect(exerciseCard).not.toContainText('Exercice non noté');
							await exerciseCard.click();
							await expect(
								panel.getByText('Construire une navigation accessible sans attendre une date de déverrouillage.')
							).toBeVisible();
							const example = panel.getByRole('region', { name: 'Exemple de code', exact: true });
							await expect(example).toBeVisible();
							await expect(example.locator('code')).toHaveText('<script>\n  let name = "Ada";\n</script>');
							const keyword = example.locator('code span').filter({ hasText: 'let' });
							expect(await keyword.evaluate((element) => getComputedStyle(element).color)).not.toBe(
								await example.evaluate((element) => getComputedStyle(element).color)
							);
							await expect(panel.getByText('Compléter le composant.', { exact: true })).toBeVisible();
							await example.focus();
							await expect(example).toBeFocused();
							const correction = panel.getByText('Corrigé librement accessible · 013', {
								exact: true
							});
							await expect(correction).toBeHidden();
							const correctionTab = panel.getByRole('tab', { name: 'Corrigé', exact: true });
							await correctionTab.click();
							const confirmation = panel.page().getByRole('alertdialog', { name: 'Voir le corrigé ?' });
							await expect(confirmation).toBeVisible();
							await expect(confirmation.getByRole('button', { name: 'Voir le corrigé', exact: true })).not.toHaveClass(
								/bg-destructive/
							);
							await expect(correction).toBeHidden();
							await confirmation.getByRole('button', { name: 'Retour', exact: true }).click();
							await expect(correction).toBeHidden();
							await panel.getByRole('tab', { name: 'Énoncé', exact: true }).focus();
							await panel.page().keyboard.press('ArrowRight');
							await expect(correctionTab).toBeFocused();
							await expect(correction).toBeHidden();
							await expect(confirmation).toBeHidden();
							await panel.page().keyboard.press('Enter');
							await confirmation.getByRole('button', { name: 'Voir le corrigé', exact: true }).click();
							await expect(confirmation).toBeHidden();
							await expect(correction).toBeVisible();
							const solutionPanel = panel.getByRole('tabpanel', { name: 'Corrigé' });
							const solutionExample = solutionPanel.getByRole('region', {
								name: 'Exemple de code'
							});
							await expect(solutionExample.locator('code')).toHaveText('let count = 0;');
							expect(
								await solutionExample
									.locator('span')
									.filter({ hasText: 'let' })
									.evaluate((element) => getComputedStyle(element).color)
							).not.toBe(await solutionExample.evaluate((element) => getComputedStyle(element).color));
							await expect(solutionPanel.locator('p code')).toHaveText('count');
						}
						await expect(publicPanel.getByText('Corrigé librement accessible · 013', { exact: true })).toBeVisible();
						await expect(
							publicPanel.getByRole('region', { name: 'Code de l’exercice · Exercice libre · 013' }).locator('code')
						).toHaveText('const message = "Bonjour, 世界 👋";');
						const code = publicPanel.getByRole('region', {
							name: 'Code de l’exercice · Exercice libre · 013',
							exact: true
						});
						await expect(code).toHaveAttribute('tabindex', '0');
						await publicPage.bringToFront();
						await code.focus();
						await expect(code).toBeFocused();
						for (const panel of [privatePanel, publicPanel]) {
							await panel.page().bringToFront();
							await panel.getByRole('button', { name: 'Retour aux supports', exact: true }).click();
							await expect(panel.getByRole('button', { name: /Exercice libre · 013/ })).toBeFocused();
						}
					} else if (section.id === 'suivi') {
						for (const panel of [privatePanel, publicPanel]) {
							await panel.page().bringToFront();
							const card = panel.getByRole('button', { name: /Du brief à la navigation/ });
							await expect(card).toBeVisible();
							await expect(card).not.toContainText('Vu en cours');
							await expect(
								panel.getByText('Nous avons travaillé le brief, les parcours et la structure de l’application.')
							).toHaveCount(0);
							await card.focus();
							await panel.page().keyboard.press('Enter');
							await expect(panel.getByRole('heading', { name: 'Du brief à la navigation', exact: true })).toBeFocused();
							await expect(
								panel.getByText('Nous avons travaillé le brief, les parcours et la structure de l’application.')
							).toBeVisible();
							await expect(
								panel.getByText('Vérifier les parcours au clavier et préparer une première version fonctionnelle.')
							).toBeVisible();
							await panel.getByRole('button', { name: 'Retour aux séances', exact: true }).click();
							await expect(card).toBeFocused();
						}
					} else if (section.id === 'consignes') {
						await expect(publicPanel.getByText('Consigne publique du module · 013', { exact: true })).toBeVisible();
						await expect(publicPanel.getByRole('region', { name: /^Grille vierge ·/ })).toHaveCount(4);
						for (const panel of [privatePanel, publicPanel]) {
							const rubrics = panel.getByRole('region', { name: /^Grille vierge ·/ });
							for (const rubric of await rubrics.all()) {
								await rubric.locator('summary').click();
								await expect(rubric.getByRole('listitem').last()).toHaveCSS('border-bottom-width', '0px');
								await rubric.locator('summary').click();
							}
						}
					}
					for (const root of [previewRoot, publicRoot]) {
						await deadlinePresentation(root, section);
						await projectDocuments(root, section);
					}
				}
				// The reminder's action, unlike normal public tab selection, deliberately moves focus.
				await selectReview(page, app.ids.publicationContext, sections[0], width);
				await selectPublic(publicPage, app.ids.publicationContext, sections[0]);
				for (const [current, root, prefix] of [
					[page, previewRoot, 'review'],
					[publicPage, publicRoot, 'cours']
				] as const) {
					await current.bringToFront();
					const jump = root.getByRole('button', {
						name: 'Voir les modalités de remise',
						exact: true
					});
					await expect(jump).toHaveAttribute('type', 'button');
					const supportsHover = await current.evaluate(() => matchMedia('(hover: hover)').matches);
					if (supportsHover) {
						await jump.hover();
						await expect(current.getByRole('tooltip')).toHaveText('Voir les modalités de remise');
					} else {
						await expect(jump.getByText('Modalités de remise')).toBeVisible();
					}
					await jump.focus();
					await current.keyboard.press('Enter');
					const target = current.locator(`#${prefix}-${app.ids.publicationContext}-remise`);
					await expect(target).toBeFocused();
					await expect(target.getByRole('heading', { name: 'Échéances et remise', exact: true })).toBeInViewport();
					await deadlinePresentation(root, sections[2]);
				}
				if (width >= 1024) {
					const scroll = page.locator('.preview-content[data-course-scroll]');
					expect(
						await scroll.evaluate((node) => node.scrollHeight > node.clientHeight),
						'Desktop retains internal preview scrolling'
					).toBe(true);
				}
				await capture(page, app, info, `preview-remise-${width}-${theme}`);
				await capture(publicPage, app, info, `public-remise-${width}-${theme}`);
				if (width < 1024) {
					await reviewNavigation(page, width);
					await page.setViewportSize({ width: 1440, height: 900 });
					await expect(page.getByRole('dialog', { name: 'Choisir une section', exact: true })).toHaveCount(0);
					await expect(page.getByRole('navigation', { name: navigationName, exact: true })).toBeVisible();
					await expect(page.locator(`#review-${app.ids.publicationContext}-remise`)).toBeFocused();
					await page.setViewportSize({ width, height: 900 });
					await expect(page.getByRole('dialog', { name: 'Choisir une section', exact: true })).toHaveCount(0);
					await expect(page.getByRole('button', { name: /^Sections/ })).toBeVisible();
				}
			}
		}
		// Latest past deadline, not the first historical entry, remains the single compact reminder.
		for (const current of [page, publicPage]) {
			await current.clock.setFixedTime(new Date('2026-10-28T12:00:00Z'));
			await current.reload();
			const root = current === page ? previewRoot : publicRoot;
			await expect(root.getByRole('region', { name: 'Dernière échéance', exact: true })).toContainText(
				deadlines[0].label
			);
			await deadlinePresentation(root, sections[0], deadlines[0]);
		}
		const returnLink = publicRoot.getByRole('link', { name: 'Retour à la classe', exact: true });
		await expect(returnLink).toHaveAttribute('href', '/classes/' + app.ids.currentClass);
		await returnLink.click();
		await expect(publicPage).toHaveURL(app.origin + '/classes/' + app.ids.currentClass);
		await expect(publicPage.getByRole('main')).toHaveCount(1);
		await expect(publicPage.getByRole('link', { name: /Application web · publication démo/ })).toHaveAttribute(
			'href',
			publicPath
		);
	} finally {
		await publicPage.close();
	}
});

test('unpublished drafts, empty deadlines and an archived legacy context keep honest states', async ({
	app,
	page,
	request
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await activate(page, app);
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.secondModule}/publication?contexte=${app.ids.secondContext}`
	);
	await expect(page.locator('.publication-state')).toContainText(
		'Ce module n’a pas encore de page publique pour cette classe.'
	);
	expect((await request.get(`${app.origin}/modules/${app.ids.secondContext}`)).status()).toBe(404);
	const width = page.viewportSize()!.width;
	const preview = page.locator(`#review-${app.ids.secondContext}`);
	for (const section of sections) {
		await selectReview(page, app.ids.secondContext, section, width, false);
		await expect(preview.locator('.deadline-reminder')).toHaveCount(0);
		if (section.id === 'remise')
			await expect(
				preview.getByText('Aucune échéance ni modalité de remise n’est indiquée pour le moment.', {
					exact: true
				})
			).toBeVisible();
		if (section.id === 'suivi')
			await expect(
				preview.getByText('Aucun récapitulatif ni travail à faire n’est indiqué pour le moment.', {
					exact: true
				})
			).toBeVisible();
	}
	const publicPath = await publish(page, app, app.ids.secondModule, app.ids.secondContext);
	await page.goto(app.origin + publicPath);
	for (const section of sections) {
		await selectPublic(page, app.ids.secondContext, section, false);
		await expect(page.locator('.deadline-reminder')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Voir les modalités de remise', exact: true })).toHaveCount(0);
	}
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}/publication?contexte=${app.ids.currentContext}`);
	await expect(page.locator('.publication-state')).toContainText(
		'Ce module n’a pas encore de page publique pour cette classe.'
	);
	await expect(page.getByRole('button', { name: 'Publier pour cette classe', exact: true }).first()).toBeEnabled();
	expect((await request.get(`${app.origin}/modules/${app.ids.currentContext}`)).status()).toBe(404);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.module}/publication?contexte=${app.ids.oldContext}`);
	await expect(page.getByText('Classe archivée', { exact: true })).toBeVisible();
	await expect(page.getByText('Aucun contenu à prévisualiser', { exact: true })).toBeVisible();
	await expect(
		page.getByText('Ce contexte archivé ne possède pas de publication consultable.', {
			exact: true
		})
	).toBeVisible();
	await expect(page.getByRole('navigation', { name: navigationName, exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: /^Sections/ })).toHaveCount(0);
	await expect(page.getByRole('button', { name: /^Publier / })).toHaveCount(0);
	await expect(page.locator('.preview-content .course-section')).toHaveCount(0);
	const legacy = await request.get(`${app.origin}/modules/${app.ids.oldContext}`);
	expect(legacy.status()).toBe(404);
	expect(legacy.headers()['cache-control']).toBe('no-store');
	expect(legacy.headers()['x-robots-tag']).toBe('noindex, nofollow');
	await expect(await legacy.text()).not.toMatch(/Old Student Demo|Private fictional semester comment|Private proposal/);
	// Static empty-state text can arrive before Kit finishes importing the page runtime.
	await expect(page.getByRole('button', { name: 'Actualiser les références', exact: true }).first()).toBeEnabled();
});

test('annual continuation retains the published snapshot and an archived read-only preview of all five panels', async ({
	app,
	page,
	context,
	request
}) => {
	test.setTimeout(360000);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await activate(page, app);
	const publicPath = '/modules/' + app.ids.publicationContext;
	const before = await request.get(app.origin + publicPath + '/__data.json');
	expect(before.status()).toBe(200);
	const snapshot = await before.text();
	await page.goto(app.origin + '/enseignant/classes/annees?annee=2026-2027');
	await page.getByRole('button', { name: 'Préparer la clôture', exact: true }).click();
	await page.getByRole('button', { name: 'Vérifier et confirmer la clôture', exact: true }).click();
	const confirmation = page.getByRole('alertdialog');
	await expect(confirmation).toBeVisible();
	await confirmation.getByLabel(/^Année de reprise(?: \(optionnel\))?$/).fill('2027-2028');
	await confirmation.getByLabel('Application web · publication démo', { exact: true }).selectOption('continue');
	await confirmation.getByLabel('Recopiez l’année 2026-2027', { exact: true }).fill('2026-2027');
	await confirmation.getByRole('checkbox').check();
	const closed = page.waitForResponse(
		(response) =>
			response.url().endsWith('/enseignant/classes/annees?/decideYear') && response.request().method() === 'POST'
	);
	await confirmation.getByRole('button', { name: 'Clôturer 2026-2027', exact: true }).click();
	expect((await closed).status()).toBe(200);
	await expect(confirmation).not.toBeVisible();
	const retained = await request.get(app.origin + publicPath + '/__data.json');
	expect(retained.status()).toBe(200);
	const retainedSnapshot = await retained.text();
	// The class recovery link may follow the continued class; pedagogical snapshot fields stay public.
	expect(retainedSnapshot).toContain('"2026-2027"');
	expect(retainedSnapshot).not.toContain('"2027-2028"');
	expect(retainedSnapshot).toContain('course.pdf');
	expect(retainedSnapshot).not.toContain('course-version-2.pdf');
	expect(snapshot).toContain('course.pdf');
	const continuedResponse = await page.request.get(`${app.origin}/api/teaching/modules/${app.ids.publicationModule}`);
	expect(continuedResponse.status()).toBe(200);
	const continued = moduleDetailSchema.parse(await continuedResponse.json());
	const newContext = continued.contexts[0]?.id;
	expect(newContext).toBeDefined();
	expect(newContext).not.toBe(app.ids.publicationContext);
	await page.goto(`${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${newContext}`);
	await expect(page.getByLabel('Classe sélectionnée', { exact: true })).toContainText('2027-2028');
	await expect(page.locator('.publication-state')).toContainText(
		'Le brouillon a changé. La version publiée reste visible jusqu’à votre décision.'
	);
	await expect(page.locator(`#review-${newContext}`)).toContainText('2027-2028');
	await expect(page.getByRole('link', { name: 'Voir la page publiée · nouvel onglet', exact: true })).toHaveAttribute(
		'href',
		publicPath
	);
	// Select the actual historical context, whose renderer must use its retained v2 publication.
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.publicationModule}/publication?contexte=${app.ids.publicationContext}`
	);
	await expect(page.getByText('Classe archivée', { exact: true })).toBeVisible();
	await expect(page.getByText('Aperçu de la dernière publication · privé', { exact: true })).toBeVisible();
	await expect(page.locator(`#review-${app.ids.publicationContext}`)).toContainText('2026-2027');
	await expect(page.getByRole('button', { name: /^Publier / })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Dépublier', exact: true })).toBeEnabled();
	const publicPage = await context.newPage();
	try {
		await publicPage.goto(app.origin + publicPath);
		await expect(publicPage.getByRole('main')).toHaveCount(1);
		for (const section of sections) {
			const preview = await selectReview(page, app.ids.publicationContext, section, page.viewportSize()!.width, false);
			const published = await selectPublic(publicPage, app.ids.publicationContext, section, false);
			expect(await pedagogicalContent(preview)).toEqual(await pedagogicalContent(published));
			await projectDocuments(page.locator(`#review-${app.ids.publicationContext}`), section);
			await projectDocuments(publicPage.locator(`#cours-${app.ids.publicationContext}`), section);
		}
	} finally {
		await publicPage.close();
	}
});
