import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { randomBytes } from 'node:crypto';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../db/index.js';
import { apikey, user, session } from '../db/schema.js';
import { createAuth, type Auth } from '../auth.js';
import { agentConfigId } from '../../domain/module-import.js';
import {
	issueAgentKey,
	revokeAgentKey,
	authenticateAgent,
	agentBearer,
	requireRubricPermission
} from './keys.js';

let client: Client, db: Database, auth: Auth;
const teacherId = 'fictional-teacher',
	email = 'teacher@example.test';
beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	db = createDatabase(client);
	await migrate(db, { migrationsFolder: './drizzle' });
	await db.insert(user).values({ id: teacherId, email, name: 'Teacher Demo', role: 'teacher' });
	auth = await createAuth(
		{
			ORIGIN: 'https://coursely.example.test',
			BETTER_AUTH_SECRET: randomBytes(32).toString('hex')
		},
		client
	);
});
afterEach(() => {
	client.close();
	vi.restoreAllMocks();
});

describe('Teacher-bound limited agent keys', () => {
	it('issues a finite, scoped key whose stored value is hashed', async () => {
		const issued = await issueAgentKey(auth, client, email);
		const [stored] = await db.select().from(apikey);
		expect(stored.key).not.toBe(issued.key);
		expect(stored.configId).toBe(agentConfigId);
		expect(stored.referenceId).toBe(teacherId);
		expect(stored.expiresAt!.getTime() - Date.now()).toBeGreaterThan(29 * 86400000);
		expect(stored.expiresAt!.getTime() - Date.now()).toBeLessThanOrEqual(30 * 86400000);
		for (const action of ['read', 'create', 'update', 'rubric'] as const)
			expect((await authenticateAgent(auth, client, issued.key, action)).teacherId).toBe(teacherId);
		expect(
			await auth.api.getSession({ headers: new Headers({ 'x-api-key': issued.key }) })
		).toBeNull();
		await expect(issueAgentKey(auth, client, 'missing@example.test')).rejects.toThrow('teacher');
		await expect(issueAgentKey(auth, client, email, 'Codex', 0)).rejects.toThrow('duration');
	});
	it('does not broaden old module keys and requires explicit correction access on newly issued keys', async () => {
		const moduleOnly = await issueAgentKey(auth, client, email);
		for (const action of ['proposal_read', 'proposal_create'] as const)
			await expect(authenticateAgent(auth, client, moduleOnly.key, action)).rejects.toMatchObject({
				status: 401
			});
		const scoped = await issueAgentKey(auth, client, email, 'Correction demo', 1, true);
		for (const action of ['proposal_read', 'proposal_create'] as const)
			expect((await authenticateAgent(auth, client, scoped.key, action)).teacherId).toBe(teacherId);
		expect(
			await auth.api.getSession({ headers: new Headers({ 'x-api-key': scoped.key }) })
		).toBeNull();
	});
	it.each(['expired', 'disabled', 'revoked', 'unlimited'])(
		'refuses a %s key without removing the teacher account',
		async (state) => {
			const key = await issueAgentKey(auth, client, email);
			if (state === 'revoked') await revokeAgentKey(client, email, key.id);
			else
				await db
					.update(apikey)
					.set(
						state === 'expired'
							? { expiresAt: new Date(0) }
							: state === 'disabled'
								? { enabled: false }
								: { expiresAt: null }
					)
					.where(eq(apikey.id, key.id));
			await expect(authenticateAgent(auth, client, key.key, 'read')).rejects.toMatchObject({
				status: 401
			});
			expect(await db.select().from(user)).toHaveLength(1);
		}
	);
	it('enforces read/write and rubric scopes separately', async () => {
		const key = await auth.api.createApiKey({
			body: {
				configId: agentConfigId,
				userId: teacherId,
				name: 'Read only',
				expiresIn: 86400,
				permissions: { 'module-drafts': ['read'] }
			}
		});
		expect((await authenticateAgent(auth, client, key.key, 'read')).teacherId).toBe(teacherId);
		await expect(authenticateAgent(auth, client, key.key, 'create')).rejects.toMatchObject({
			status: 401
		});
		expect(() => requireRubricPermission({ 'module-drafts': ['update'] })).toThrow();
		expect(() => requireRubricPermission({ 'module-drafts': ['rubric'] })).not.toThrow();
	});
	it('applies the plugin quota to concurrent verification requests', async () => {
		const key = await issueAgentKey(auth, client, email);
		await db.update(apikey).set({ rateLimitMax: 2 }).where(eq(apikey.id, key.id));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const results = await Promise.allSettled(
			Array.from({ length: 6 }, () => authenticateAgent(auth, client, key.key, 'read'))
		);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
		expect(
			results.filter((r) => r.status === 'rejected').every((r) => r.reason.status === 429)
		).toBe(true);
	});
	it('revokes only the selected teacher key and preserves browser sessions', async () => {
		const key = await issueAgentKey(auth, client, email);
		await db.insert(session).values({
			id: 'session-demo',
			userId: teacherId,
			token: 'fictional-session-token',
			expiresAt: new Date(Date.now() + 60000)
		});
		await db
			.insert(user)
			.values({ id: 'another-teacher', name: 'Other Demo', email: 'other@example.test' });
		expect(await revokeAgentKey(client, 'other@example.test', key.id)).toBe(false);
		expect(await revokeAgentKey(client, email, key.id)).toBe(true);
		expect(await db.select().from(session)).toHaveLength(1);
		expect(await db.select().from(user)).toHaveLength(2);
	});
	it('refuses cookie-only or malformed bearer authorization', () => {
		for (const header of ['', 'Basic abc', 'Bearer short', 'Bearer ' + 'a'.repeat(201)])
			expect(() =>
				agentBearer(
					new Request('https://coursely.example.test', {
						headers: { authorization: header, cookie: 'session=fictional' }
					})
				)
			).toThrow();
	});
});
