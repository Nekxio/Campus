import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import type { Client } from '@libsql/client/web';

vi.mock('$app/env/private', () => ({
	ORIGIN: 'https://fixture.invalid',
	BETTER_AUTH_SECRET: 'fictional-isolated-runtime-settings-123456789',
	TURSO_DATABASE_URL: 'https://database.fixture.invalid',
	TURSO_AUTH_TOKEN: 'fictional-only'
}));
vi.mock('../auth.js', () => ({ createAuth: vi.fn() }));
vi.mock('../db/index.js', () => ({ createTursoClient: vi.fn(), validateTursoSettings: vi.fn() }));
import { createAuth } from '../auth.js';
import { createTursoClient } from '../db/index.js';
import { withAuth, withPrivateClient } from './runtime.js';

const client = () => ({ close: vi.fn() }) as unknown as Client;
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('Private request client lifetime', () => {
	it('opens an independently configured client and always closes it without auth initialization', async () => {
		const first = client();
		const second = client();
		vi.mocked(createTursoClient).mockReturnValueOnce(first).mockReturnValueOnce(second);
		expect(await withPrivateClient(async (value, origin) => ({ sameClient: value === first, origin }))).toEqual({
			sameClient: true,
			origin: 'https://fixture.invalid'
		});
		await withPrivateClient(async (value) => {
			expect(value).toBe(second);
		});
		expect(first.close).toHaveBeenCalledTimes(1);
		expect(second.close).toHaveBeenCalledTimes(1);
		expect(createAuth).not.toHaveBeenCalled();
	});
	it('retains domain errors and redacts driver errors while closing the client', async () => {
		const current = client();
		vi.mocked(createTursoClient).mockReturnValue(current);
		await expect(withPrivateClient(async () => error(409, 'Fixture revision conflict'))).rejects.toMatchObject({
			status: 409,
			body: { message: 'Fixture revision conflict' }
		});
		await expect(
			withPrivateClient(async () => {
				throw new Error('PRIVATE_DRIVER_MARKER');
			})
		).rejects.toMatchObject({
			status: 503,
			body: { message: 'La connexion privée est temporairement indisponible.' }
		});
		expect(current.close).toHaveBeenCalledTimes(2);
	});
	it('fails closed on unavailable configuration before running the operation', async () => {
		vi.mocked(createTursoClient).mockImplementation(() => {
			throw new Error('PRIVATE_SETTINGS_MARKER');
		});
		const operation = vi.fn();
		await expect(withPrivateClient(operation)).rejects.toMatchObject({
			status: 503,
			body: { message: 'La connexion privée doit être configurée.' }
		});
		expect(operation).not.toHaveBeenCalled();
	});
	it('still initializes authentication exactly once for auth operations and closes on initialization failure', async () => {
		const current = client();
		const auth = {} as Awaited<ReturnType<typeof createAuth>>;
		vi.mocked(createTursoClient).mockReturnValue(current);
		vi.mocked(createAuth).mockResolvedValueOnce(auth).mockRejectedValueOnce(new Error('PRIVATE_AUTH_MARKER'));
		const operation = vi.fn(async () => true);
		expect(await withAuth(operation)).toBe(true);
		expect(operation).toHaveBeenCalledExactlyOnceWith(auth, current, 'https://fixture.invalid');
		await expect(withAuth(operation)).rejects.toMatchObject({
			status: 503,
			body: { message: 'La connexion privée doit être configurée.' }
		});
		expect(operation).toHaveBeenCalledTimes(1);
		expect(current.close).toHaveBeenCalledTimes(2);
	});
	it('reports only an allowlisted failure category and stage, never private error contents', async () => {
		const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
		const current = client();
		vi.mocked(createTursoClient).mockReturnValue(current);
		vi.mocked(createAuth).mockResolvedValue({} as Awaited<ReturnType<typeof createAuth>>);
		const driver = Object.assign(new Error('PRIVATE_DRIVER_MARKER'), { code: 'SQLITE_ERROR' });
		await expect(
			withAuth(async () => {
				throw new Error('PRIVATE_QUERY_MARKER', { cause: driver });
			})
		).rejects.toMatchObject({ status: 503 });
		expect(logger).toHaveBeenCalledExactlyOnceWith(
			JSON.stringify({
				event: 'campus.private.unavailable',
				phase: 'operation',
				reason: 'SQLITE_ERROR'
			})
		);
		expect(JSON.stringify(logger.mock.calls)).not.toContain('PRIVATE_');
		logger.mockClear();
		vi.mocked(createAuth).mockRejectedValue(new Error('PRIVATE_INITIALIZATION_MARKER'));
		await expect(withAuth(async () => true)).rejects.toMatchObject({ status: 503 });
		expect(logger).toHaveBeenCalledExactlyOnceWith(
			JSON.stringify({
				event: 'campus.private.unavailable',
				phase: 'auth-initialization',
				reason: 'UNCLASSIFIED'
			})
		);
		expect(current.close).toHaveBeenCalledTimes(2);
	});
});

