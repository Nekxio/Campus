import { readFormActionCommand, readFormActionReceipt } from './support/form-actions.js';
import { createClient, type Client } from '@libsql/client';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Page } from '@playwright/test';
import { agentProposalPayloadSchema } from '../../src/lib/domain/proposals.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';
import type { BrowserFixture } from './support/process.js';

const pointIndicator = 'Points proposés différents';
const commentDifferent = 'Commentaire proposé différent';
const commentIdentical = 'Commentaire proposé identique';
const decisionEndpoint = '**/enseignant/propositions?/decideProposal';

async function openProposal(page: Page, app: BrowserFixture) {
	await page.goto(`${app.origin}/enseignant/propositions?proposition=${app.ids.proposals[0]}`);
	await expect(page.locator('#proposal-points-form')).toBeVisible();
	const features = page.getByRole('tab', { name: 'Fonctionnalités', exact: true });
	await expect(features).toBeVisible();
	// SSR controls are visible before hydration; confirm a real state change before editing.
	const quality = page.getByRole('tab', { name: 'Qualité', exact: true });
	await expect(async () => {
		await quality.click();
		await expect(quality).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
	}).toPass({ timeout: 60000 });
	await features.click();
	await expect(features).toHaveAttribute('aria-selected', 'true');
}

function row(page: Page, label: string) {
	return page.locator('.proposal-score').filter({
		has: page.getByRole('rowheader').filter({ hasText: label })
	});
}

async function examineComment(page: Page) {
	await page.getByRole('button', { name: 'Examiner le commentaire', exact: true }).click();
	await expect(page.getByRole('region', { name: 'Comparaison du commentaire', exact: true })).toBeFocused();
}

async function proposalFixture(db: Client, app: BrowserFixture) {
	const result = await db.execute({
		sql: 'SELECT payload FROM correction_proposal WHERE id = ?',
		args: [app.ids.proposals[0]]
	});
	const payload = agentProposalPayloadSchema.parse(JSON.parse(String(result.rows[0].payload)));
	const scores = await db.execute({
		sql: 'SELECT s.line_id, s.points FROM score s JOIN correction c ON c.id = s.correction_id WHERE c.context_id = ? AND c.student_id = ? AND c.assessment_id = ?',
		args: [app.ids.currentContext, app.ids.students[0], app.ids.project]
	});
	const recorded = payload.scores.map(({ lineId }) => ({
		lineId,
		points: scores.rows.find((score) => score.line_id === lineId)!.points as number | null
	}));
	return { payload, recorded };
}

test('a late comment receipt cannot confirm a newer command after its form is reopened', async ({ page, app }) => {
	test.setTimeout(90000);
	await activate(page, app);
	await openProposal(page, app);
	await examineComment(page);
	let releaseFirst!: () => void;
	let releaseSecond!: () => void;
	const firstGate = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	const secondGate = new Promise<void>((resolve) => {
		releaseSecond = resolve;
	});
	const statuses: number[] = [];
	let requests = 0;
	await page.route(decisionEndpoint, async (route) => {
		const index = requests++;
		const response = await route.fetch();
		statuses[index] = response.status();
		await (index === 0 ? firstGate : secondGate);
		await route.fulfill({ response });
	});
	try {
		const form = page.locator('#proposal-comment-form');
		const content = page.getByRole('textbox', { name: 'Commentaire retenu (optionnel)', exact: true });
		const save = page.getByRole('button', { name: 'Reprendre le commentaire', exact: true });
		await content.fill('First recorded comment');
		await save.click();
		await expect.poll(() => statuses[0]).toBe(200);
		await page.getByRole('button', { name: 'Refermer le commentaire', exact: true }).click();
		await expect(form).toHaveCount(0);
		await examineComment(page);
		await expect(save).toBeEnabled();
		await content.fill('Newer rejected comment');
		await save.click();
		await expect.poll(() => statuses[1]).toBe(409);
		const firstResponse = page.waitForResponse(
			(response) => response.url().endsWith('/enseignant/propositions?/decideProposal') && response.status() === 200
		);
		releaseFirst();
		await (await firstResponse).finished();
		await page.evaluate(
			() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
		);
		await expect(form).toHaveAttribute('aria-busy', 'true');
		await expect(content).toHaveValue('Newer rejected comment');
		await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
		releaseSecond();
		await expect(form).toHaveAttribute('aria-busy', 'false');
		await expect(page.getByRole('alert')).toContainText('Vos saisies sont conservées');
		await expect(content).toHaveValue('Newer rejected comment');
		await expect(page.getByRole('button', { name: 'Actualiser les références', exact: true })).toBeVisible();
		const client = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
		try {
			const saved = await client.execute({
				sql: 'SELECT content FROM semester_comment WHERE context_id = ? AND student_id = ?',
				args: [app.ids.currentContext, app.ids.students[0]]
			});
			expect(saved.rows[0].content).toBe('First recorded comment');
		} finally {
			client.close();
		}
	} finally {
		releaseFirst();
		releaseSecond();
	}
});

