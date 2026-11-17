import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { randomBytes, createHash } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { createAuth, type Auth } from '../auth.js';
import { createDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';
import { issueInvitation, invitationCookieName } from '../auth/invitations.js';
import { virtualPasskey } from '../auth/testing/webauthn.js';
import { readOAuthRequest, browserOAuth, decideOAuth, listApplications, revokeApplication } from './consent.js';
import { handleRemoteMcp } from './http.js';
import { authenticateMcp } from './principal.js';
import { seedFoundationFixtures } from '../db/testing/fixtures.js';
import { newFolderBinding, resolveLocalModule } from '../../domain/local-module.js';
import { createModuleImportSchema } from '../../domain/module-import.js';
import { sampleLocalModule } from '../agent/testing/fixtures.js';
import { unusedClientLimit, unusedClientRetentionMs } from './registration.js';
import { getQuizDraft } from '../teaching/quizzes.js';
import { quizContextSchema } from '../../domain/quiz-agent.js';
import * as modulePatch from '../agent/patch.js';
import { mcpScopes, defaultMcpScopes, isMcpScope } from '../../domain/remote-mcp.js';
import type { GradeGridData } from '../../domain/grading.js';
import type { PublicationReviewData } from '../../domain/publication.js';
import type { AnnualPageData } from '../../domain/annual.js';
import { seedNativeQuizFixtures } from '../db/testing/quiz-fixtures.js';
import type { TeachingToolDependencies } from './teaching-tools.js';
import { rejectCrossOriginForm } from '../auth/csrf.js';

const origin = 'https://campus.example.test';
const callback = 'http://127.0.0.1:47913/callback';
const verifier = 'a'.repeat(64);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const cookieOf = (response: Response) =>
	response.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join(';');
let client: Client;
let auth: Auth;
let cookie: string;
let teacherId: string;
const quizRpc = async (
	token: string,
	method: 'tools/list' | 'tools/call',
	name?: string,
	args?: unknown,
	dependencies?: TeachingToolDependencies
) =>
	handleRemoteMcp(
		new Request(origin + '/mcp', {
			method: 'POST',
			headers: {
				authorization: 'Bearer ' + token,
				'content-type': 'application/json',
				accept: 'application/json',
				'mcp-protocol-version': '2026-07-28',
				'mcp-method': method,
				...(name ? { 'mcp-name': name } : {})
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method,
				params: {
					...(name ? { name, arguments: args } : {}),
					_meta: {
						'io.modelcontextprotocol/protocolVersion': '2026-07-28',
						'io.modelcontextprotocol/clientInfo': { name: 'fictional-quiz-test', version: '1' },
						'io.modelcontextprotocol/clientCapabilities': {}
					}
				}
			})
		}),
		auth,
		client,
		origin,
		dependencies
	);
