import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

test('correction to rubric and back retains a non-first student through reload and history', async ({ app, page }) => {
	await activate(page, app);
	const studentId = app.ids.students[1];
	await page.goto(`${app.origin}/enseignant/notation/${app.ids.currentContext}/${studentId}`);
	await page.getByRole('link', { name: 'Voir le barème', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Retour à la grille', exact: true })).toBeEnabled();
	await page.reload();
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'Retour à la grille', exact: true }).click();
	await expect.poll(() => new URL(page.url()).pathname).toBe('/enseignant/notation');
	await expect.poll(() => new URL(page.url()).searchParams.get('etudiant')).toBe(studentId);
	for (const [key, value] of Object.entries({
		annee: '2026-2027',
		classe: app.ids.currentClass,
		module: app.ids.module,
		contexte: app.ids.currentContext
	}))
		expect(new URL(page.url()).searchParams.get(key)).toBe(value);
	await expect(page.getByRole('link', { name: 'Ouvrir la correction détaillée', exact: true })).toHaveAttribute(
		'href',
		`/enseignant/notation/${app.ids.currentContext}/${studentId}`
	);
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect.poll(() => new URL(page.url()).searchParams.get('etudiant')).toBe(studentId);
	await page.goBack();
	await expect.poll(() => new URL(page.url()).pathname).toBe(`/enseignant/modules/${app.ids.module}/bareme`);
	await expect(page.getByRole('button', { name: 'Retour à la grille', exact: true })).toBeEnabled();
	await page.goForward();
	await expect.poll(() => new URL(page.url()).searchParams.get('etudiant')).toBe(studentId);
	await page.goto(
		`${app.origin}/enseignant/modules/${app.ids.module}/bareme?contexte=${app.ids.currentContext}&etudiant=unavailable`
	);
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'Retour à la grille', exact: true }).click();
	await expect.poll(() => new URL(page.url()).pathname).toBe('/enseignant/notation');
	await expect.poll(() => new URL(page.url()).searchParams.has('etudiant')).toBe(false);
	await page.getByRole('region', { name: 'Étudiants', exact: true }).getByRole('button', { pressed: true }).click();
	await expect(page.getByRole('link', { name: 'Ouvrir la correction détaillée', exact: true })).toHaveAttribute(
		'href',
		`/enseignant/notation/${app.ids.currentContext}/${app.ids.students[0]}`
	);
});
