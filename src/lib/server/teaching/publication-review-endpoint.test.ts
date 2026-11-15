import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { error, type RequestEvent } from '@sveltejs/kit';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import * as tables from '../db/schema.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import {
	publicationReviewDataSchema,
	publicationReceiptSchema,
	type PublicationSnapshot
} from '../../domain/publication.js';
vi.mock('./database.js', () => ({ withTeacherDatabase: vi.fn() }));
vi.mock('../auth/runtime.js', () => ({ withAuth: vi.fn() }));
vi.mock('./publications.js', async (original) => {
	const actual = await original<typeof import('./publications.js')>();
	return {
		...actual,
		getPublicationReview: vi.fn(actual.getPublicationReview),
		decidePublication: vi.fn(actual.decidePublication)
	};
});
import { withTeacherDatabase } from './database.js';
import { withAuth } from '../auth/runtime.js';
import { decidePublication, getPublicationReview, getPublicModule } from './publications.js';
import { currentAcademicYear } from '../../domain/academic-year.js';
import { GET, POST } from '../../../routes/api/teaching/modules/[moduleId]/publication/+server.js';

let client: Client;
let db: Database;
let ids: Awaited<ReturnType<typeof seedFoundationFixtures>>;
const origin = 'https://campus.example';
const teacher = {
	user: { id: 'teacher', role: 'teacher' },
	session: { userId: 'teacher', expiresAt: new Date('2099-01-01T00:00:00Z') }
};
const deniedSessions = [
	{ name: 'anonymous or agent-key-only', locals: { user: null, session: null }, status: 401 },
	{ name: 'missing user', locals: { ...teacher, user: null }, status: 401 },
	{ name: 'missing session', locals: { ...teacher, session: null }, status: 401 },
	{
		name: 'expired session',
		locals: { ...teacher, session: { ...teacher.session, expiresAt: new Date(0) } },
		status: 401
	},
	{
		name: 'mismatched identity',
		locals: { ...teacher, session: { ...teacher.session, userId: 'other' } },
		status: 403
	},
	{
		name: 'nonteacher',
		locals: { ...teacher, user: { id: 'teacher', role: 'student' } },
		status: 403
	}
];
function event(moduleId: string = ids.module, query = '', locals: unknown = teacher) {
	const url = new URL(origin + '/api/teaching/modules/' + moduleId + '/publication' + query);
	return {
		url,
		params: { moduleId },
		locals,
		request: new Request(url, { headers: { Authorization: 'Bearer fictional-agent-key' } })
	} as RequestEvent;
}
function expectPrivateJson(response: Response, status: number) {
	expect(response.status).toBe(status);
	expect(response.headers.get('content-type')).toContain('application/json');
	expect(response.headers.get('cache-control')).toBe('private, no-store');
	expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
	expect(response.headers.get('referrer-policy')).toBe('no-referrer');
}
async function read(moduleId = ids.module, query = '') {
	const response = await GET(event(moduleId, query));
	expectPrivateJson(response, 200);
	return publicationReviewDataSchema.parse(await response.json());
}

beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedFoundationFixtures(db);
	vi.clearAllMocks();
	vi.mocked(withTeacherDatabase).mockReset();
	vi.mocked(withTeacherDatabase).mockImplementation((_locals, operation) => operation(db));
});
afterEach(() => client.close());