async function call(path: string, body?: unknown, session = '', native = false) {
	return auth.handler(
		new Request(origin + '/api/auth' + path, {
			method: body === undefined ? 'GET' : 'POST',
			headers: {
				...(native ? {} : { origin }),
				cookie: session,
				'content-type': body instanceof URLSearchParams ? 'application/x-www-form-urlencoded' : 'application/json',
				'cf-connecting-ip': '192.0.2.17'
			},
			...(body === undefined ? {} : { body: body instanceof URLSearchParams ? body : JSON.stringify(body) })
		})
	);
}
async function registerClient(redirect = callback) {
	const response = await call(
		'/oauth2/register',
		{
			client_name: 'Codex fictif',
			redirect_uris: [redirect],
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			application_type: 'native'
		},
		'',
		true
	);
	expect(response.status, await response.clone().text()).toBe(201);
	return ((await response.json()) as { client_id: string }).client_id as string;
}
async function requestConsent(
	clientId: string,
	scope = 'modules:read modules:create modules:update offline_access',
	session = cookie
) {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: callback,
		response_type: 'code',
		state: 'state-fictif',
		scope,
		resource: origin + '/mcp',
		code_challenge: challenge,
		code_challenge_method: 'S256',
		prompt: 'consent'
	});
	const response = await call('/oauth2/authorize?' + params, undefined, session);
	expect(response.status, await response.clone().text()).toBe(302);
	return new URL(response.headers.get('location')!, origin);
}
const grant = async (scope?: string, tokenHeaders: Record<string, string> = {}) => {
	const clientId = await registerClient();
	const location = await requestConsent(clientId, scope);
	const query = location.search.slice(1);
	const reviewed = await readOAuthRequest(auth, client, query, origin);
	const decision = await decideOAuth(auth, client, origin, new Headers({ cookie, origin }), {
		oauthQuery: query,
		accept: true,
		scopes: reviewed.scopes
	});
	const code = new URL(decision.url).searchParams.get('code')!;
	const tokenRequest = new Request(origin + '/api/auth/oauth2/token', {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			'cf-connecting-ip': '192.0.2.17',
			...tokenHeaders
		},
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			client_id: clientId,
			redirect_uri: callback,
			code_verifier: verifier,
			resource: origin + '/mcp'
		})
	});
	const response = rejectCrossOriginForm(tokenRequest, new URL(tokenRequest.url)) ?? (await auth.handler(tokenRequest));
	expect(response.status, await response.clone().text()).toBe(200);
	return {
		clientId,
		token: (await response.json()) as {
			access_token: string;
			refresh_token: string;
			expires_in: number;
			scope: string;
		},
		code,
		query
	};
};
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	await migrate(createDatabase(client), { migrationsFolder: './drizzle' });
	auth = await createAuth({ ORIGIN: origin, BETTER_AUTH_SECRET: randomBytes(32).toString('hex') }, client);
	const invite = await issueInvitation(client, {
		email: 'teacher-fictif@example.test',
		name: 'Camille Martin',
		role: 'teacher'
	});
	teacherId = invite.id;
	const device = virtualPasskey(origin);
	const options = await call(
		'/passkey/generate-register-options',
		undefined,
		invitationCookieName + '=' + invite.token
	);
	const registered = await call(
		'/passkey/verify-registration',
		{ response: device.register(await options.json()), createSession: true },
		invitationCookieName + '=' + invite.token + ';' + cookieOf(options)
	);
	expect(registered.status, await registered.clone().text()).toBe(200);
	cookie = cookieOf(registered);
});
afterEach(() => {
	client.close();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('MCP distant et OAuth réels sur base fictive', () => {
	it('exchanges Node Fetch OAuth requests and preserves immediate consent revocation', async () => {
		const { token } = await grant('modules:read', { 'sec-fetch-mode': 'cors' });
		const incoming = new Request(origin + '/mcp', {
			headers: { authorization: 'Bearer ' + token.access_token }
		});
		expect((await authenticateMcp(auth, client, origin, incoming)).scopes).toEqual(['modules:read']);
		const [application] = await listApplications(client, teacherId);
		await revokeApplication(client, teacherId, application);
		await expect(authenticateMcp(auth, client, origin, incoming)).rejects.toMatchObject({ status: 401 });
	});
	it('keeps new teaching powers opt-in and outside existing account access', async () => {
		const { token } = await grant('modules:read roster:manage');
		for (const name of [
			'update_class',
			'update_student',
			'delete_student',
			'save_correction',
			'save_semester_comment',
			'decide_publication',
			'decide_annual_year',
			'calendar_command'
		]) {
			const denied = await quizRpc(token.access_token, 'tools/call', name, {});
			expect(denied.status, name).toBe(403);
		}
		expect(defaultMcpScopes(['modules:read', 'roster:manage'])).toEqual(['modules:read', 'roster:manage']);
	});
	it('renames a class and students with exact revision checks and explicit deletion', async () => {
		const ids = await seedFoundationFixtures(createDatabase(client));
		const { token } = await grant('modules:read roster:manage roster:update roster:delete');
		const invoke = async (name: string, args: unknown) =>
			(await (await quizRpc(token.access_token, 'tools/call', name, args)).json()) as {
				result: { isError?: boolean; structuredContent: Record<string, unknown> };
			};
		const rename = {
			classId: ids.currentClass,
			name: 'Disneyland Paris Demo',
			academicYear: '2026-2027',
			expectedRevision: 1
		};
		expect(await invoke('update_class', rename)).toMatchObject({
			result: { structuredContent: { id: ids.currentClass } }
		});
		expect(await invoke('update_class', { ...rename, name: 'Stale name' })).toMatchObject({
			result: { isError: true }
		});
		expect(await invoke('get_class_roster', { classId: ids.currentClass })).toMatchObject({
			result: { structuredContent: { name: rename.name } }
		});
		const identity = { classId: ids.currentClass, studentId: ids.students[0], expectedRevision: 1, classRevision: 2 };
		expect(await invoke('update_student', { ...identity, name: 'Renamed Student Demo' })).toMatchObject({
			result: { structuredContent: { id: ids.students[0] } }
		});
		expect(
			await invoke('delete_student', { ...identity, expectedRevision: 2, classRevision: 3, confirm: false })
		).toMatchObject({ result: { isError: true } });
		expect(
			await invoke('delete_student', { ...identity, expectedRevision: 2, classRevision: 3, confirm: true })
		).toMatchObject({ result: { structuredContent: { id: ids.students[0] } } });
		expect(await invoke('get_class_roster', { classId: ids.currentClass })).toMatchObject({
			result: {
				structuredContent: {
					revision: 4,
					students: expect.not.arrayContaining([expect.objectContaining({ id: ids.students[0] })])
				}
			}
		});
	});
	it('advertises complete teacher operations without exposing account or participant commands', async () => {
		const { token } = await grant(mcpScopes.join(' '));
		const listed = (await (await quizRpc(token.access_token, 'tools/list')).json()) as {
			result: { tools: { name: string }[] };
		};
		const names = listed.result.tools.map((tool) => tool.name);
		expect(names).toHaveLength(38);
		for (const name of [
			'get_teacher_home',
			'get_classes',
			'list_modules',
			'get_grade_grid',
			'get_proposal_review',
			'get_class_grade_export',
			'get_student_grade_export',
			'get_publication_review',
			'get_annual_data',
			'get_annual_history',
			'get_calendar_settings',
			'save_quiz_draft',
			'get_public_module',
			'get_public_class',
			'attach_module'
		])
			expect(names).toContain(name);
		expect(names.some((name) => /account|passkey|session|consent|participant|save_answers/.test(name))).toBe(false);
	});
	it('copies an assigned module to the exact new class without its planning or student results', async () => {
		const db = createDatabase(client);
		const ids = await seedFoundationFixtures(db);
		const classId = crypto.randomUUID();
		await db.insert(schema.classes).values({ id: classId, name: 'New Class Demo', academicYear: '2026-2027' });
		const { token } = await grant('modules:read modules:create modules:update roster:update roster:manage');
		const command = { classId, moduleId: ids.module, moduleRevision: 1, expectedRevision: 1 };
		const copied = (await (await quizRpc(token.access_token, 'tools/call', 'attach_module', command)).json()) as {
			result: { structuredContent: { id: string; moduleId: string } };
		};
		expect(copied.result.structuredContent.moduleId).not.toBe(ids.module);
		const context = (await (
			await quizRpc(token.access_token, 'tools/call', 'get_import_context', {
				moduleId: copied.result.structuredContent.moduleId
			})
		).json()) as { result: { structuredContent: { module: { contexts: { classId: string; lessons: unknown[] }[] } } } };
		expect(context.result.structuredContent.module.contexts).toMatchObject([{ classId, lessons: [] }]);
		expect(
			await (await quizRpc(token.access_token, 'tools/call', 'get_class_roster', { classId })).json()
		).toMatchObject({
			result: { structuredContent: { students: [] } }
		});
		expect(await (await quizRpc(token.access_token, 'tools/call', 'attach_module', command)).json()).toMatchObject({
			result: { isError: true }
		});
	});
	it('requires explicit quiz review consent and confirmation, preserving revision and retry receipts', async () => {
		const db = createDatabase(client);
		const ids = await seedFoundationFixtures(db);
		await db.insert(schema.lessons).values({
			contextId: ids.currentContext,
			title: 'Reviewed Quiz Demo',
			startsAt: new Date(),
			endsAt: new Date(Date.now() + 3600000)
		});
		const fixture = await seedNativeQuizFixtures(db, {
			teacher: teacherId,
			publicationModule: ids.module,
			publicationContext: ids.currentContext
		});
		await client.execute({ sql: 'UPDATE quiz_draft SET needs_review = 1 WHERE id = ?', args: [fixture.quizId] });
		const draft = await getQuizDraft(db, fixture.quizId);
		const { revision, needsReview, ...content } = draft;
		expect(needsReview).toBe(true);
		const command = {
			quiz: { ...content, expectedRevision: revision, requestId: crypto.randomUUID() },
			confirmReview: true
		};
		const ordinary = await grant('modules:read quizzes:read quizzes:write');
		expect((await quizRpc(ordinary.token.access_token, 'tools/call', 'save_quiz_draft', command)).status).toBe(403);
		const reviewed = await grant('modules:read quizzes:read quizzes:write quizzes:review');
		const invoke = async (args: unknown) =>
			(await quizRpc(reviewed.token.access_token, 'tools/call', 'save_quiz_draft', args)).json();
		expect(await invoke({ ...command, confirmReview: false })).toMatchObject({ result: { isError: true } });
		expect((await getQuizDraft(db, fixture.quizId)).needsReview).toBe(true);
		const saved = await invoke(command);
		expect(saved).toMatchObject({ result: { structuredContent: { quizId: fixture.quizId, revision: 2 } } });
		expect(await invoke(command)).toEqual(saved);
		expect(await getQuizDraft(db, fixture.quizId)).toMatchObject({ revision: 2, needsReview: false });
	});
	it('saves corrections and comments through MCP while keeping exports and cross-class writes checked', async () => {
		const ids = await seedFoundationFixtures(createDatabase(client));
		const { token } = await grant('modules:read grades:read grades:write');
		const invoke = async (name: string, args: unknown) =>
			(await (await quizRpc(token.access_token, 'tools/call', name, args)).json()) as {
				result: { isError?: boolean; structuredContent: Record<string, unknown> };
			};
		const loaded = (await invoke('get_grade_grid', { moduleId: ids.module, contextId: ids.currentContext })) as {
			result: { structuredContent: GradeGridData };
		};
		const grid = loaded.result.structuredContent;
		const assessment = grid.rubric!.assessments.find((item) => item.id === ids.project)!;
		const correction = grid.students[0].corrections.find((item) => item.assessmentId === assessment.id)!;
		const input = {
			contextId: ids.currentContext,
			studentId: grid.students[0].id,
			assessmentId: assessment.id,
			expectedRevision: correction.revision,
			rubricRevision: grid.rubric!.module.revision,
			status: 'graded',
			submissionUrl: null,
			submittedAt: null,
			latenessDecision: 'automatic',
			scores: assessment.lines.map((line) => ({ lineId: line.id, points: 1 }))
		};
		expect(await invoke('save_correction', input)).toMatchObject({
			result: { structuredContent: { id: input.studentId } }
		});
		expect(await invoke('save_correction', input)).toMatchObject({ result: { isError: true } });
		expect(await invoke('save_correction', { ...input, contextId: ids.secondContext })).toMatchObject({
			result: { isError: true }
		});
		expect(
			await invoke('save_semester_comment', {
				contextId: ids.currentContext,
				studentId: input.studentId,
				expectedRevision: grid.students[0].comment.revision,
				content: 'Private MCP comment'
			})
		).toMatchObject({ result: { structuredContent: { content: 'Private MCP comment' } } });
		expect(await invoke('get_class_grade_export', { contextId: ids.currentContext })).toMatchObject({
			result: { isError: true }
		});
		expect(
			await invoke('get_student_grade_export', { contextId: ids.currentContext, studentId: ids.oldStudent })
		).toMatchObject({ result: { isError: true } });
	});
	it('publishes only an explicitly reviewed snapshot with stable replay and supports unpublishing', async () => {
		const ids = await seedFoundationFixtures(createDatabase(client));
		const { token } = await grant('modules:read publications:write');
		const invoke = async (name: string, args: unknown) =>
			(await (await quizRpc(token.access_token, 'tools/call', name, args)).json()) as {
				result: { isError?: boolean; structuredContent: Record<string, unknown> };
			};
		const review = (await invoke('get_publication_review', {
			moduleId: ids.module,
			contextId: ids.currentContext
		})) as { result: { structuredContent: PublicationReviewData } };
		const selected = review.result.structuredContent.selected!;
		const command = {
			moduleId: ids.module,
			contextId: ids.currentContext,
			requestId: crypto.randomUUID(),
			action: 'publish',
			expectedRevision: selected.publicationRevision,
			moduleRevision: selected.moduleRevision,
			contextRevision: selected.contextRevision,
			classRevision: selected.classRevision,
			confirm: true
		};
		expect(await invoke('decide_publication', { ...command, moduleRevision: 999 })).toMatchObject({
			result: { isError: true }
		});
		expect(await invoke('decide_publication', { ...command, confirm: false })).toMatchObject({
			result: { isError: true }
		});
		const published = await invoke('decide_publication', command);
		expect(published).toMatchObject({ result: { structuredContent: { contextId: ids.currentContext } } });
		expect(await invoke('decide_publication', command)).toEqual(published);
		const path = published.result.structuredContent.publicPath as string;
		const publicId = path.split('/').at(-1)!;
		const studentView = await invoke('get_public_module', { publicContextId: publicId });
		expect(studentView.result.isError).not.toBe(true);
		expect(JSON.stringify(studentView)).not.toContain('Student Demo');
		expect(JSON.stringify(studentView)).not.toContain('Teacher-only preparation.');
		const fresh = (await invoke('get_publication_review', { moduleId: ids.module, contextId: ids.currentContext }))
			.result.structuredContent as PublicationReviewData;
		expect(
			await invoke('decide_publication', {
				...command,
				requestId: crypto.randomUUID(),
				action: 'unpublish',
				expectedRevision: fresh.selected!.publicationRevision
			})
		).toMatchObject({ result: { structuredContent: { unpublishedAt: expect.any(String) } } });
		expect(await invoke('get_public_module', { publicContextId: publicId })).toMatchObject({
			result: { isError: true }
		});
	});
	it('requires a separate purge right and preserves reviewed annual archive/reopen and retry checks', async () => {
		await seedFoundationFixtures(createDatabase(client));
		const { token } = await grant('modules:read annual:read annual:write');
		const invoke = async (name: string, args: unknown) =>
			(await (await quizRpc(token.access_token, 'tools/call', name, args)).json()) as {
				result: { isError?: boolean; structuredContent: Record<string, unknown> };
			};
		const read = async () =>
			(await invoke('get_annual_data', { academicYear: '2026-2027' })).result.structuredContent as AnnualPageData;
		const data = await read();
		const command = {
			academicYear: '2026-2027',
			action: 'archive',
			reviewToken: data.selected!.reviewToken,
			requestId: crypto.randomUUID(),
			typedYear: '',
			pdfsKept: false
		};
		const refused = await quizRpc(token.access_token, 'tools/call', 'decide_annual_year', {
			command: { ...command, action: 'purge', typedYear: '2026-2027', pdfsKept: true }
		});
		expect(refused.status).toBe(403);
		expect(refused.headers.get('www-authenticate')).toContain('annual:purge');
		const archived = await invoke('decide_annual_year', { command });
		expect(archived).toMatchObject({ result: { structuredContent: { action: 'archive' } } });
		expect(await invoke('decide_annual_year', { command })).toEqual(archived);
		const fresh = await read();
		expect(fresh.selected!.status).toBe('archived');
		expect(
			await invoke('decide_annual_year', {
				command: {
					...command,
					action: 'reopen',
					requestId: crypto.randomUUID(),
					reviewToken: fresh.selected!.reviewToken
				}
			})
		).toMatchObject({ result: { structuredContent: { action: 'reopen' } } });
		expect((await read()).selected!.status).toBe('active');
	});
	it('excludes quiz rooms and their scope while preserving quiz preparation', async () => {
		const { token } = await grant(mcpScopes.join(' '));
		const listed = (await (await quizRpc(token.access_token, 'tools/list')).json()) as {
			result: { tools: { name: string }[] };
		};
		const names = listed.result.tools.map((tool) => tool.name);
		expect(isMcpScope('quizzes:run')).toBe(false);
		for (const name of ['get_quiz_context', 'create_quiz_draft', 'patch_quiz_draft', 'save_quiz_draft'])
			expect(names).toContain(name);
		for (const name of ['list_quiz_rooms', 'get_quiz_room', 'open_quiz_room', 'command_quiz_room']) {
			expect(names).not.toContain(name);
			const response = await quizRpc(token.access_token, 'tools/call', name, {});
			expect(await response.json()).toMatchObject({ error: { code: -32602 } });
		}
		expect(await createDatabase(client).select().from(schema.quizRuns)).toEqual([]);
	});
	it('reads calendar settings without a feed URL and keeps failed commands scoped to the current teacher', async () => {
		await seedFoundationFixtures(createDatabase(client));
		const { token } = await grant('modules:read calendar:read calendar:write');
		const invoke = async (name: string, args: unknown) =>
			(await (await quizRpc(token.access_token, 'tools/call', name, args)).json()) as {
				result: { isError?: boolean; structuredContent: Record<string, unknown> };
			};
		expect(await invoke('get_calendar_settings', {})).toMatchObject({
			result: { structuredContent: { connection: null } }
		});
		expect(await invoke('calendar_command', { command: { action: 'disconnect', revision: 1 } })).toMatchObject({
			result: { isError: true }
		});
		expect(
			await invoke('calendar_command', {
				command: { action: 'preview', url: 'http://127.0.0.1/private-fixture', teacherId: 'other' }
			})
		).toMatchObject({ result: { isError: true } });
	});
	it('records only allowlisted error shape when no failure code is recognized', async () => {
		const { token } = await grant('modules:read modules:update modules:rubric');
		const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
		const driver = Object.assign(new Error('FOREIGN KEY constraint failed: PRIVATE_MARKER'), {
			name: 'LibsqlError',
			code: 'PRIVATE_CODE'
		});
		vi.spyOn(modulePatch, 'patchModule').mockRejectedValue(new Error('PRIVATE_QUERY_MARKER', { cause: driver }));
		await quizRpc(token.access_token, 'tools/call', 'patch_module_draft', {
			version: 2,
			moduleId: crypto.randomUUID(),
			requestId: crypto.randomUUID(),
			expectedRevision: 1,
			patch: {},
			rubric: {}
		});
		expect(logger).toHaveBeenCalledExactlyOnceWith(
			JSON.stringify({
				event: 'campus.mcp.tool.unavailable',
				tool: 'patch_module_draft',
				phase: 'operation',
				reason: 'UNCLASSIFIED',
				frames: [
					{ kind: 'Error', code: 'NONE', message: 'OTHER' },
					{ kind: 'LibsqlError', code: 'OTHER', message: 'FOREIGN_KEY' }
				]
			})
		);
		expect(JSON.stringify(logger.mock.calls)).not.toContain('PRIVATE_');
	});
	it.each(['SQLITE_CONSTRAINT_FOREIGNKEY', 'TRANSACTION_CLOSED', 'INTERNAL_ERROR', 'UNKNOWN'])(
		'classifies a nested database failure %s without logging private content',
		async (code) => {
			const { token } = await grant('modules:read modules:update modules:rubric');
			const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
			const driver = Object.assign(new Error('PRIVATE_DRIVER_MARKER'), { code });
			vi.spyOn(modulePatch, 'patchModule').mockRejectedValue(new Error('PRIVATE_QUERY_MARKER', { cause: driver }));
			await quizRpc(token.access_token, 'tools/call', 'patch_module_draft', {
				version: 2,
				moduleId: crypto.randomUUID(),
				requestId: crypto.randomUUID(),
				expectedRevision: 1,
				patch: {},
				rubric: {}
			});
			expect(logger).toHaveBeenCalledExactlyOnceWith(
				JSON.stringify({
					event: 'campus.mcp.tool.unavailable',
					tool: 'patch_module_draft',
					phase: 'operation',
					reason: code
				})
			);
			expect(JSON.stringify(logger.mock.calls)).not.toContain('PRIVATE_');
		}
	);
	it('records unexpected tool failures without exposing private request or error data', async () => {
		const { token } = await grant('modules:read modules:update modules:rubric');
		const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
		const driver = Object.assign(new Error('PRIVATE_DRIVER_MARKER'), { code: 'SQLITE_ERROR' });
		vi.spyOn(modulePatch, 'patchModule').mockRejectedValue(new Error('PRIVATE_QUERY_MARKER', { cause: driver }));
		const response = await quizRpc(token.access_token, 'tools/call', 'patch_module_draft', {
			version: 2,
			moduleId: crypto.randomUUID(),
			requestId: crypto.randomUUID(),
			expectedRevision: 1,
			patch: { description: 'PRIVATE_REQUEST_MARKER' },
			rubric: {}
		});
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain('Opération indisponible.');
		expect(body).not.toContain('PRIVATE_');
		expect(logger).toHaveBeenCalledExactlyOnceWith(
			JSON.stringify({
				event: 'campus.mcp.tool.unavailable',
				tool: 'patch_module_draft',
				phase: 'operation',
				reason: 'SQLITE_ERROR'
			})
		);
		expect(JSON.stringify(logger.mock.calls)).not.toContain('PRIVATE_');
		logger.mockClear();
		vi.mocked(modulePatch.patchModule).mockImplementationOnce(async () => error(409, 'Fixture revision conflict'));
		const conflict = await quizRpc(token.access_token, 'tools/call', 'patch_module_draft', {
			version: 2,
			moduleId: crypto.randomUUID(),
			requestId: crypto.randomUUID(),
			expectedRevision: 1,
			patch: {},
			rubric: {}
		});
		expect(await conflict.text()).toContain('Fixture revision conflict');
		expect(logger).not.toHaveBeenCalled();
	});
	it.each([
		{ backchannel_logout_uri: 'https://logout.example.test/receiver' },
		{
			backchannel_logout_uri: 'https://logout.example.test/receiver',
			backchannel_logout_session_required: true
		},
		{ backchannel_logout_session_required: true },
		{ backchannel_logout_session_required: false }
	])('refuse les métadonnées de déconnexion serveur au DCR : %j', async (metadata) => {
		const outbound = vi.spyOn(globalThis, 'fetch');
		const response = await call(
			'/oauth2/register',
			{
				client_name: 'Codex fictif',
				redirect_uris: [callback],
				token_endpoint_auth_method: 'none',
				application_type: 'native',
				...metadata
			},
			'',
			true
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: 'invalid_client_metadata' });
		expect((await client.execute('SELECT id FROM oauth_client')).rows).toHaveLength(0);
		expect(outbound).not.toHaveBeenCalled();
	});

	it('conserve la connexion native et déconnecte sans notification externe', async () => {
		const outbound = vi.spyOn(globalThis, 'fetch');
		const { clientId, token } = await grant('modules:read offline_access');
		const registered = await client.execute({
			sql: 'SELECT backchannel_logout_uri FROM oauth_client WHERE client_id = ?',
			args: [clientId]
		});
		expect(registered.rows[0].backchannel_logout_uri).toBeNull();
		expect((await call('/sign-out', {}, cookie)).status).toBe(200);
		expect(outbound).not.toHaveBeenCalled();
		await expect(
			authenticateMcp(
				auth,
				client,
				origin,
				new Request(origin + '/mcp', {
					headers: { authorization: 'Bearer ' + token.access_token }
				})
			)
		).rejects.toMatchObject({ status: 401 });
	});

	it('neutralise aussi un ancien callback sans modifier le client et révoque la session', async () => {
		const outbound = vi.spyOn(globalThis, 'fetch');
		const { clientId, token } = await grant('modules:read offline_access');
		await client.execute({
			sql: `UPDATE oauth_client SET backchannel_logout_uri = ?,
				backchannel_logout_session_required = 1 WHERE client_id = ?`,
			args: ['https://historical.example.test/logout', clientId]
		});
		expect((await call('/sign-out', {}, cookie)).status).toBe(200);
		expect(outbound).not.toHaveBeenCalled();
		expect((await client.execute('SELECT id FROM session')).rows).toHaveLength(0);
		const stored = await client.execute({
			sql: `SELECT name, redirect_uris, backchannel_logout_uri,
				backchannel_logout_session_required FROM oauth_client WHERE client_id = ?`,
			args: [clientId]
		});
		expect(stored.rows[0]).toMatchObject({
			name: 'Codex fictif',
			backchannel_logout_uri: 'https://historical.example.test/logout',
			backchannel_logout_session_required: 1
		});
		expect(JSON.parse(String(stored.rows[0].redirect_uris))).toEqual([callback]);
		await expect(
			authenticateMcp(
				auth,
				client,
				origin,
				new Request(origin + '/mcp', {
					headers: { authorization: 'Bearer ' + token.access_token }
				})
			)
		).rejects.toMatchObject({ status: 401 });
		const refreshed = await call(
			'/oauth2/token',
			new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: token.refresh_token,
				client_id: clientId,
				resource: origin + '/mcp'
			}),
			'',
			true
		);
		expect(refreshed.status).toBe(403);
		expect(outbound).not.toHaveBeenCalled();
	});

	it('garde le filtre dans les transactions sans changer les autres données ou le rollback', async () => {
		const clientId = await registerClient();
		await client.execute({
			sql: `UPDATE oauth_client SET backchannel_logout_uri = ?,
				backchannel_logout_session_required = 1 WHERE client_id = ?`,
			args: ['https://historical.example.test/logout', clientId]
		});
		const context = await auth.$context;
		const adapter = context.adapter;
		const raw = drizzleAdapter(createDatabase(client), {
			provider: 'sqlite',
			schema,
			transaction: true
		})(context.options);
		const query = {
			model: 'oauthClient',
			where: [{ field: 'clientId', value: clientId }]
		};
		const original = await raw.findOne<Record<string, unknown>>(query);
		expect(original?.backchannelLogoutUri).toBe('https://historical.example.test/logout');
		const expected = { ...original, backchannelLogoutUri: null };
		expect(await adapter.findOne(query)).toEqual(expected);
		expect(await adapter.findMany(query)).toEqual([expected]);
		const selected = { ...query, select: ['clientId', 'name'] };
		expect(await adapter.findOne(selected)).toEqual(await raw.findOne(selected));
		const user = {
			model: 'user',
			where: [{ field: 'id', value: teacherId }],
			select: ['id', 'name']
		};
		expect(await adapter.findOne(user)).toEqual(await raw.findOne(user));
		expect(await adapter.findOne({ ...query, where: [{ field: 'clientId', value: 'missing' }] })).toBeNull();
		const result = await adapter.transaction(async (transaction) => {
			expect(await transaction.findOne(query)).toEqual(expected);
			expect(await transaction.findMany(query)).toEqual([expected]);
			return 'committed';
		});
		expect(result).toBe('committed');
		await expect(
			adapter.transaction(async (transaction) => {
				await transaction.update({ ...query, update: { name: 'Rollback fictif' } });
				expect(await transaction.findOne<Record<string, unknown>>(query)).toMatchObject({
					name: 'Rollback fictif',
					backchannelLogoutUri: null
				});
				throw new Error('rollback-fictif');
			})
		).rejects.toThrow('rollback-fictif');
		expect(await raw.findOne(query)).toEqual(original);
	});

	it('borne le DCR global, répond 429 et conserve le client actif puis sa révocation', async () => {
		const granted = await grant();
		for (let i = 0; i < unusedClientLimit; i++) {
			await client.execute({
				sql: `INSERT INTO oauth_client (id, client_id, redirect_uris, token_endpoint_auth_method, created_at)
				VALUES (?, ?, '[]', 'none', ?)`,
				args: ['pending-' + i, 'pending-' + i, Date.now()]
			});
		}
		const saturated = await call(
			'/oauth2/register',
			{
				redirect_uris: [callback],
				token_endpoint_auth_method: 'none',
				application_type: 'native'
			},
			'',
			true
		);
		expect(saturated.status, await saturated.clone().text()).toBe(429);
		expect(await saturated.json()).toMatchObject({ error: 'temporarily_unavailable' });
		await client.execute({
			sql: 'UPDATE oauth_client SET created_at = ?',
			args: [Date.now() - unusedClientRetentionMs - 1000]
		});
		await registerClient();
		expect(Number((await client.execute('SELECT COUNT(*) AS n FROM oauth_client')).rows[0].n)).toBe(2);
		const principal = await authenticateMcp(
			auth,
			client,
			origin,
			new Request(origin + '/mcp', {
				headers: { authorization: 'Bearer ' + granted.token.access_token }
			})
		);
		expect(principal.teacherId).toBe(teacherId);
		const [application] = await listApplications(client, teacherId);
		await revokeApplication(client, teacherId, {
			id: application.id,
			reviewedVersion: application.reviewedVersion
		});
		await registerClient();
		expect(
			(
				await client.execute({
					sql: 'SELECT id FROM oauth_client WHERE client_id = ?',
					args: [granted.clientId]
				})
			).rows
		).toHaveLength(1);
		await expect(
			authenticateMcp(
				auth,
				client,
				origin,
				new Request(origin + '/mcp', {
					headers: { authorization: 'Bearer ' + granted.token.access_token }
				})
			)
		).rejects.toMatchObject({ status: 401 });
	});

	it('conserve la limite effective DCR de cinq requêtes par minute et par IP/chemin', async () => {
		for (let i = 0; i < 5; i++) await registerClient();
		const response = await call(
			'/oauth2/register',
			{
				redirect_uris: [callback],
				token_endpoint_auth_method: 'none',
				application_type: 'native'
			},
			'',
			true
		);
		expect(response.status).toBe(429);
		expect(Number((await client.execute('SELECT COUNT(*) AS n FROM oauth_client')).rows[0].n)).toBe(5);
	});

	it('crée un brouillon privé par MCP, rejoue le reçu et garde les étudiants hors du contexte d’import', async () => {
		const ids = await seedFoundationFixtures(createDatabase(client));
		const binding = newFolderBinding(origin);
		const command = createModuleImportSchema.parse({
			version: 1,
			requestId: crypto.randomUUID(),
			moduleId: binding.moduleId,
			...resolveLocalModule(sampleLocalModule(ids.currentClass), binding, '/fictional/module')
		});
		const { token } = await grant('modules:read modules:create modules:rubric');
		const send = async (name: string, args: unknown) => {
			const response = await handleRemoteMcp(
				new Request(origin + '/mcp', {
					method: 'POST',
					headers: {
						authorization: 'Bearer ' + token.access_token,
						'content-type': 'application/json',
						accept: 'application/json',
						'mcp-protocol-version': '2026-07-28',
						'mcp-method': 'tools/call',
						'mcp-name': name
					},
					body: JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						method: 'tools/call',
						params: {
							name,
							arguments: args,
							_meta: {
								'io.modelcontextprotocol/protocolVersion': '2026-07-28',
								'io.modelcontextprotocol/clientInfo': { name: 'fictional-test', version: '1' },
								'io.modelcontextprotocol/clientCapabilities': {}
							}
						}
					})
				}),
				auth,
				client,
				origin
			);
			expect(response.status, await response.clone().text()).toBe(200);
			return (await response.json()) as {
				result: { isError?: boolean; structuredContent: Record<string, unknown> };
			};
		};
		const first = await send('create_module_draft', command);
		expect(first.result.isError).not.toBe(true);
		expect(first.result.structuredContent.moduleId).toBe(binding.moduleId);
		expect((await send('create_module_draft', command)).result.structuredContent).toEqual(
			first.result.structuredContent
		);
		expect((await client.execute('SELECT count(*) AS n FROM agent_import')).rows[0].n).toBe(1);
		expect((await client.execute('SELECT count(*) AS n FROM module_publication')).rows[0].n).toBe(1);
		const context = await send('get_import_context', { moduleId: binding.moduleId });
		expect(context.result.isError).not.toBe(true);
		expect(JSON.stringify(context)).not.toContain('Student Demo');
		expect(JSON.stringify(context)).not.toContain('"students"');
	});
	it('requires a dedicated roster consent and creates classes and students through remote MCP', async () => {
		const old = await grant('modules:read');
		const denied = await quizRpc(old.token.access_token, 'tools/call', 'create_class', {});
		expect(denied.status).toBe(403);
		expect(denied.headers.get('www-authenticate')).toContain('roster:manage');
		const { token } = await grant('modules:read roster:manage');
		const classId = crypto.randomUUID();
		const input = { id: classId, name: 'Remote Roster Demo', academicYear: '2026-2027' };
		const created = await quizRpc(token.access_token, 'tools/call', 'create_class', input);
		expect(await created.json()).toMatchObject({ result: { structuredContent: { id: classId } } });
		const add = {
			classId,
			expectedRevision: 1,
			students: [{ id: crypto.randomUUID(), name: 'Remote Student Demo' }]
		};
		const first = await (await quizRpc(token.access_token, 'tools/call', 'add_class_students', add)).json();
		expect(first).toMatchObject({ result: { structuredContent: { revision: 2 } } });
		expect(await (await quizRpc(token.access_token, 'tools/call', 'add_class_students', add)).json()).toEqual(first);
		const roster = await quizRpc(token.access_token, 'tools/call', 'get_class_roster', { classId });
		expect(await roster.json()).toMatchObject({
			result: { structuredContent: { students: [{ name: 'Remote Student Demo' }] } }
		});
	});
	it('authorizes quiz reading and writing independently without widening an existing module consent', async () => {
		const moduleOnly = await grant('modules:read');
		const blocked = await quizRpc(moduleOnly.token.access_token, 'tools/call', 'get_quiz_context', {
			moduleId: crypto.randomUUID()
		});
		expect(blocked.status).toBe(403);
		expect(blocked.headers.get('www-authenticate')).toContain('quizzes:read');
		const readOnly = await grant('modules:read quizzes:read');
		const listed = await quizRpc(readOnly.token.access_token, 'tools/list');
		expect(await listed.json()).toMatchObject({
			result: {
				tools: expect.arrayContaining(
					[{ name: 'get_import_context' }, { name: 'get_quiz_context' }].map((tool) => expect.objectContaining(tool))
				)
			}
		});
		expect((await quizRpc(readOnly.token.access_token, 'tools/call', 'create_quiz_draft', {})).status).toBe(403);
		await expect(grant('modules:read quizzes:write')).rejects.toMatchObject({ status: 422 });
	});

	it('creates and patches a private quiz through real remote MCP with exact replay receipts', async () => {
		const db = createDatabase(client);
		const ids = await seedFoundationFixtures(db);
		const lessonId = crypto.randomUUID(),
			groupId = crypto.randomUUID(),
			lineId = crypto.randomUUID(),
			optionId = crypto.randomUUID();
		await db.insert(schema.lessons).values({
			id: lessonId,
			contextId: ids.currentContext,
			title: 'Fictional quiz lesson',
			startsAt: new Date('2026-11-03T08:00:00Z'),
			endsAt: new Date('2026-11-03T10:00:00Z')
		});
		await db.insert(schema.rubricGroups).values({ id: groupId, assessmentId: ids.quiz, title: 'Native quizzes' });
		await db
			.insert(schema.rubricLines)
			.values({ id: lineId, assessmentId: ids.quiz, groupId, label: 'Native quiz', maxPoints: 1 });
		const command = {
			id: crypto.randomUUID(),
			requestId: crypto.randomUUID(),
			moduleId: ids.module,
			contextId: ids.currentContext,
			lessonId,
			assessmentId: ids.quiz,
			lineId,
			expectedRevision: 0,
			content: {
				version: 1,
				title: 'Fictional quiz',
				durationSeconds: 1200,
				questions: [
					{
						id: crypto.randomUUID(),
						type: 'single',
						prompt: 'Result?',
						code: '1 + 1',
						codeLanguage: 'javascript',
						options: [
							{ id: optionId, text: '2' },
							{ id: crypto.randomUUID(), text: '3' }
						],
						correctOptionIds: [optionId]
					}
				]
			}
		};
		const { token } = await grant('modules:read quizzes:read quizzes:write');
		const send = async (name: string, args: unknown) => {
			const response = await quizRpc(token.access_token, 'tools/call', name, args);
			expect(response.status, await response.clone().text()).toBe(200);
			const result = (await response.json()) as {
				result: { isError?: boolean; structuredContent: Record<string, unknown> };
			};
			expect(result.result.isError, JSON.stringify(result)).not.toBe(true);
			return result.result.structuredContent;
		};
		const first = await send('create_quiz_draft', command);
		expect(await send('create_quiz_draft', command)).toEqual(first);
		const patch = {
			moduleId: ids.module,
			id: command.id,
			requestId: crypto.randomUUID(),
			expectedRevision: 1,
			patch: {
				questions: [{ id: command.content.questions[0].id, options: [{ id: optionId, text: 'Two' }] }]
			}
		};
		const second = await send('patch_quiz_draft', patch);
		expect(await send('patch_quiz_draft', patch)).toEqual(second);
		expect(await send('create_quiz_draft', command)).toEqual(first);
		const context = quizContextSchema.parse(
			await send('get_quiz_context', { moduleId: ids.module, quizId: command.id })
		);
		expect(context.quiz).toMatchObject({
			revision: 2,
			needsReview: true,
			content: {
				questions: [
					expect.objectContaining({
						code: '1 + 1',
						options: [{ id: optionId, text: 'Two' }, command.content.questions[0].options[1]]
					})
				]
			}
		});
		expect(JSON.stringify(context)).not.toContain('Student Demo');
		expect((await getQuizDraft(db, command.id)).needsReview).toBe(true);
		expect(await db.select().from(schema.modulePublications)).toHaveLength(1);
		expect(await db.select().from(schema.quizGradeReports)).toHaveLength(0);
	});

	it('conserve le droit précédent lorsqu’une demande plus large est refusée', async () => {
		const { clientId, token } = await grant('modules:read');
		const location = await requestConsent(clientId);
		const reviewed = await readOAuthRequest(auth, client, location.search.slice(1), origin);
		await decideOAuth(auth, client, origin, new Headers({ cookie, origin }), {
			oauthQuery: reviewed.oauthQuery,
			accept: false,
			scopes: reviewed.scopes
		});
		expect(await listApplications(client, teacherId)).toHaveLength(1);
		expect(
			(
				await authenticateMcp(
					auth,
					client,
					origin,
					new Request(origin + '/mcp', {
						headers: { authorization: 'Bearer ' + token.access_token }
					})
				)
			).scopes
		).toEqual(['modules:read']);
	});
	it('invalide l’accès après suppression de la session et refuse son renouvellement', async () => {
		const { token, clientId } = await grant();
		await client.execute('DELETE FROM session');
		await expect(
			authenticateMcp(
				auth,
				client,
				origin,
				new Request(origin + '/mcp', { headers: { authorization: 'Bearer ' + token.access_token } })
			)
		).rejects.toMatchObject({ status: 401 });
		const refresh = await call(
			'/oauth2/token',
			new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: token.refresh_token,
				client_id: clientId,
				resource: origin + '/mcp'
			}),
			'',
			true
		);
		expect(refresh.status).not.toBe(200);
	});
	it('fait tourner les refresh et refuse la réutilisation du jeton précédent', async () => {
		const { token, clientId } = await grant();
		const form = new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: token.refresh_token,
			client_id: clientId,
			resource: origin + '/mcp'
		});
		const first = await call('/oauth2/token', form, '', true);
		expect(first.status, await first.clone().text()).toBe(200);
		const rotated = (await first.json()) as { refresh_token: string };
		expect(rotated.refresh_token).not.toBe(token.refresh_token);
		expect((await call('/oauth2/token', form, '', true)).status).not.toBe(200);
		form.set('refresh_token', rotated.refresh_token);
		expect((await call('/oauth2/token', form, '', true)).status).not.toBe(200);
	});
	it('ne confond pas un JWT signé pour une autre audience ou un autre émetteur', async () => {
		const { token } = await grant();
		const payload = JSON.parse(Buffer.from(token.access_token.split('.')[1], 'base64url').toString()) as Record<
			string,
			unknown
		>;
		for (const options of [
			{ audience: 'https://other.example.test/mcp' },
			{ issuer: 'https://other.example.test/auth' }
		]) {
			const signed = await auth.api.signJWT({
				body: {
					payload: {
						...payload,
						...('audience' in options ? { aud: options.audience } : { iss: options.issuer })
					},
					overrideOptions: { jwt: options }
				}
			});
			await expect(
				authenticateMcp(
					auth,
					client,
					origin,
					new Request(origin + '/mcp', { headers: { authorization: 'Bearer ' + signed.token } })
				)
			).rejects.toMatchObject({ status: 401 });
		}
	});
	it('reprend la demande signée après la connexion depuis une navigation GET', async () => {
		const id = await registerClient();
		const location = await requestConsent(id, undefined, '');
		expect(location.pathname).toBe('/connexion/application');
		const continued = await browserOAuth(auth, origin, new Headers({ cookie }), '/oauth2/continue', {
			oauth_query: location.search.slice(1)
		});
		expect(new URL(continued.url, origin).pathname).toBe('/autoriser');
	});
	it('sert le protocole 2026-07-28 et vérifie les en-têtes miroir avec le SDK', async () => {
		const { token } = await grant('modules:read');
		const headers = {
			authorization: 'Bearer ' + token.access_token,
			'content-type': 'application/json',
			'mcp-protocol-version': '2026-07-28',
			'mcp-method': 'tools/list',
			accept: 'application/json, text/event-stream'
		};
		const body = {
			jsonrpc: '2.0',
			id: 7,
			method: 'tools/list',
			params: {
				_meta: {
					'io.modelcontextprotocol/protocolVersion': '2026-07-28',
					'io.modelcontextprotocol/clientInfo': { name: 'fictional-test-client', version: '1.0.0' },
					'io.modelcontextprotocol/clientCapabilities': {}
				}
			}
		};
		const response = await handleRemoteMcp(
			new Request(origin + '/mcp', { method: 'POST', headers, body: JSON.stringify(body) }),
			auth,
			client,
			origin
		);
		expect(response.status, await response.clone().text()).toBe(200);
		expect(await response.json()).toMatchObject({
			result: { tools: expect.arrayContaining([expect.objectContaining({ name: 'get_import_context' })]) }
		});
		const mismatch = await handleRemoteMcp(
			new Request(origin + '/mcp', {
				method: 'POST',
				headers: { ...headers, 'mcp-method': 'tools/call' },
				body: JSON.stringify(body)
			}),
			auth,
			client,
			origin
		);
		expect(mismatch.status, await mismatch.clone().text()).toBe(400);
	});
	it.each([
		'https://other.example.test/callback',
		'http://127.0.0.1:47913/other',
		'http://127.0.0.1:47913/callback?next=evil',
		'http://127.0.0.1.evil.test/callback',
		'http://user@127.0.0.1/callback',
		'http://127.0.0.1/callback#fragment'
	])('refuse la redirection non autorisée %s', async (redirect) => {
		const response = await call(
			'/oauth2/register',
			{
				client_name: 'Fictif',
				redirect_uris: [redirect],
				token_endpoint_auth_method: 'none',
				application_type: 'native'
			},
			'',
			true
		);
		expect(response.status).toBe(400);
	});
	it.each(['resource', 'code_challenge', 'code_challenge_method'])(
		'exige %s et ne délivre pas de code en son absence',
		async (field) => {
			const id = await registerClient();
			const params = new URLSearchParams({
				client_id: id,
				redirect_uri: callback,
				response_type: 'code',
				scope: 'modules:read',
				resource: origin + '/mcp',
				code_challenge: challenge,
				code_challenge_method: 'S256'
			});
			params.delete(field);
			const response = await call('/oauth2/authorize?' + params, undefined, cookie);
			expect(response.status).toBe(400);
			expect(response.headers.get('location')).toBeNull();
		}
	);
	it('refuse PKCE plain et un grant machine', async () => {
		const id = await registerClient();
		const params = new URLSearchParams({
			client_id: id,
			redirect_uri: callback,
			response_type: 'code',
			scope: 'modules:read',
			resource: origin + '/mcp',
			code_challenge: verifier,
			code_challenge_method: 'plain'
		});
		expect((await call('/oauth2/authorize?' + params, undefined, cookie)).status).toBe(400);
		expect(
			(
				await call(
					'/oauth2/token',
					new URLSearchParams({
						client_id: id,
						grant_type: 'client_credentials',
						resource: origin + '/mcp'
					}),
					'',
					true
				)
			).status
		).not.toBe(200);
	});
	it('refuse les requêtes natives provenant d’un site tiers', async () => {
		const response = await auth.handler(
			new Request(origin + '/api/auth/oauth2/register', {
				method: 'POST',
				headers: { origin: 'https://evil.example.test', 'content-type': 'application/json' },
				body: JSON.stringify({ redirect_uris: [callback], token_endpoint_auth_method: 'none' })
			})
		);
		expect(response.status).toBe(403);
	});
	it('accepte la navigation OAuth intersites et refuse le fetch intersites', async () => {
		const id = await registerClient();
		const query = new URLSearchParams({
			client_id: id,
			redirect_uri: callback,
			response_type: 'code',
			scope: 'modules:read',
			resource: origin + '/mcp',
			state: 'native-navigation-state',
			code_challenge: challenge,
			code_challenge_method: 'S256'
		});
		for (const mode of ['navigate', 'cors']) {
			const response = await auth.handler(
				new Request(origin + '/api/auth/oauth2/authorize?' + query, {
					headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': mode, accept: 'text/html' }
				})
			);
			expect(response.status).toBe(mode === 'navigate' ? 302 : 403);
			if (mode === 'navigate')
				expect(new URL(response.headers.get('location')!, origin).pathname).toBe('/connexion/application');
		}
	});
	it.each(['GET', 'POST'])('offers every permission for anonymous %s connection discovery', async (method) => {
		const response = await handleRemoteMcp(
			new Request(origin + '/mcp', { method, ...(method === 'POST' ? { body: '{bad' } : {}) }),
			auth,
			client,
			origin
		);
		expect(response.status).toBe(401);
		expect(response.headers.get('WWW-Authenticate')).toContain('/.well-known/oauth-protected-resource/mcp');
		expect(response.headers.get('WWW-Authenticate')).toContain(`scope="${mcpScopes.join(' ')}"`);
		const metadata = await auth.handler(new Request(origin + '/.well-known/oauth-protected-resource/mcp'));
		expect(metadata.status).toBe(200);
		expect(await metadata.json()).toMatchObject({
			resource: origin + '/mcp',
			authorization_servers: [origin + '/api/auth']
		});
	});
	it('refuse cookie seul, clé stdio, query token, mauvaise origine et signature altérée', async () => {
		const { token } = await grant();
		for (const headers of [
			{ cookie } as Record<string, string>,
			{ authorization: 'Bearer coursely_' + 'a'.repeat(64) },
			{ authorization: 'Bearer ' + token.access_token.slice(0, -8) + 'aaaaaaaa' }
		]) {
			expect((await handleRemoteMcp(new Request(origin + '/mcp', { headers }), auth, client, origin)).status).toBe(401);
		}
		expect(
			(
				await handleRemoteMcp(
					new Request(origin + '/mcp?%61ccess_token=hidden', {
						headers: { authorization: 'Bearer ' + token.access_token }
					}),
					auth,
					client,
					origin
				)
			).status
		).toBe(401);
		expect(
			(
				await handleRemoteMcp(
					new Request(origin + '/mcp', {
						headers: {
							authorization: 'Bearer ' + token.access_token,
							origin: 'https://evil.example.test'
						}
					}),
					auth,
					client,
					origin
				)
			).status
		).toBe(403);
	});
	it('bloque un outil ou un barème non consenti avec un challenge de scope', async () => {
		const { token } = await grant('modules:read modules:update');
		for (const [name, input, missing] of [
			['create_module_draft', {}, 'modules:create'],
			['patch_module_draft', { rubric: {} }, 'modules:rubric'],
			['get_correction_context', {}, 'corrections:read']
		] as const) {
			const response = await handleRemoteMcp(
				new Request(origin + '/mcp', {
					method: 'POST',
					headers: {
						authorization: 'Bearer ' + token.access_token,
						'content-type': 'application/json'
					},
					body: JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						method: 'tools/call',
						params: { name, arguments: input }
					})
				}),
				auth,
				client,
				origin
			);
			expect(response.status).toBe(403);
			expect(response.headers.get('www-authenticate')).toContain(missing);
		}
	});
	it('borne le corps authentifié et refuse les batches et méthodes non disponibles', async () => {
		const { token } = await grant('modules:read');
		const headers = {
			authorization: 'Bearer ' + token.access_token,
			'content-type': 'application/json'
		};
		const tooBig = await handleRemoteMcp(
			new Request(origin + '/mcp', {
				method: 'POST',
				headers,
				body: JSON.stringify({ padding: 'x'.repeat(256000) })
			}),
			auth,
			client,
			origin
		);
		expect(tooBig.status).toBe(413);
		expect(
			(
				await handleRemoteMcp(
					new Request(origin + '/mcp', { method: 'POST', headers, body: '[]' }),
					auth,
					client,
					origin
				)
			).status
		).toBe(400);
		const method = await handleRemoteMcp(
			new Request(origin + '/mcp', {
				method: 'POST',
				headers,
				body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'subscriptions/listen' })
			}),
			auth,
			client,
			origin
		);
		expect(await method.json()).toMatchObject({ error: { code: -32601 } });
		expect((await handleRemoteMcp(new Request(origin + '/mcp', { headers }), auth, client, origin)).status).toBe(405);
	});
	it('ne délivre pas de refresh sans le scope offline_access', async () => {
		const { token } = await grant('modules:read');
		expect(token.refresh_token).toBeUndefined();
	});
	it('refuse un code déjà échangé, une mauvaise ressource et un mauvais vérificateur', async () => {
		const { clientId, code } = await grant();
		const replay = await call(
			'/oauth2/token',
			new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				client_id: clientId,
				redirect_uri: callback,
				code_verifier: verifier,
				resource: origin + '/mcp'
			}),
			'',
			true
		);
		expect(replay.status).toBe(400);
		for (const resource of ['', 'https://other.example.test/mcp']) {
			expect(
				(
					await call(
						'/oauth2/token',
						new URLSearchParams({
							grant_type: 'authorization_code',
							code,
							client_id: clientId,
							redirect_uri: callback,
							code_verifier: verifier,
							...(resource ? { resource } : {})
						}),
						'',
						true
					)
				).status
			).toBe(400);
		}
		const url = await requestConsent(clientId);
		const reviewed = await readOAuthRequest(auth, client, url.search.slice(1), origin);
		const decision = await decideOAuth(auth, client, origin, new Headers({ cookie, origin }), {
			...reviewed,
			accept: true,
			scopes: reviewed.scopes
		});
		const freshCode = new URL(decision.url).searchParams.get('code')!;
		const invalidVerifier = await call(
			'/oauth2/token',
			new URLSearchParams({
				grant_type: 'authorization_code',
				code: freshCode,
				client_id: clientId,
				redirect_uri: callback,
				code_verifier: 'b'.repeat(64),
				resource: origin + '/mcp'
			}),
			'',
			true
		);
		expect(invalidVerifier.status).toBe(400);
		expect(await invalidVerifier.json()).toMatchObject({ error: 'invalid_grant' });
	});
	it('fait expirer la demande signée et le code non utilisé', async () => {
		const id = await registerClient();
		const url = await requestConsent(id);
		const reviewed = await readOAuthRequest(auth, client, url.search.slice(1), origin);
		const decision = await decideOAuth(auth, client, origin, new Headers({ cookie, origin }), {
			oauthQuery: reviewed.oauthQuery,
			accept: true,
			scopes: reviewed.scopes
		});
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.now() + 180000);
		await expect(readOAuthRequest(auth, client, reviewed.oauthQuery, origin)).rejects.toMatchObject({ status: 400 });
		const response = await call(
			'/oauth2/token',
			new URLSearchParams({
				grant_type: 'authorization_code',
				code: new URL(decision.url).searchParams.get('code')!,
				client_id: id,
				redirect_uri: callback,
				code_verifier: verifier,
				resource: origin + '/mcp'
			}),
			'',
			true
		);
		expect(response.status).toBe(400);
	});
	it('fait expirer JWT et session, et stocke les refresh et codes sans leur valeur brute', async () => {
		const { token } = await grant();
		const rows = await client.execute('SELECT token FROM oauth_refresh_token');
		expect(rows.rows).toHaveLength(1);
		expect(String(rows.rows[0].token)).not.toContain(token.refresh_token);
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.now() + 601000);
		await expect(
			authenticateMcp(
				auth,
				client,
				origin,
				new Request(origin + '/mcp', { headers: { authorization: 'Bearer ' + token.access_token } })
			)
		).rejects.toMatchObject({ status: 401 });
	});
	it('refuse un instantané périmé ou la révocation par un autre enseignant', async () => {
		await grant();
		const [application] = await listApplications(client, teacherId);
		await expect(revokeApplication(client, crypto.randomUUID(), application)).rejects.toMatchObject({ status: 409 });
		await expect(
			revokeApplication(client, teacherId, { ...application, reviewedVersion: 'old' })
		).rejects.toMatchObject({ status: 409 });
		expect(await listApplications(client, teacherId)).toHaveLength(1);
	});
	it('ne réactive pas un ancien JWT après révocation puis nouvel accord', async () => {
		const { clientId, token } = await grant();
		const [application] = await listApplications(client, teacherId);
		await revokeApplication(client, teacherId, application);
		const url = await requestConsent(clientId);
		const reviewed = await readOAuthRequest(auth, client, url.search.slice(1), origin);
		await decideOAuth(auth, client, origin, new Headers({ cookie, origin }), {
			oauthQuery: reviewed.oauthQuery,
			accept: true,
			scopes: reviewed.scopes
		});
		expect(await listApplications(client, teacherId)).toHaveLength(1);
		await expect(
			authenticateMcp(
				auth,
				client,
				origin,
				new Request(origin + '/mcp', { headers: { authorization: 'Bearer ' + token.access_token } })
			)
		).rejects.toMatchObject({ status: 401 });
	});
	it('découvre le serveur et termine PKCE avec passkey, consentement explicite et JWT lié à la ressource', async () => {
		const metadata = await auth.api.getOAuthServerConfig();
		expect(metadata.issuer).toBe(origin + '/api/auth');
		expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
		expect(metadata.scopes_supported).toEqual([...mcpScopes]);
		expect(defaultMcpScopes(mcpScopes)).toEqual([...mcpScopes]);
		const { token } = await grant();
		expect(token.expires_in).toBe(600);
		expect(token.refresh_token).toBeTruthy();
		const principal = await authenticateMcp(
			auth,
			client,
			origin,
			new Request(origin + '/mcp', { headers: { authorization: 'Bearer ' + token.access_token } })
		);
		expect(principal.teacherId).toBe(teacherId);
		expect(principal.scopes).toContain('modules:update');
	});
	it('refuse la demande sans créer de consentement et conserve state et issuer', async () => {
		const id = await registerClient();
		const url = await requestConsent(id);
		const result = await decideOAuth(auth, client, origin, new Headers({ cookie, origin }), {
			oauthQuery: url.search.slice(1),
			accept: false,
			scopes: ['modules:read']
		});
		expect(new URL(result.url).searchParams.get('error')).toBe('access_denied');
		expect(new URL(result.url).searchParams.get('state')).toBe('state-fictif');
		expect(new URL(result.url).searchParams.get('iss')).toBe(origin + '/api/auth');
		expect(await listApplications(client, teacherId)).toEqual([]);
	});
	it('exige une session et une signature valide pour consulter la demande', async () => {
		const id = await registerClient();
		const location = await requestConsent(id, undefined, '');
		expect(location.pathname).toBe('/connexion/application');
		await expect(
			readOAuthRequest(auth, client, location.search.slice(1).replace('modules%3Aread', 'modules%3Arubric'), origin)
		).rejects.toMatchObject({ status: 400 });
	});
	it('ne révèle que les outils permis et conserve les deux outils de dossiers en stdio uniquement', async () => {
		const { token } = await grant('modules:read');
		const response = await handleRemoteMcp(
			new Request(origin + '/mcp', {
				method: 'POST',
				headers: {
					authorization: 'Bearer ' + token.access_token,
					'content-type': 'application/json',
					accept: 'application/json, text/event-stream',
					'mcp-protocol-version': '2025-11-25'
				},
				body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
			}),
			auth,
			client,
			origin
		);
		expect(response.status, await response.clone().text()).toBe(200);
		const text = await response.text();
		expect(text).toContain('get_import_context');
		expect(text).not.toContain('inspect_module_folder');
		expect(text).not.toContain('bind_module_folder');
		expect(text).not.toContain('create_module_draft');
	});
	it('révoque immédiatement JWT et refresh sans détruire la session enseignant', async () => {
		const { token, clientId } = await grant();
		const [application] = await listApplications(client, teacherId);
		await revokeApplication(client, teacherId, application);
		await expect(
			authenticateMcp(
				auth,
				client,
				origin,
				new Request(origin + '/mcp', { headers: { authorization: 'Bearer ' + token.access_token } })
			)
		).rejects.toMatchObject({ status: 401 });
		const refresh = await call(
			'/oauth2/token',
			new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: token.refresh_token,
				client_id: clientId,
				resource: origin + '/mcp'
			}),
			'',
			true
		);
		expect(refresh.status).not.toBe(200);
		expect((await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user.id).toBe(teacherId);
	});
});