test('proposed differences span all groups and remain independent of retained edits and decisions', async ({
	page,
	app
}) => {
	await activate(page, app);
	await openProposal(page, app);
	await expect(page.getByText('3 lignes proposées différentes sur 14', { exact: true })).toBeVisible();
	await expect(row(page, 'Navigation').getByText(pointIndicator, { exact: true })).toBeVisible();
	await expect(row(page, 'Filtres').getByText(pointIndicator, { exact: true })).toBeVisible();
	for (const label of ['Catalogue', 'Recherche']) {
		await expect(row(page, label)).toBeVisible();
		await expect(row(page, label).getByText(pointIndicator, { exact: true })).toHaveCount(0);
	}
	const total = page.getByRole('row').filter({ hasText: 'Total Fonctionnalités' });
	await expect(total.getByRole('cell')).toHaveText(['32 / 40', '35 / 40', '35 / 40']);
	await expect(page.getByText('Ajusté', { exact: true })).toHaveCount(0);
	const navigation = row(page, 'Navigation').getByRole('textbox');
	await navigation.focus();
	await expect(navigation).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(row(page, 'Catalogue').getByRole('textbox')).toBeFocused();
	await navigation.fill('3');
	await expect(row(page, 'Navigation').getByText('Ajusté', { exact: true })).toBeVisible();
	await expect(row(page, 'Navigation').getByText(pointIndicator, { exact: true })).toBeVisible();
	await expect(total.getByRole('cell')).toHaveText(['32 / 40', '35 / 40', '33 / 40']);
	await navigation.fill('5');
	await expect(row(page, 'Navigation').getByText('Ajusté', { exact: true })).toHaveCount(0);
	const catalogue = row(page, 'Catalogue').getByRole('textbox');
	await catalogue.fill('4');
	await expect(row(page, 'Catalogue').getByText('Ajusté', { exact: true })).toBeVisible();
	await expect(row(page, 'Catalogue').getByText(pointIndicator, { exact: true })).toHaveCount(0);
	await catalogue.fill('5');
	const seen: string[] = [];
	let indicators = 0;
	for (const [group, count] of [
		['Fonctionnalités', 8],
		['Qualité', 3],
		['Livraison', 3]
	] as const) {
		await page.getByRole('tab', { name: group, exact: true }).click();
		const rows = page.getByRole('tabpanel', { name: group, exact: true }).locator('.proposal-score');
		await expect(rows).toHaveCount(count);
		seen.push(...(await rows.getByRole('textbox').evaluateAll((inputs) => inputs.map((input) => input.id))));
		indicators += await rows.getByText(pointIndicator, { exact: true }).count();
		await expect(page.getByText('3 lignes proposées différentes sur 14', { exact: true })).toBeVisible();
	}
	expect(new Set(seen).size).toBe(14);
	expect(indicators).toBe(3);
	await page.getByRole('tab', { name: 'Fonctionnalités', exact: true }).click();
	await expect(page.getByText(commentDifferent, { exact: true })).toBeVisible();
	await examineComment(page);
	const comment = page.getByRole('textbox', {
		name: 'Commentaire retenu (optionnel)',
		exact: true
	});
	await comment.fill('Texte retenu fictif, indépendant');
	await expect(page.getByText('Texte retenu modifié', { exact: true })).toBeVisible();
	await expect(page.getByText(commentDifferent, { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Valider les points', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Valider les points', exact: true })).toHaveCount(0);
	await expect(page.getByText('0 lignes proposées différentes sur 14', { exact: true })).toBeVisible();
	await expect(page.getByText(pointIndicator, { exact: true })).toHaveCount(0);
	await expect(comment).toHaveValue('Texte retenu fictif, indépendant');
	await expect(page.getByRole('button', { name: 'Reprendre le commentaire', exact: true })).toBeEnabled();
	await expect(page.getByText(commentDifferent, { exact: true })).toBeVisible();
});

