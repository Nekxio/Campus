import { POST as createAgentClass } from '../../../routes/api/agent/classes/+server.js';
import { GET as readRoster, POST as addRoster } from '../../../routes/api/agent/roster/+server.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { randomBytes } from 'node:crypto';
import { migrate } from 'drizzle-orm/libsql/migrator';
import type { RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { createDatabase } from '../db/index.js';
import { user, apikey } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { createAuth, type Auth } from '../auth.js';
import { issueAgentKey, revokeAgentKey } from './keys.js';
vi.mock('../auth/runtime.js', () => ({ withAuth: vi.fn() }));
import { withAuth } from '../auth/runtime.js';
import { agentRead, agentWrite } from './http.js';
import { POST as publicKeyManagement } from '../../../routes/api/auth/[...all]/+server.js';

let client: Client, auth: Auth, key: Awaited<ReturnType<typeof issueAgentKey>>;
import { GET as proposalContext } from '../../../routes/api/agent/correction-context/+server.js';
import { POST as proposalCreate } from '../../../routes/api/agent/proposals/+server.js';
import { GET as quizContext } from '../../../routes/api/agent/quizzes/context/+server.js';
import { POST as quizCreate } from '../../../routes/api/agent/quizzes/+server.js';
import { PATCH as quizPatch } from '../../../routes/api/agent/quizzes/[quizId]/+server.js';
import { POST as teacherDecision } from '../../../routes/api/teaching/proposals/[proposalId]/decision/+server.js';
const origin = 'https://campus.example.test',
	operation = vi.fn(async () => ({ saved: true }));
const endpoint = agentWrite(
	'create',
	z.strictObject({ title: z.string().min(1), rubric: z.object({}).optional() }),
	operation
);
function event(body = '{"title":"Demo"}', headers: Record<string, string> = {}): RequestEvent {
	const request = new Request(origin + '/api/agent/modules', {
		method: 'POST',
		body,
		headers: { 'content-type': 'application/json', ...headers }
	});
	return {
		request,
		url: new URL(request.url),
		params: {},
		locals: { user: { id: 'teacher', role: 'teacher' }, session: { userId: 'teacher' } }
	} as unknown as RequestEvent;
}
function authorized(body?: string, headers: Record<string, string> = {}) {
	return event(body, { authorization: 'Bearer ' + key.key, ...headers });
}
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	await migrate(createDatabase(client), { migrationsFolder: './drizzle' });
	await createDatabase(client)
		.insert(user)
		.values({ id: 'teacher', name: 'Teacher Demo', email: 'teacher@example.test' });
	auth = await createAuth({ ORIGIN: origin, BETTER_AUTH_SECRET: randomBytes(32).toString('hex') }, client);
	key = await issueAgentKey(auth, client, 'teacher@example.test');
	vi.mocked(withAuth).mockImplementation(async (run) => run(auth, client, origin));
	vi.mocked(withAuth).mockClear();
	operation.mockClear();
});
afterEach(() => {
	client.close();
	vi.restoreAllMocks();
});

