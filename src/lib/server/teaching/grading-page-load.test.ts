import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client, type InStatement } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import * as tables from '../db/schema.js';
import { seedGradingFixtures } from '../db/testing/grading-fixtures.js';
import { createClass } from './service.js';

vi.mock('./database.js', () => ({ withTeacherDatabase: vi.fn() }));

import { withTeacherDatabase } from './database.js';
import { getGradeWorkspace, gradingPreference, gradingYearCookie } from './grading-selection.js';
import { load } from '../../../routes/enseignant/notation/+page.server.js';

let client: Client;
let db: Database;
let ids: Awaited<ReturnType<typeof seedGradingFixtures>>;
let statements: string[];

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedGradingFixtures(db);
	statements = [];
	const execute = client.execute.bind(client);
	vi.spyOn(client, 'execute').mockImplementation(async (statement: InStatement | string) => {
		statements.push(typeof statement === 'string' ? statement : statement.sql);
		return execute(statement);
	});
	vi.mocked(withTeacherDatabase).mockImplementation((_locals, operation) => operation(db));
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetAllMocks();
	client.close();
	vi.useRealTimers();
});

const canonicalSearch = () =>
	`?annee=2026-2027&classe=${ids.currentClass}&module=${ids.module}&contexte=${ids.currentContext}`;

const rememberedContext = () => ({
	academicYear: '2026-2027',
	classId: ids.currentClass,
	moduleId: ids.module,
	contextId: ids.currentContext
});

const request = (search: string, preference?: unknown) => {
	const values = new Map<string, string>();
	if (preference !== undefined) values.set(gradingYearCookie, JSON.stringify(preference));
	const cookies = {
		get: (name: string) => values.get(name),
		set: vi.fn((name: string, value: string) => values.set(name, value)),
		delete: vi.fn((name: string) => values.delete(name))
	};
	const event = {
		locals: {
			user: { id: ids.teacher, role: 'teacher' },
			session: { userId: ids.teacher, expiresAt: new Date('2099-01-01') }
		},
		url: new URL(`https://fixture.invalid/enseignant/notation${search}`),
		cookies
	} as unknown as Parameters<typeof load>[0];
	return { event, cookies };
};

const expectNoGradeReads = () => {
	const tables = statements.flatMap((statement) =>
		[...statement.matchAll(/\b(?:from|join)\s+"([^"]+)"/g)].map((match) => match[1])
	);
	expect(
		tables.filter((table) =>
			[
				'assessment',
				'assessment_deadline',
				'rubric_group',
				'rubric_line',
				'result_definition',
				'correction',
				'score',
				'semester_comment'
			].includes(table)
		)
	).toEqual([]);
};