describe('Private publication review GET', () => {
	it.each(deniedSessions)('refuses $name before inspecting any input or private IO', async ({ locals, status }) => {
		const request = event('invalid-module', '?contexte=invalid&extra=private', locals);
		const inspectInput = vi.fn(() => {
			throw new Error('Input inspected before authentication');
		});
		for (const key of ['params', 'url', 'request']) Object.defineProperty(request, key, { get: inspectInput });
		const response = await GET(request);
		expectPrivateJson(response, status);
		expect(await response.json()).toEqual({
			message: status === 401 ? 'Connexion requise.' : 'Accès refusé.'
		});
		expect(inspectInput).not.toHaveBeenCalled();
		expect(withTeacherDatabase).not.toHaveBeenCalled();
		expect(withAuth).not.toHaveBeenCalled();
		expect(getPublicationReview).not.toHaveBeenCalled();
	});
	it('also enforces the session guard at the database service boundary before opening private storage', async () => {
		const actual = await vi.importActual<typeof import('./database.js')>('./database.js');
		const privateRead = vi.fn(async () => 'PRIVATE');
		for (const { locals, status } of deniedSessions)
			await expect(
				Promise.resolve().then(() =>
					actual.withTeacherDatabase(locals as Parameters<typeof withTeacherDatabase>[0], privateRead)
				)
			).rejects.toMatchObject({ status });
		expect(withAuth).not.toHaveBeenCalled();
		expect(privateRead).not.toHaveBeenCalled();
		expect(getPublicationReview).not.toHaveBeenCalled();
	});
	it.each(['', 'not-a-uuid', '00000000-0000-4000-8000-000000000001/extra'])(
		'rejects malformed module identity %j before database access',
		async (moduleId) => {
			const response = await GET(event(moduleId));
			expectPrivateJson(response, 404);
			expect(withTeacherDatabase).not.toHaveBeenCalled();
			expect(getPublicationReview).not.toHaveBeenCalled();
		}
	);
	it.each([
		'?contexte=',
		'?contexte=not-a-uuid',
		'?contexte=null',
		'?contexte=%20',
		'?contexte=00000000-0000-4000-8000-000000000001/extra',
		'?context=00000000-0000-4000-8000-000000000001',
		'?extra=1',
		'?extra=',
		'?contexte=00000000-0000-4000-8000-000000000001&extra=1',
		'?contexte=00000000-0000-4000-8000-000000000001&contexte=00000000-0000-4000-8000-000000000001',
		'?contexte=00000000-0000-4000-8000-000000000001&contexte=00000000-0000-4000-8000-000000000002',
		'?contexte=&contexte=00000000-0000-4000-8000-000000000001',
		'?__proto__=private'
	])('rejects malformed, duplicate or unknown query input %s before private reads', async (query) => {
		const response = await GET(event(ids.module, query));
		expectPrivateJson(response, 400);
		expect(await response.json()).toEqual({ message: 'Paramètres de lecture invalides.' });
		expect(withTeacherDatabase).not.toHaveBeenCalled();
		expect(getPublicationReview).not.toHaveBeenCalled();
	});
	it('uses exactly the requested module and context in one read transaction, without actor or roster', async () => {
		const transaction = vi.spyOn(db, 'transaction');
		const data = await read(ids.module, '?contexte=' + ids.currentContext);
		expect(transaction).toHaveBeenCalledOnce();
		expect(withTeacherDatabase).toHaveBeenCalledOnce();
		expect(withTeacherDatabase).toHaveBeenCalledWith(teacher, expect.any(Function));
		expect(getPublicationReview).toHaveBeenCalledOnce();
		const [tx, moduleId, contextId] = vi.mocked(getPublicationReview).mock.calls[0];
		expect(tx).not.toBe(db);
		expect(moduleId).toBe(ids.module);
		expect(contextId).toBe(ids.currentContext);
		expect(data.module.id).toBe(ids.module);
		expect(data.selected?.context.id).toBe(ids.currentContext);
		expect(data.selected?.draft?.version).toBe(2);
		expect(Object.keys(data).sort()).toEqual(['contexts', 'module', 'selected']);
		expect(JSON.stringify(data)).not.toMatch(
			/Student Demo|Teacher Demo|teacher@example|semesterComment|corrections|roster|sourcePath|preparation|actor|session/
		);
	});
	it('supports an omitted context and a module without any assigned class', async () => {
		const data = await read();
		expect(getPublicationReview).toHaveBeenLastCalledWith(
			expect.anything(),
			ids.module,
			undefined,
			currentAcademicYear()
		);
		expect(data.selected?.context.id).toBe(ids.currentContext);
		const unassignedId = crypto.randomUUID();
		await db.insert(tables.modules).values({ id: unassignedId, title: 'Unassigned fictional module' });
		expect(await read(unassignedId)).toEqual({
			module: { id: unassignedId, title: 'Unassigned fictional module' },
			contexts: [],
			selected: null
		});
	});
	it('returns a private 404 for missing modules and contexts not belonging to this module', async () => {
		for (const request of [
			event(crypto.randomUUID()),
			event(ids.module, '?contexte=' + crypto.randomUUID()),
			event(ids.module, '?contexte=' + ids.secondContext)
		]) {
			const response = await GET(request);
			expectPrivateJson(response, 404);
			expect(await response.json()).toEqual({
				message: 'Cette vérification de publication n’est pas disponible.'
			});
		}
		expect((await read(ids.secondModule, '?contexte=' + ids.secondContext)).selected?.context.id).toBe(
			ids.secondContext
		);
	});
	it('keeps archived reviews readable with a deleted class and class revision zero', async () => {
		await db.delete(tables.classes).where(eq(tables.classes.id, ids.oldClass));
		expect((await read(ids.module, '?contexte=' + ids.oldContext)).selected).toMatchObject({
			context: { id: ids.oldContext, archived: true, classId: null },
			classRevision: 0,
			draft: null,
			classPath: null
		});
	});
	it('accepts durable public paths and the retained v2 snapshot from an earlier annual context', async () => {
		const previous = (await getPublicationReview(db, ids.module, ids.currentContext)).selected!.draft!;
		await db
			.update(tables.modulePublications)
			.set({
				snapshot: { ...previous, academicYear: '2025-2026' }
			})
			.where(eq(tables.modulePublications.contextId, ids.oldContext));
		const moduleLink = crypto.randomUUID();
		const classLink = crypto.randomUUID();
		await db.insert(tables.publicModuleLinks).values({
			id: moduleLink,
			moduleId: ids.module,
			contextId: ids.currentContext,
			publishedContextId: ids.oldContext
		});
		await db.insert(tables.publicClassLinks).values({ id: classLink, classId: ids.currentClass });
		expect((await read(ids.module, '?contexte=' + ids.currentContext)).selected).toMatchObject({
			context: { id: ids.currentContext, academicYear: '2026-2027' },
			publicationRevision: 0,
			publicPath: '/modules/' + moduleLink,
			classPath: '/classes/' + classLink,
			published: { version: 2, academicYear: '2025-2026' },
			status: 'published'
		});
	});
	it.each(['legacy', 'malformed'] as const)(
		'does not expose a %s stored snapshot or substitute its private draft',
		async (kind) => {
			const draft = (await getPublicationReview(db, ids.module, ids.currentContext)).selected!.draft!;
			const snapshot =
				kind === 'legacy'
					? { ...draft, version: 1, description: 'PRIVATE legacy body' }
					: { ...draft, students: ['PRIVATE malformed body'] };
			await db
				.update(tables.modulePublications)
				.set({
					contextId: ids.currentContext,
					snapshot: snapshot as unknown as PublicationSnapshot
				})
				.where(eq(tables.modulePublications.contextId, ids.oldContext));
			const data = await read(ids.module, '?contexte=' + ids.currentContext);
			expect(data.selected).toMatchObject({
				status: 'legacy',
				published: null,
				draft: { version: 2 }
			});
			expect(JSON.stringify(data)).not.toContain('PRIVATE');
			await expect(getPublicModule(db, ids.currentContext)).rejects.toMatchObject({ status: 404 });
		}
	);
	it('strictly validates the complete outgoing DTO before serialization', async () => {
		const data = await getPublicationReview(db, ids.module, ids.currentContext);
		for (const invalid of [
			{ module: data.module },
			{ ...data, actor: teacher.user },
			{ ...data, roster: ['PRIVATE roster'] },
			{
				...data,
				selected: { ...data.selected!, published: { ...data.selected!.draft!, version: 1 } }
			},
			{ ...data, selected: { ...data.selected!, moduleRevision: -1 } }
		]) {
			vi.mocked(withTeacherDatabase).mockResolvedValueOnce(invalid);
			const response = await GET(event(ids.module, '?contexte=' + ids.currentContext));
			expectPrivateJson(response, 503);
			expect(await response.json()).toEqual({ message: 'Lecture indisponible. Réessayez.' });
		}
	});
	it('rejects a well-formed DTO for the wrong requested module or context', async () => {
		const current = await getPublicationReview(db, ids.module, ids.currentContext);
		const otherContext = await getPublicationReview(db, ids.module, ids.oldContext);
		for (const invalid of [
			{ ...current, module: { ...current.module, id: ids.secondModule } },
			otherContext,
			{ ...current, contexts: [], selected: null }
		]) {
			vi.mocked(withTeacherDatabase).mockResolvedValueOnce(invalid);
			const response = await GET(event(ids.module, '?contexte=' + ids.currentContext));
			expectPrivateJson(response, 503);
			expect(await response.json()).toEqual({ message: 'Lecture indisponible. Réessayez.' });
		}
	});
	it.each(['connection', 'read', 'commit', 'http-error'] as const)(
		'keeps %s backend failures neutral and uncached',
		async (step) => {
			const detail = 'PRIVATE backend detail: libsql://fictional.invalid query roster token';
			if (step === 'connection') vi.mocked(withTeacherDatabase).mockRejectedValueOnce(new Error(detail));
			if (step === 'read') vi.mocked(getPublicationReview).mockRejectedValueOnce(new Error(detail));
			if (step === 'commit') {
				const transaction = db.transaction.bind(db);
				vi.spyOn(db, 'transaction').mockImplementationOnce((operation) =>
					transaction(async (tx) => {
						await operation(tx);
						throw new Error(detail);
					})
				);
			}
			if (step === 'http-error') vi.mocked(getPublicationReview).mockImplementationOnce(async () => error(503, detail));
			const response = await GET(event());
			expectPrivateJson(response, 503);
			expect(await response.json()).toEqual({ message: 'Lecture indisponible. Réessayez.' });
		}
	);
});