it.each([
	[new Error('Too many subrequests. PRIVATE_WORKER_MARKER'), 'WORKER_SUBREQUEST_LIMIT'],
	[
		Object.assign(new Error('PRIVATE_NETWORK_MARKER', { cause: new Error('Too many subrequests.') }), {
			code: 'FETCH_ERROR'
		}),
		'WORKER_SUBREQUEST_LIMIT'
	],
	[new TypeError('PRIVATE_TYPE_MARKER'), 'TYPE_ERROR'],
	[Object.assign(new Error('PRIVATE_MARKER'), { code: 'SQLITE_AUTH' }), 'SQLITE_AUTH'],
	[
		new Error('CAMPUS_RATE_LIMIT_FAILED', {
			cause: Object.assign(new Error('PRIVATE_MARKER'), { code: 'JWT_EXPIRED' })
		}),
		'DATABASE_AUTH'
	],
	[new Error('SQLITE_ERROR: no such table: auth_rate_limit'), 'AUTH_RATE_LIMIT_SCHEMA_MISSING'],
	[new Error('CAMPUS_RATE_LIMIT_FAILED', { cause: new Error('PRIVATE_DRIVER_MARKER') }), 'AUTH_RATE_LIMIT'],
	[Object.assign(new Error('PRIVATE_NETWORK_MARKER'), { code: 'HRANA_CLOSED_ERROR' }), 'HRANA_CLOSED_ERROR'],
	[new APIError('FORBIDDEN', { message: 'PRIVATE_ORIGIN_MARKER' }), 'AUTH_FORBIDDEN'],
	[
		new APIError('INTERNAL_SERVER_ERROR', {
			code: 'FAILED_TO_GET_SESSION',
			message: 'PRIVATE_SESSION_MARKER'
		}),
		'AUTH_SESSION_HANDLER'
	]
])('classifies wrapped auth errors without logging their bodies', async (cause, reason) => {
	const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.mocked(createTursoClient).mockReturnValue(client());
	await expect(
		withPrivateClient(async () => {
			throw cause;
		})
	).rejects.toMatchObject({ status: 503 });
	expect(logger).toHaveBeenCalledExactlyOnceWith(
		JSON.stringify({
			event: 'campus.private.unavailable',
			phase: 'operation',
			reason
		})
	);
	expect(JSON.stringify(logger.mock.calls)).not.toContain('PRIVATE_');
});

it.each([
	'SQLITE_ERROR: no such table: quiz_draft',
	'SQLITE_ERROR: no such table: main.quiz_run',
	'SQLITE_ERROR: SQLite error: no such table: quiz_draft',
	'SQLITE_ERROR: no such column: quiz_run.quiz_revision'
])('identifies missing quiz schema without exposing the query or driver details', async (message) => {
	const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
	const current = client();
	vi.mocked(createTursoClient).mockReturnValue(current);
	const driver = Object.assign(new Error(message), { code: 'SQLITE_ERROR' });
	await expect(
		withPrivateClient(async () => {
			throw new Error('PRIVATE_QUERY_MARKER', { cause: driver });
		})
	).rejects.toMatchObject({
		status: 503,
		body: { message: 'L’espace quiz nécessite une mise à jour de la base de données.' }
	});
	expect(logger).toHaveBeenCalledExactlyOnceWith(
		JSON.stringify({
			event: 'campus.private.unavailable',
			phase: 'operation',
			reason: 'QUIZ_SCHEMA_MISSING'
		})
	);
	expect(current.close).toHaveBeenCalledTimes(1);
});

it.each([
	'SQLITE_ERROR: no such table: private_quiz_draft',
	'SQLITE_ERROR: no such table: quiz_draft_private',
	'SQLITE_ERROR: no such column: student.name',
	'SQLITE_ERROR: no such column: quiz_run.private_field'
])('keeps unrelated SQLite failures generic', async (message) => {
	const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.mocked(createTursoClient).mockReturnValue(client());
	await expect(
		withPrivateClient(async () => {
			throw Object.assign(new Error(message), { code: 'SQLITE_ERROR' });
		})
	).rejects.toMatchObject({
		status: 503,
		body: { message: 'La connexion privée est temporairement indisponible.' }
	});
	expect(JSON.stringify(logger.mock.calls)).not.toContain(message);
});