describe('Grading page canonical navigation', () => {
	it('uses the current Paris year despite future classes and rejects older or future links before roster reads', async () => {
		const future = await createClass(db, { name: 'Future class', academicYear: '2027-2028' });
		await db
			.update(tables.teachingContexts)
			.set({ archivedAt: null })
			.where(eq(tables.teachingContexts.id, ids.oldContext));
		statements = [];
		await expect(load(request('').event)).rejects.toMatchObject({
			status: 307,
			location: `/enseignant/notation?annee=2026-2027&classe=${ids.currentClass}`
		});
		expectNoGradeReads();
		for (const search of [
			'?annee=2025-2026',
			'?annee=2027-2028',
			`?classe=${ids.oldClass}`,
			`?classe=${future.id}`,
			`?contexte=${ids.oldContext}`
		]) {
			statements = [];
			await expect(load(request(search).event)).rejects.toMatchObject({ status: 404 });
			expectNoGradeReads();
			expect(statements.filter((statement) => /from "student"/.test(statement))).toEqual([]);
		}
	});

	it('keeps the daily workspace empty when the current year has no class', async () => {
		await db.update(tables.classes).set({ academicYear: '2027-2028' }).where(eq(tables.classes.id, ids.currentClass));
		await db
			.update(tables.teachingContexts)
			.set({ academicYear: '2027-2028' })
			.where(eq(tables.teachingContexts.classId, ids.currentClass));
		statements = [];
		const { event, cookies } = request('');
		await expect(load(event)).resolves.toMatchObject({
			grid: { academicYears: [], academicYear: null, classes: [], classId: null, contexts: [], students: [] }
		});
		expectNoGradeReads();
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('redirects a module deep link without reading the rubric or corrections', async () => {
		const { event, cookies } = request(`?module=${ids.module}&section=preparation&etudiant=${ids.students[0]}`);
		await expect(load(event)).rejects.toMatchObject({
			status: 307,
			location: `/enseignant/notation${canonicalSearch()}&section=preparation&etudiant=${ids.students[0]}`
		});
		expectNoGradeReads();
		expect(gradingPreference(cookies.get(gradingYearCookie), ids.teacher)).toEqual({
			teacherId: ids.teacher,
			academicYear: '2026-2027',
			contexts: [rememberedContext()]
		});
	});

	it('loads the canonical workspace once with the same complete grading data', async () => {
		const expected = await getGradeWorkspace(db, { contextId: ids.currentContext, currentYearOnly: true });
		statements = [];
		const { event } = request(`${canonicalSearch()}&section=resources&etudiant=${ids.students[0]}`);
		await expect(load(event)).resolves.toEqual({ grid: expected });
		expect(statements.filter((statement) => /from "assessment"/.test(statement))).toHaveLength(1);
		expect(statements.filter((statement) => /from "score"/.test(statement))).toHaveLength(1);
	});

	it.each(['another-class', 'missing', 'malformed'])(
		'removes an ineligible student (%s) before loading grading data',
		async (kind) => {
			const studentId =
				kind === 'another-class' ? ids.oldStudent : kind === 'missing' ? crypto.randomUUID() : 'invalid';
			const { event } = request(`${canonicalSearch()}&etudiant=${studentId}`);
			await expect(load(event)).rejects.toMatchObject({
				status: 307,
				location: `/enseignant/notation${canonicalSearch()}`
			});
			expectNoGradeReads();
			const expected = await getGradeWorkspace(db, { contextId: ids.currentContext, currentYearOnly: true });
			await expect(load(request(canonicalSearch()).event)).resolves.toEqual({ grid: expected });
		}
	);

	it.each(['class', 'module'])(
		'preserves an explicit empty %s selection and its preference behavior',
		async (level) => {
			const search =
				level === 'class' ? '?annee=2026-2027&classe=&module=' : `?annee=2026-2027&classe=${ids.currentClass}&module=`;
			const selection = {
				currentYearOnly: true,
				academicYear: '2026-2027',
				classId: level === 'module' ? ids.currentClass : '',
				moduleId: ''
			};
			const expected = await getGradeWorkspace(db, selection);
			statements = [];
			const { event, cookies } = request(search, {
				teacherId: ids.teacher,
				academicYear: '2026-2027',
				contexts: [rememberedContext()]
			});
			await expect(load(event)).resolves.toEqual({ grid: expected });
			expectNoGradeReads();
			expect(gradingPreference(cookies.get(gradingYearCookie), ids.teacher)?.contexts).toEqual([rememberedContext()]);
		}
	);

	it('restores a remembered complete context before the canonical redirect', async () => {
		const { event } = request('', {
			teacherId: ids.teacher,
			academicYear: '2026-2027',
			contexts: [rememberedContext()]
		});
		await expect(load(event)).rejects.toMatchObject({
			status: 307,
			location: `/enseignant/notation${canonicalSearch()}`
		});
		expectNoGradeReads();
	});

	it('keeps an unavailable remembered context notice visible without redirecting', async () => {
		const contexts = [{ ...rememberedContext(), contextId: crypto.randomUUID() }];
		const expected = await getGradeWorkspace(db, { currentYearOnly: true, preferredContexts: contexts });
		statements = [];
		const { event } = request('', { teacherId: ids.teacher, academicYear: '2026-2027', contexts });
		await expect(load(event)).resolves.toEqual({ grid: expected });
		expect(expected.selectionNotice).toContain('n’est plus disponible');
		expectNoGradeReads();
	});

	it('ignores a remembered older year', async () => {
		const { event } = request('', { teacherId: ids.teacher, academicYear: '2024-2025', contexts: [] });
		await expect(load(event)).rejects.toMatchObject({
			status: 307,
			location: `/enseignant/notation?annee=2026-2027&classe=${ids.currentClass}`
		});
		expectNoGradeReads();
	});

	it.each(['year', 'class', 'module', 'context', 'mismatched-year'])(
		'rejects an unavailable %s before reading grading data',
		async (kind) => {
			const searches = {
				year: '?annee=2040-2041',
				class: `?classe=${crypto.randomUUID()}`,
				module: `?module=${crypto.randomUUID()}`,
				context: `?contexte=${ids.oldContext}`,
				'mismatched-year': `?annee=2025-2026&contexte=${ids.currentContext}`
			};
			await expect(load(request(searches[kind as keyof typeof searches]).event)).rejects.toMatchObject({
				status: 404
			});
			expectNoGradeReads();
		}
	);

	it.each([
		{ locals: { user: null, session: null }, status: 303 },
		{
			locals: {
				user: { id: 'student', role: 'student' },
				session: { userId: 'student', expiresAt: new Date('2099-01-01') }
			},
			status: 403
		}
	])('authorizes before resolving a private selection ($status)', async ({ locals, status }) => {
		const { event } = request(canonicalSearch());
		await expect(load({ ...event, locals: locals as typeof event.locals })).rejects.toMatchObject({
			status
		});
		expect(withTeacherDatabase).not.toHaveBeenCalled();
		expect(statements).toEqual([]);
	});
});
