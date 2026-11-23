import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../../src/lib/server/db/index.js';
import * as tables from '../../src/lib/server/db/schema.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('publication preparation identifies long context and only counts student-visible content', async ({
	app,
	page
}, info) => {
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	const db = createDatabase(client);
	const className = 'Test UX — Web A — Une promotion avec un nom particulièrement long';
	const moduleId = crypto.randomUUID();
	const contextId = crypto.randomUUID();
	try {
		await db.update(tables.classes).set({ name: className }).where(eq(tables.classes.id, app.ids.currentClass));
		await db.insert(tables.modules).values({
			id: moduleId,
			title: 'Test UX — Publication',
			preparation: { framing: 'PRIVATE_PREPARATION', nextSteps: '', sourceLinks: [] }
		});
		await db.insert(tables.teachingContexts).values({
			id: contextId,
			moduleId,
			classId: app.ids.currentClass,
			className,
			academicYear: '2026-2027'
		});
		await db.insert(tables.resources).values([
			{
				id: crypto.randomUUID(),
				moduleId,
				label: 'Consignes externes',
				kind: 'instructions',
				url: 'https://example.test/instructions.pdf'
			},
			{
				id: crypto.randomUUID(),
				moduleId,
				label: 'Diaporama du module',
				kind: 'course',
				url: 'https://example.test/course.pdf'
			}
		]);
		await db.insert(tables.lessons).values({
			id: crypto.randomUUID(),
			contextId,
			title: 'Séance privée',
			startsAt: new Date('2026-11-01T09:00:00Z'),
			endsAt: new Date('2026-11-01T12:00:00Z')
		});
	} finally {
		client.close();
	}
	await activate(page, app);
	await page.goto(`${app.origin}/enseignant/modules/${moduleId}/publication?contexte=${contextId}`);
	const identity = page.getByLabel('Classe sélectionnée', { exact: true });
	await expect(identity).toHaveText(className);
	const summary = page.locator('details.preparation-review');
	const toggle = summary.locator(':scope > summary');
	await expect(summary).toBeVisible();
	await expect(summary).not.toHaveAttribute('open', '');
	await expect(toggle).toContainText('2 / 6 contenus présents');
	await toggle.click();
	const presentContents = summary.locator('details').filter({ hasText: 'Contenus présents' });
	await expect(presentContents).not.toHaveAttribute('open', '');
	await expect(summary.locator('li')).toHaveCount(6);
	await expect(summary.getByRole('heading', { name: 'Contenus absents de l’aperçu' })).toBeVisible();
	const complementary = summary.getByRole('listitem').filter({ hasText: 'Ressources complémentaires' });
	await expect(complementary.getByText('Aucune', { exact: true })).toBeVisible();
	await expect(complementary.getByRole('link', { name: 'Ajouter des ressources complémentaires' })).toHaveAttribute(
		'href',
		/section=resources/
	);
	await presentContents.locator('summary').click();
	await expect(summary.getByRole('listitem').filter({ hasText: 'Supports du cours' })).toContainText('Présent');
	await expect(summary.getByRole('listitem').filter({ hasText: 'Consignes' })).toContainText('Présent');
	await presentContents.locator('summary').click();
	await expect(summary.getByRole('listitem').filter({ hasText: 'Barème' })).toContainText('Absent');
	await expect(summary.getByRole('listitem').filter({ hasText: 'Séances' })).toContainText('Absent');
	await expect(summary).not.toContainText('PRIVATE_PREPARATION');
	await expect(page.getByRole('button', { name: 'Publier pour cette classe', exact: true }).first()).toBeEnabled();
	await expect(identity).toHaveCSS('white-space', 'normal');
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
	expect(await identity.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
	const complete = summary.getByRole('link', { name: 'Compléter le barème', exact: true });
	await complete.focus();
	await expect(complete).toBeFocused();
	await page.screenshot({ path: info.outputPath('publication-readiness.png'), fullPage: true });
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(
		(url) =>
			url.pathname === `/enseignant/modules/${moduleId}/bareme` &&
			url.searchParams.get('contexte') === contextId &&
			url.searchParams.get('annee') === '2026-2027' &&
			url.searchParams.get('classe') === app.ids.currentClass
	);
	const filledClient = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		const filled = createDatabase(filledClient);
		for (const kind of ['rubric', 'resource'] as const) {
			await filled.insert(tables.resources).values({
				id: crypto.randomUUID(),
				moduleId,
				label: `Test UX — ${kind}`,
				kind,
				url: `https://example.test/${kind}.pdf`
			});
		}
		const assessmentId = crypto.randomUUID();
		await filled
			.insert(tables.assessments)
			.values({ id: assessmentId, moduleId, title: 'Test UX — Remise', kind: 'project' });
		await filled.insert(tables.assessmentDeadlines).values({
			moduleId,
			contextId,
			assessmentId,
			dueAt: new Date('2026-12-01T12:00:00Z'),
			submissionInstructions: 'Test UX — Déposer le dossier'
		});
		await filled
			.update(tables.lessons)
			.set({ recap: 'Test UX — Bilan visible par les étudiants' })
			.where(eq(tables.lessons.contextId, contextId));
	} finally {
		filledClient.close();
	}
	await page.goto(`${app.origin}/enseignant/modules/${moduleId}/publication?contexte=${contextId}`);
	await expect(summary).not.toHaveAttribute('open', '');
	await expect(toggle).toContainText('6 / 6 contenus présents');
	await toggle.click();
	await expect(presentContents).not.toHaveAttribute('open', '');
	await expect(summary.locator('li')).toHaveCount(6);
	await expect(summary.getByRole('link')).toHaveCount(0);
	await presentContents.locator('summary').click();
	await expect(summary.getByText('Présent', { exact: true })).toHaveCount(6);
	await expect(summary.getByRole('heading', { name: 'Contenus absents de l’aperçu' })).toHaveCount(0);
	await expect(summary.getByRole('link')).toHaveCount(6);
	await presentContents.locator('summary').click();
	await expect(page.getByRole('button', { name: 'Publier pour cette classe', exact: true }).first()).toBeEnabled();
	await page.screenshot({ path: info.outputPath('publication-ready.png'), fullPage: true });
});
