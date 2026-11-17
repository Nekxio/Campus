import { createClient } from '@libsql/client';
import { pathToFileURL } from 'node:url';
import { createDatabase } from '../../src/lib/server/db/index.js';
import { createModule } from '../../src/lib/server/teaching/service.js';
import { getAnnualData } from '../../src/lib/server/teaching/annual.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('prepared resources and annual module follow-ups describe their actual scope', async ({ page, app }) => {
	const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	const db = createDatabase(client);
	try {
		const module = await createModule(db, {
			title: 'Fictional unpublished resource counter',
			description: '',
			objectives: [],
			sourcePath: '',
			preparation: { framing: '', nextSteps: '', sourceLinks: [] },
			resources: [
				{
					id: crypto.randomUUID(),
					label: 'Documentation fictive',
					url: 'https://example.test/reference',
					kind: 'resource'
				}
			],
			contexts: []
		});
		await activate(page, app);
		const entry = page
			.locator('.module-entry')
			.filter({ has: page.getByRole('link', { name: module.title, exact: true }) });
		await expect(entry).toContainText('1 ressource préparée');
		await expect(entry).not.toContainText('lien étudiant');
		await expect(entry.getByRole('link')).toHaveCount(3);
		const preview = (await getAnnualData(db, app.ids.teacher, '2026-2027')).selected!;
		await page.goto(`${app.origin}/enseignant/classes/annees?annee=2026-2027`);
		await expect(page.locator('.annual-scope')).toContainText(`${preview.preserved.contexts} suivis de module`);
		await expect(page.locator('.annual-scope')).toContainText(
			'Un suivi correspond à un module pour une classe et cette année.'
		);
		await page.getByRole('button', { name: 'Préparer la clôture', exact: true }).click();
		await expect(page.getByRole('region', { name: 'Bilan de l’année', exact: true })).toContainText(
			`${preview.preserved.contexts} suivis de module`
		);
	} finally {
		client.close();
	}
});