test('unchanged, points-only, comment-only and omitted/null/zero proposals stay distinct', async ({ page, app }) => {
	// Only the harness-owned, newly created fictional database is opened, never configured data.
	const db = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		const { payload, recorded } = await proposalFixture(db, app);
		const storedComment = await db.execute({
			sql: 'SELECT content FROM semester_comment WHERE context_id = ? AND student_id = ?',
			args: [app.ids.currentContext, app.ids.students[0]]
		});
		const originalComment = String(storedComment.rows[0].content);
		await activate(page, app);
		for (const mode of ['unchanged', 'points-only', 'comment-only', 'omitted-null-zero'] as const) {
			const next = { ...payload, scores: recorded.map((score) => ({ ...score })) };
			if (mode === 'unchanged') next.semesterComment = originalComment;
			if (mode === 'points-only') {
				next.scores[0].points = 5;
				delete next.semesterComment;
				delete next.commentRevision;
			}
			if (mode === 'omitted-null-zero') {
				for (const [index, points] of [
					[1, null],
					[2, 0],
					[3, null],
					[4, 0]
				] as const) {
					await db.execute({
						sql: 'UPDATE score SET points = ? WHERE line_id = ? AND correction_id IN (SELECT id FROM correction WHERE context_id = ? AND student_id = ? AND assessment_id = ?)',
						args: [points, recorded[index].lineId, app.ids.currentContext, app.ids.students[0], app.ids.project]
					});
				}
				next.scores = [
					{ lineId: recorded[1].lineId, points: null },
					{ lineId: recorded[2].lineId, points: null },
					{ lineId: recorded[3].lineId, points: 0 },
					{ lineId: recorded[4].lineId, points: 0 }
				];
				next.semesterComment = '';
			}
			await db.execute({
				sql: 'UPDATE correction_proposal SET payload = ?, comment_state = ? WHERE id = ?',
				args: [JSON.stringify(next), mode === 'points-only' ? 'none' : 'pending', app.ids.proposals[0]]
			});
			await openProposal(page, app);
			const different = mode === 'points-only' ? 1 : mode === 'omitted-null-zero' ? 2 : 0;
			await expect(page.getByText(`${different} lignes proposées différentes sur 14`, { exact: true })).toBeVisible();
			await expect(page.locator('.proposal-score')).toHaveCount(14);
			await expect(
				page.getByRole('tabpanel', { name: 'Fonctionnalités', exact: true }).locator('.proposal-score')
			).toHaveCount(8);
			await expect(page.getByText(pointIndicator, { exact: true })).toHaveCount(different);
			await expect(page.getByText(commentDifferent, { exact: true })).toHaveCount(
				mode === 'comment-only' || mode === 'omitted-null-zero' ? 1 : 0
			);
			await expect(page.getByText(commentIdentical, { exact: true })).toHaveCount(mode === 'unchanged' ? 1 : 0);
			if (mode === 'points-only') {
				await expect(page.getByRole('button', { name: 'Examiner le commentaire', exact: true })).toHaveCount(0);
			}
			if (mode === 'omitted-null-zero') {
				await expect(row(page, 'Navigation').getByText('Non proposé', { exact: true })).toBeVisible();
				await expect(row(page, 'Navigation').getByRole('textbox')).toHaveValue('4');
				await expect(row(page, 'Catalogue').getByRole('textbox')).toHaveValue('');
				await expect(row(page, 'Catalogue').getByText(pointIndicator, { exact: true })).toHaveCount(0);
				await expect(row(page, 'Recherche').getByRole('textbox')).toHaveValue('');
				await expect(row(page, 'Filtres').getByRole('textbox')).toHaveValue('0');
				await expect(row(page, 'Authentification').getByRole('textbox')).toHaveValue('0');
				await examineComment(page);
				await expect(page.getByRole('textbox', { name: 'Commentaire retenu (optionnel)', exact: true })).toHaveValue(
					''
				);
			}
		}
		for (const [stored, proposed, different] of [
			['', '', false],
			['Texte', 'Texte', false],
			['Texte', ' Texte ', true],
			['Texte', '', true]
		] as const) {
			await db.execute({
				sql: 'UPDATE semester_comment SET content = ? WHERE context_id = ? AND student_id = ?',
				args: [stored, app.ids.currentContext, app.ids.students[0]]
			});
			await db.execute({
				sql: 'UPDATE correction_proposal SET payload = ? WHERE id = ?',
				args: [JSON.stringify({ ...payload, semesterComment: proposed }), app.ids.proposals[0]]
			});
			await openProposal(page, app);
			await expect(page.getByText(different ? commentDifferent : commentIdentical, { exact: true })).toBeVisible();
		}
	} finally {
		db.close();
	}
});