describe('Existing publication POST compatibility', () => {
	it('preserves decision arguments, same-origin rules and identical retry receipts independently of GET query rules', async () => {
		const selected = (await getPublicationReview(db, ids.module, ids.currentContext)).selected!;
		const input = {
			requestId: crypto.randomUUID(),
			contextId: ids.currentContext,
			action: 'publish',
			expectedRevision: selected.publicationRevision,
			moduleRevision: selected.moduleRevision,
			contextRevision: selected.contextRevision,
			classRevision: selected.classRevision,
			confirm: true
		};
		const locals = {
			user: { ...teacher.user, id: ids.teacher },
			session: { ...teacher.session, userId: ids.teacher }
		};
		const request = (requestOrigin = origin, body: unknown = input) => {
			const value = event(ids.module, '?extra=ignored-by-existing-POST', locals);
			return {
				...value,
				request: new Request(value.url, {
					method: 'POST',
					headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
					body: JSON.stringify(body)
				})
			};
		};
		vi.mocked(getPublicationReview).mockClear();
		expect((await POST(request('https://other.example'))).status).toBe(403);
		expect((await POST(request(origin, { ...input, snapshot: {} }))).status).toBe(422);
		expect(withTeacherDatabase).not.toHaveBeenCalled();
		expect(decidePublication).not.toHaveBeenCalled();
		const first = await POST(request());
		expect(first.status).toBe(200);
		const receipt = publicationReceiptSchema.parse(await first.json());
		expect(receipt).toMatchObject({
			requestId: input.requestId,
			contextId: ids.currentContext,
			revision: 1
		});
		const retry = await POST(request());
		expect(retry.status).toBe(200);
		expect(await retry.json()).toEqual(receipt);
		expect(decidePublication).toHaveBeenCalledWith(db, ids.teacher, ids.module, input);
		expect(getPublicationReview).not.toHaveBeenCalled();
		expect(await db.select().from(tables.publicationReceipts)).toHaveLength(1);
	});
});