describe('Agent HTTP boundary', () => {
	it('rejects cookie-only access before auth runtime, body decoding or teaching access', async () => {
		const response = await endpoint(event('not json', { cookie: 'session=demo' }));
		expect(response.status).toBe(401);
		expect(response.headers.get('cache-control')).toContain('no-store');
		expect(withAuth).not.toHaveBeenCalled();
		expect(operation).not.toHaveBeenCalled();
	});
	it('rejects cross-origin browser requests but accepts an authenticated stdio client without Origin', async () => {
		expect((await endpoint(authorized(undefined, { origin: 'https://other.example.test' }))).status).toBe(403);
		expect((await endpoint(authorized(undefined, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
		expect(withAuth).not.toHaveBeenCalled();
		expect((await endpoint(authorized())).status).toBe(200);
		expect(operation).toHaveBeenCalledTimes(1);
	});
	it('reports malformed, oversized and invalid imports without invoking the teaching operation', async () => {
		expect((await endpoint(authorized('{'))).status).toBe(400);
		expect((await endpoint(authorized('a'.repeat(256001)))).status).toBe(413);
		expect((await endpoint(authorized(undefined, { 'content-type': 'text/plain' }))).status).toBe(415);
		const invalid = await endpoint(authorized('{"title":"","scores":[]}'));
		expect(invalid.status).toBe(422);
		expect(await invalid.json()).toHaveProperty('fields.title');
		expect(operation).not.toHaveBeenCalled();
	});
	it('requires the rubric scope in addition to the module write scope', async () => {
		await createDatabase(client)
			.update(apikey)
			.set({ permissions: JSON.stringify({ 'module-drafts': ['create'] }) })
			.where(eq(apikey.id, key.id));
		expect((await endpoint(authorized('{"title":"Demo","rubric":{}}'))).status).toBe(403);
		expect(operation).not.toHaveBeenCalled();
		expect((await endpoint(authorized())).status).toBe(200);
	});
	it('rejects revoked keys before reads and writes', async () => {
		await revokeAgentKey(client, 'teacher@example.test', key.id);
		expect((await endpoint(authorized())).status).toBe(401);
		expect((await agentRead(operation)(authorized())).status).toBe(401);
		expect(operation).not.toHaveBeenCalled();
	});
	it('refuses correction reads and writes for existing module-only keys before decoding', async () => {
		expect((await proposalContext(authorized())).status).toBe(401);
		expect((await proposalCreate(authorized('not JSON'))).status).toBe(401);
		const issued = await issueAgentKey(auth, client, 'teacher@example.test', 'Corrections', 1, true);
		const e = event('not JSON', { authorization: 'Bearer ' + issued.key });
		expect((await proposalCreate(e)).status).toBe(400);
		expect((await teacherDecision({ ...e, locals: { user: null, session: null } })).status).toBe(401);
	});
	it('keeps public API-key management blocked even for an authenticated teacher', async () => {
		const e = {
			...authorized(),
			url: new URL(origin + '/api/auth/api-key/create'),
			params: { all: 'api-key/create' }
		} as Parameters<typeof publicKeyManagement>[0];
		const response = await publicKeyManagement(e);
		expect(response.status).toBe(403);
		expect(response.headers.get('cache-control')).toContain('no-store');
		expect(withAuth).not.toHaveBeenCalled();
	});
	it('checks dedicated roster rights before decoding or reading and accepts an opted-in key', async () => {
		expect((await createAgentClass(authorized('not json'))).status).toBe(401);
		expect((await readRoster(authorized())).status).toBe(401);
		expect((await addRoster(authorized('not json'))).status).toBe(401);
		const issued = await issueAgentKey(auth, client, 'teacher@example.test', 'Roster', 1, false, false, true);
		const headers = { authorization: 'Bearer ' + issued.key };
		const input = { id: crypto.randomUUID(), name: 'Roster Demo', academicYear: '2026-2027' };
		const response = await createAgentClass(event(JSON.stringify(input), headers));
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toContain('no-store');
		expect(await response.json()).toEqual({ id: input.id });
		expect((await addRoster(event('not json', headers))).status).toBe(400);
		const e = event(undefined, headers);
		e.url.searchParams.set('classId', input.id);
		expect((await readRoster(e)).status).toBe(200);
	});
	it('requires quiz permission before reading context or decoding a quiz write', async () => {
		expect((await quizContext(authorized())).status).toBe(401);
		expect((await quizCreate(authorized('not JSON'))).status).toBe(401);
		expect(
			(
				await quizPatch({
					...authorized('not JSON'),
					params: { quizId: crypto.randomUUID() }
				} as Parameters<typeof quizPatch>[0])
			).status
		).toBe(401);
		const issued = await issueAgentKey(auth, client, 'teacher@example.test', 'Quizzes', 1, false, true);
		const e = event('not JSON', { authorization: 'Bearer ' + issued.key });
		expect((await quizCreate(e)).status).toBe(400);
	});
});