test('real 409 retains point and comment drafts and refresh still blocks stale acceptance', async ({ page, app }) => {
	await activate(page, app);
	await openProposal(page, app);
	const points = row(page, 'Navigation').getByRole('textbox');
	await points.fill('3');
	await examineComment(page);
	const comment = page.getByRole('textbox', {
		name: 'Commentaire retenu (optionnel)',
		exact: true
	});
	await comment.fill('Brouillon fictif après conflit');
	await app.call('conflict-correction');
	const response = page.waitForResponse(
		(response) => response.url().endsWith('/enseignant/propositions?/decideProposal') && response.status() === 409
	);
	await page.getByRole('button', { name: 'Valider les points', exact: true }).click();
	await response;
	await expect(page.getByRole('alert').filter({ hasText: 'Version à actualiser' })).toBeFocused();
	await expect(points).toHaveValue('3');
	await expect(comment).toHaveValue('Brouillon fictif après conflit');
	await expect(page.getByRole('button', { name: 'Valider les points', exact: true })).toBeDisabled();
	await page.getByRole('button', { name: 'Actualiser les références', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Actualiser et conserver mes saisies', exact: true })).toBeVisible();
	await expect(points).toHaveValue('3');
	await expect(comment).toHaveValue('Brouillon fictif après conflit');
	await expect(page.getByRole('button', { name: 'Valider les points', exact: true })).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Reprendre le commentaire', exact: true })).toBeDisabled();
	await expect(page.getByText('11 lignes proposées différentes sur 14', { exact: true })).toBeVisible();
	await expect(row(page, 'Navigation').getByText(pointIndicator, { exact: true })).toHaveCount(0);
	await expect(row(page, 'Navigation').getByText('Ajusté', { exact: true })).toBeVisible();
});

test('lost comment and refusal responses retry identical commands without overwriting recorded points', async ({
	page,
	app
}) => {
	const db = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		const correctionSnapshot = () =>
			db.execute({
				sql: 'SELECT c.*, s.line_id, s.points FROM correction c LEFT JOIN score s ON s.correction_id = c.id WHERE c.context_id = ? AND c.student_id = ? ORDER BY c.id, s.line_id',
				args: [app.ids.currentContext, app.ids.students[0]]
			});
		const before = (await correctionSnapshot()).rows;
		await activate(page, app);
		await openProposal(page, app);
		await examineComment(page);
		const comment = page.getByRole('textbox', {
			name: 'Commentaire retenu (optionnel)',
			exact: true
		});
		await comment.fill('Commentaire accepté fictif puis refus des seuls points');
		for (const [action, label] of [
			['accept_comment', 'Reprendre le commentaire'],
			['reject', 'Refuser']
		] as const) {
			const bodies: string[] = [];
			const receipts: unknown[] = [];
			await page.route(decisionEndpoint, async (route) => {
				const body = JSON.stringify((await readFormActionCommand<{ decision: unknown }>(route.request())).decision);
				expect(JSON.parse(body).action).toBe(action);
				bodies.push(body);
				const response = await route.fetch().catch(() => {
					throw new Error('Owned fictional decision request failed.');
				});
				expect(response.status()).toBe(200);
				receipts.push(await readFormActionReceipt(response));
				if (bodies.length === 1) await route.abort('failed');
				else await route.fulfill({ response });
			});
			const decide = page.getByRole('button', { name: label, exact: true });
			await decide.click();
			await expect(page.getByRole('alert').filter({ hasText: 'Décision à vérifier' })).toBeVisible();
			await expect(comment).toHaveValue('Commentaire accepté fictif puis refus des seuls points');
			await decide.click();
			await expect.poll(() => bodies.length).toBe(2);
			await expect.poll(() => receipts.length).toBe(2);
			expect(bodies[1] === bodies[0], 'Exact command body and requestId retried').toBe(true);
			expect(isDeepStrictEqual(receipts[1], receipts[0]), 'Original receipt returned').toBe(true);
			if (action === 'accept_comment') {
				await expect(page.getByText('Commentaire retenu enregistré.', { exact: true })).toBeVisible();
				await expect(page.getByText(commentDifferent, { exact: true })).toHaveCount(0);
			} else {
				await expect(page.getByRole('button', { name: 'Refuser', exact: true })).toHaveCount(0);
				await expect(
					page.getByText(
						/Proposition refusée\. Les points enregistrés sont conservés ; le commentaire déjà repris reste enregistré\./
					)
				).toBeVisible();
			}
			await page.unroute(decisionEndpoint);
		}
		expect((await correctionSnapshot()).rows).toEqual(before);
		const saved = await db.execute({
			sql: 'SELECT content FROM semester_comment WHERE context_id = ? AND student_id = ?',
			args: [app.ids.currentContext, app.ids.students[0]]
		});
		expect(saved.rows[0].content).toBe('Commentaire accepté fictif puis refus des seuls points');
		const decisions = await db.execute({
			sql: 'SELECT COUNT(*) AS count FROM proposal_decision WHERE proposal_id = ?',
			args: [app.ids.proposals[0]]
		});
		expect(decisions.rows[0].count).toBe(2);
	} finally {
		db.close();
	}
});

test('accepted points with a retired assessment can close the pending comment and retry a lost response', async ({
	page,
	app
}) => {
	const db = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		await activate(page, app);
		await openProposal(page, app);
		const acceptance = page.waitForResponse(
			(response) =>
				response.url().endsWith('/enseignant/propositions?/decideProposal') && response.request().method() === 'POST'
		);
		await page.getByRole('button', { name: 'Valider les points', exact: true }).click();
		const accepted = await acceptance;
		expect(accepted.status()).toBe(200);
		expect(await readFormActionReceipt(accepted)).toMatchObject({ state: 'accepted', commentState: 'pending' });
		await expect(page.getByRole('button', { name: 'Valider les points', exact: true })).toHaveCount(0);
		await expect(page.locator('#proposal-points-form')).toHaveAttribute('aria-busy', 'false');
		const correctionSnapshot = () =>
			db.execute({
				sql: 'SELECT c.*, s.line_id, s.points FROM correction c LEFT JOIN score s ON s.correction_id = c.id WHERE c.context_id = ? AND c.student_id = ? ORDER BY c.id, s.line_id',
				args: [app.ids.currentContext, app.ids.students[0]]
			});
		const commentSnapshot = () =>
			db.execute({
				sql: 'SELECT * FROM semester_comment WHERE context_id = ? AND student_id = ?',
				args: [app.ids.currentContext, app.ids.students[0]]
			});
		const savedPoints = (await correctionSnapshot()).rows;
		const savedComment = (await commentSnapshot()).rows;
		await app.call('retire-proposal-assessment');
		await page.goto(`${app.origin}/enseignant/propositions?proposition=${app.ids.proposals[0]}`);
		await expect(page.getByText('Évaluation indisponible', { exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Refuser la proposition', exact: true })).toHaveCount(0);
		const keep = page.getByRole('button', { name: 'Conserver mon commentaire', exact: true });
		await expect(keep).toBeVisible();
		const queueLink = page.locator(`a[data-row-link][href*="proposition=${app.ids.proposals[0]}"]`);
		await expect(queueLink).toBeVisible();
		const search = page.getByRole('searchbox', { name: 'Rechercher une proposition' });
		await expect(async () => {
			await search.fill('aucune-proposition-de-test');
			await expect(page.getByText('Aucune proposition pour ces filtres')).toBeVisible({
				timeout: 1000
			});
		}).toPass({ timeout: 60000 });
		await search.fill('');
		const bodies: string[] = [];
		const receipts: unknown[] = [];
		await page.route(decisionEndpoint, async (route) => {
			const body = JSON.stringify((await readFormActionCommand<{ decision: unknown }>(route.request())).decision);
			expect(JSON.parse(body).action).toBe('keep_comment');
			bodies.push(body);
			const response = await route.fetch();
			expect(response.status()).toBe(200);
			receipts.push(await readFormActionReceipt(response));
			if (bodies.length === 1) await route.abort('failed');
			else await route.fulfill({ response });
		});
		await keep.click();
		await expect(page.getByRole('alert').filter({ hasText: 'Propositions indisponibles' })).toBeVisible();
		await expect(keep).toBeEnabled();
		await keep.click();
		await expect(keep).toHaveCount(0);
		await expect(queueLink).toHaveCount(0);
		expect(bodies).toHaveLength(2);
		expect(bodies[1]).toBe(bodies[0]);
		expect(receipts[1]).toEqual(receipts[0]);
		expect(receipts[1]).toMatchObject({ state: 'accepted', commentState: 'kept' });
		expect((await correctionSnapshot()).rows).toEqual(savedPoints);
		expect((await commentSnapshot()).rows).toEqual(savedComment);
		const decisions = await db.execute({
			sql: 'SELECT COUNT(*) AS count FROM proposal_decision WHERE proposal_id = ?',
			args: [app.ids.proposals[0]]
		});
		expect(decisions.rows[0].count).toBe(2);
	} finally {
		db.close();
	}
});

test('comparison indicators reflow with long labels and many criteria in the bounded theme batch', async ({
	page,
	app,
	request
}, info) => {
	const fontResponses: { resourceType: string; url: string; status: number }[] = [];
	const fontChecks: {
		width: number;
		theme: string;
		faces: { family: string; status: string; weight: string }[][];
		probe: { url: string; status: number; bytes: number; sha256: string; signature: string };
	}[] = [];
	page.on('response', (response) => {
		const pathname = new URL(response.url()).pathname;
		if (/\/inter-[^/]+\.woff2$/.test(pathname)) {
			fontResponses.push({
				resourceType: response.request().resourceType(),
				url: response.url(),
				status: response.status()
			});
		}
	});
	const db = createClient({ url: pathToFileURL(app.manifest.databasePath).href });
	try {
		const { payload } = await proposalFixture(db, app);
		await db.execute({
			sql: 'UPDATE student SET name = ? WHERE id = ?',
			args: ['Alexandrine-Marie Trèslongnom日本語'.repeat(4), app.ids.students[0]]
		});
		await db.execute({
			sql: 'UPDATE rubric_line SET label = ?, description = ? WHERE id = ?',
			args: ['NavigationSansEspace'.repeat(6), 'Repère pédagogique détaillé 日本語 🧪 '.repeat(6), app.ids.firstLine]
		});
		for (let index = 14; index < 40; index += 1) {
			const lineId = crypto.randomUUID();
			await db.execute({
				sql: 'INSERT INTO rubric_line (id, assessment_id, group_id, label, description, max_points, position) SELECT ?, assessment_id, group_id, ?, ?, 5, ? FROM rubric_line WHERE id = ?',
				args: [
					lineId,
					`Critère supplémentaire ${index + 1}`,
					'Conserve toutes les lignes inchangées.',
					index,
					app.ids.firstLine
				]
			});
			await db.execute({
				sql: 'INSERT INTO score (id, correction_id, assessment_id, line_id, points) SELECT ?, id, assessment_id, ?, 0 FROM correction WHERE context_id = ? AND student_id = ? AND assessment_id = ?',
				args: [crypto.randomUUID(), lineId, app.ids.currentContext, app.ids.students[0], app.ids.project]
			});
			payload.scores.push({ lineId, points: 0 });
		}
		await db.execute({
			sql: 'UPDATE correction_proposal SET payload = ? WHERE id = ?',
			args: [JSON.stringify(payload), app.ids.proposals[0]]
		});
		await activate(page, app);
		await openProposal(page, app);
		const widths = info.project.name === 'desktop' ? [1440, 1024] : [390, 320];
		for (const width of widths) {
			await page.setViewportSize({ width, height: width >= 1024 ? 900 : 844 });
			for (const theme of ['light', 'dark'] as const) {
				await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
				await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), theme === 'dark');
				const faces = await page.evaluate(async () => {
					return Promise.all(
						[400, 500, 600, 700].map(async (weight) => {
							const loaded = await document.fonts.load(`${weight} 16px "Inter Variable"`, 'Navigation Évaluation 0123');
							return loaded.map((face) => ({
								family: face.family,
								status: face.status,
								weight: face.weight
							}));
						})
					);
				});
				for (const weightFaces of faces) {
					expect(weightFaces.length, 'Inter load returns actual font faces').toBeGreaterThan(0);
					expect(
						weightFaces.every((face) => face.family.includes('Inter') && face.status === 'loaded'),
						'Every requested Inter face loaded'
					).toBe(true);
				}
				const actualFonts = fontResponses.filter((response) => response.resourceType === 'font');
				const latinFont = actualFonts.find((response) => {
					const url = new URL(response.url);
					return url.pathname.endsWith('/inter-latin-wght-normal.woff2') && !url.searchParams.has('import');
				});
				if (!latinFont) {
					throw new Error(`No actual Inter font request: ${JSON.stringify(fontResponses)}`);
				}
				expect(new URL(latinFont.url).origin, 'Font GET stays on owned origin').toBe(app.origin);
				const response = await request.get(latinFont.url).catch(() => {
					throw new Error('Owned Inter font GET failed.');
				});
				const bytes = await response.body();
				const probe = {
					url: latinFont.url,
					status: response.status(),
					bytes: bytes.byteLength,
					sha256: createHash('sha256').update(bytes).digest('hex'),
					signature: bytes.subarray(0, 4).toString('ascii')
				};
				fontChecks.push({ width, theme, faces, probe });
				await info.attach(`inter-font-load-${width}-${theme}`, {
					body: JSON.stringify({ faces, probe, fontResponses }, null, 2),
					contentType: 'application/json'
				});
				expect(probe.status, 'Direct actual Inter WOFF2 GET').toBe(200);
				expect(probe.bytes, 'Installed Latin Inter WOFF2 byte length').toBe(48256);
				expect(probe.signature, 'Direct GET returns WOFF2 rather than a Vite module').toBe('wOF2');
				expect(
					actualFonts.some((font) => font.status === 200),
					`An actual Inter font response is HTTP 200: ${JSON.stringify(actualFonts)}`
				).toBe(true);
				expect(
					actualFonts.every((font) => font.status === 200 || font.status === 304),
					`Actual Inter font responses are delivered or cache-revalidated: ${JSON.stringify(actualFonts)}`
				).toBe(true);
				expect(
					fontResponses.filter((font) => font.status === 403),
					`No Inter request is forbidden: ${JSON.stringify(fontResponses)}`
				).toEqual([]);
				if (width < 1280) {
					await page.getByText('3 lignes proposées différentes sur 40', { exact: true }).evaluate((element) => {
						window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 64);
					});
				} else {
					await page.locator('#proposal-points-form').scrollIntoViewIfNeeded();
				}
				await expect(page.getByText('3 lignes proposées différentes sur 40', { exact: true })).toBeVisible();
				await expect(page.locator('.proposal-score')).toHaveCount(40);
				await expect(
					page.getByRole('tabpanel', { name: 'Fonctionnalités', exact: true }).locator('.proposal-score')
				).toHaveCount(34);
				expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
				for (const badge of await page.locator('.proposal-score').getByText(pointIndicator, { exact: true }).all()) {
					expect(await badge.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
				}
				if (width === 1440) {
					await expect(page.locator('.context-strip')).toBeInViewport();
					await expect(page.locator('.bottom-summary')).toBeInViewport();
					const scroller = page.getByRole('region', {
						name: 'Comparaison des points de Fonctionnalités',
						exact: true
					});
					expect(await scroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
					await scroller.evaluate((element) => {
						element.scrollTop = element.scrollHeight;
					});
					await expect(page.locator('.context-strip')).toBeInViewport();
					await expect(page.locator('.bottom-summary')).toBeInViewport();
					await scroller.evaluate((element) => {
						element.scrollTop = 0;
					});
				}
				await page.screenshot({ path: info.outputPath(`comparison-${width}-${theme}.png`) });
				const examine = page.getByRole('button', { name: 'Examiner le commentaire', exact: true });
				await examine.scrollIntoViewIfNeeded();
				await examine.focus();
				await page.keyboard.press('Enter');
				await expect(page.getByRole('region', { name: 'Comparaison du commentaire', exact: true })).toBeFocused();
				await expect(page.getByRole('textbox', { name: 'Commentaire retenu (optionnel)', exact: true })).toBeVisible();
				expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
				await page.screenshot({ path: info.outputPath(`comment-${width}-${theme}.png`) });
				await page.getByRole('button', { name: 'Refermer le commentaire', exact: true }).click();
			}
		}
	} finally {
		db.close();
		await info.attach('inter-font-geometry', {
			body: JSON.stringify({ project: info.project.name, fontResponses, fontChecks }, null, 2),
			contentType: 'application/json'
		});
	}
});
