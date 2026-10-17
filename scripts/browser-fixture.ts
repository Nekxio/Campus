import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient, type Client } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDatabase } from '../src/lib/server/db/index.js';
import { seedPublicationFixtures } from '../src/lib/server/db/testing/publication-fixtures.js';
import { seedGradingSelectionFixtures } from '../src/lib/server/db/testing/grading-selection-fixtures.js';
import { issueInvitation } from '../src/lib/server/auth/invitations.js';
import {
	getGradeGrid,
	getRubric,
	saveCorrection,
	saveSemesterComment
} from '../src/lib/server/teaching/grading.js';
import { getModule, updateModule } from '../src/lib/server/teaching/service.js';
import { editableModule } from '../src/lib/teaching/types.js';
import {
	copyFixture,
	fixtureEnvironment,
	type CopyManifest
} from '../tests/browser/support/fixture-copy.js';

export type FixtureReady = {
	origin: string;
	manifest: CopyManifest;
	ids: Awaited<ReturnType<typeof seedPublicationFixtures>>;
	invitation: string;
	timings: { copyMs: number; migrateMs: number; seedMs: number; serverReadyMs: number };
};
export type FixtureSessionState = {
	count: number;
	session: {
		id: string;
		userId: string;
		expiresAt: number;
		createdAt: number;
		updatedAt: number;
	} | null;
};
export type FixtureOperation =
	| 'complete-class'
	| 'grading-selection'
	| 'read-independent-rubric'
	| 'conflict-correction'
	| 'conflict-module'
	| 'probe-adapter'
	| 'suspend-server'
	| 'session-state'
	| 'age-session'
	| 'expire-session'
	| 'revoke-session'
	| 'stop';
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
let manifest: CopyManifest | undefined,
	client: Client | undefined,
	server: ChildProcess | undefined;
let cleanupPromise: Promise<void> | undefined;
function stop() {
	cleanupPromise ??= (async () => {
		if (server && server.exitCode === null && server.signalCode === null) {
			const exited = new Promise<void>((done) => server!.once('exit', () => done()));
			server.kill('SIGTERM');
			await Promise.race([exited, delay(5000)]);
			if (server.exitCode === null && server.signalCode === null) {
				server.kill('SIGKILL');
				await exited;
			}
		}
		client?.close();
		if (manifest) await rm(manifest.directory, { recursive: true, force: true });
	})();
	return cleanupPromise;
}
async function main() {
	if (!process.send) throw new Error('Private IPC is required.');
	let stage = performance.now();
	manifest = await copyFixture(sourceRoot, (directory) =>
		process.send!({ type: 'allocated', directory })
	);
	const copyMs = Math.round(performance.now() - stage);
	if (process.argv.includes('--fail-after-copy')) throw new Error('Synthetic startup failure.');
	const reservation = createServer();
	await new Promise<void>((done, reject) => {
		reservation.once('error', reject);
		reservation.listen(0, '127.0.0.1', done);
	});
	const address = reservation.address();
	if (!address || typeof address === 'string') throw new Error('Missing owned port.');
	const port = address.port;
	const origin = `http://localhost:${port}`;
	const url = pathToFileURL(manifest.databasePath).href;
	client = createClient({ url });
	const db = createDatabase(client);
	stage = performance.now();
	await migrate(db, { migrationsFolder: join(manifest.directory, 'drizzle') });
	const migrateMs = Math.round(performance.now() - stage);
	stage = performance.now();
	const ids = await seedPublicationFixtures(db);
	const invitation = await issueInvitation(client, {
		role: 'teacher',
		name: 'Teacher Browser Demo',
		email: 'teacher-browser@example.test'
	});
	const seedMs = Math.round(performance.now() - stage);
	await new Promise<void>((done, reject) =>
		reservation.close((error) => (error ? reject(error) : done()))
	);
	stage = performance.now();
	server = spawn(
		process.execPath,
		[
			join(sourceRoot, 'node_modules/vite/bin/vite.js'),
			'dev',
			'--configLoader',
			'runner',
			'--config',
			'vite.fixture.config.mjs',
			'--host',
			'127.0.0.1',
			'--port',
			String(port),
			'--strictPort'
		],
		{
			cwd: manifest.directory,
			env: fixtureEnvironment({
				ORIGIN: origin,
				BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
				TURSO_DATABASE_URL: url,
				TURSO_AUTH_TOKEN: randomBytes(32).toString('hex'),
				WRANGLER_SEND_METRICS: 'false',
				WRANGLER_LOG_PATH: join(manifest.directory, 'wrangler.log')
			}),
			stdio: ['ignore', 'pipe', 'ignore']
		}
	);
	await new Promise<void>((done, reject) => {
		let startup = '';
		const stdout = server!.stdout!;
		function read(chunk: Buffer) {
			startup = stripVTControlCharacters(startup + chunk.toString()).slice(-2048);
			if (!startup.includes(`http://127.0.0.1:${port}`)) return;
			stdout.off('data', read);
			stdout.resume();
			done();
		}
		stdout.on('data', read);
		server!.once('error', () => reject(new Error('Fixture server failed.')));
		server!.once('exit', () => reject(new Error('Fixture server exited.')));
	});
	let ready = false;
	for (let attempt = 0; attempt < 150; attempt++) {
		if (server.exitCode !== null) throw new Error('Fixture server exited.');
		try {
			ready = (await fetch(origin + '/connexion')).ok;
		} catch {
			/* Startup has not bound yet. */
		}
		if (ready) break;
		await delay(200);
	}
	if (!ready) throw new Error('Fixture server did not start.');
	const timings = {
		copyMs,
		migrateMs,
		seedMs,
		serverReadyMs: Math.round(performance.now() - stage)
	};
	process.send({
		type: 'ready',
		value: { origin, manifest, ids, invitation: invitation.token, timings } satisfies FixtureReady
	});
	process.on('message', async (message: { id: number; operation: FixtureOperation }) => {
		try {
			if (message.operation === 'stop') {
				await stop();
				process.send!({ id: message.id, value: true });
				process.disconnect();
				return;
			}
			let value: unknown = true;
			if (
				['session-state', 'age-session', 'expire-session', 'revoke-session'].includes(
					message.operation
				)
			) {
				const readSessions = async () =>
					(
						await client!.execute(
							'SELECT id, user_id, expires_at, created_at, updated_at FROM session ORDER BY id'
						)
					).rows;
				const rows = await readSessions();
				if (message.operation !== 'session-state') {
					if (rows.length !== 1) throw new Error('Ambiguous fictional session.');
					const id = String(rows[0].id);
					if (message.operation === 'revoke-session') {
						await client!.execute({ sql: 'DELETE FROM session WHERE id = ?', args: [id] });
					} else {
						const now = Date.now();
						const startedAt = now - 60 * 60 * 1000 - 1000;
						await client!.execute({
							sql: 'UPDATE session SET created_at = ?, updated_at = ?, expires_at = ? WHERE id = ?',
							args: [
								startedAt,
								startedAt,
								message.operation === 'expire-session'
									? now - 1000
									: startedAt + 8 * 60 * 60 * 1000,
								id
							]
						});
					}
				}
				const current = await readSessions();
				if (current.length > 1) throw new Error('Ambiguous fictional session.');
				const row = current[0];
				value = {
					count: current.length,
					session: row
						? {
								id: String(row.id),
								userId: String(row.user_id),
								expiresAt: Number(row.expires_at),
								createdAt: Number(row.created_at),
								updatedAt: Number(row.updated_at)
							}
						: null
				} satisfies FixtureSessionState;
			} else if (message.operation === 'suspend-server') {
				if (!server?.pid || !server.kill('SIGSTOP')) throw new Error('Owned server unavailable.');
				value = server.pid;
			} else if (message.operation === 'probe-adapter') {
				const adapter = await import(
					pathToFileURL(join(manifest!.directory, 'src/lib/server/db/index.ts')).href
				);
				let refused = false;
				try {
					adapter.validateTursoSettings('https://example.test', 'synthetic');
				} catch {
					refused = true;
				}
				value = refused;
			} else if (message.operation === 'grading-selection') {
				value = await seedGradingSelectionFixtures(db, ids.module);
			} else if (message.operation === 'read-independent-rubric') {
				value = await getRubric(db, ids.secondModule);
			} else if (message.operation === 'conflict-module') {
				const module = await getModule(db, ids.module);
				await updateModule(db, ids.module, {
					...editableModule(module),
					expectedRevision: module.revision
				});
			} else {
				const grid = await getGradeGrid(db, ids.module, ids.currentContext);
				for (const student of message.operation === 'conflict-correction'
					? grid.students.slice(0, 1)
					: grid.students) {
					for (const assessment of grid.rubric!.assessments) {
						if (message.operation === 'conflict-correction' && assessment.id !== ids.project)
							continue;
						const current = student.corrections.find(
							(record) => record.assessmentId === assessment.id
						);
						await saveCorrection(db, ids.currentContext, student.id, assessment.id, {
							expectedRevision: current?.revision ?? 0,
							rubricRevision: grid.rubric!.module.revision,
							status: 'graded',
							submissionUrl: 'https://example.test/private-submission-marker',
							submittedAt: '2026-10-09T12:00:00Z',
							latenessDecision: 'automatic',
							scores: assessment.lines.map((line) => ({ lineId: line.id, points: line.maxPoints }))
						});
					}
					if (message.operation === 'complete-class')
						await saveSemesterComment(db, ids.currentContext, student.id, {
							expectedRevision: student.comment.revision,
							content: 'PRIVATE_BROWSER_COMMENT_MARKER'
						});
				}
				value = {
					names: grid.students.map((student) => student.name),
					results: grid.rubric!.results.map((result) => result.title)
				};
			}
			process.send!({ id: message.id, value });
		} catch {
			process.send!({ id: message.id, error: 'Fictional fixture operation failed.' });
		}
	});
}
process.on('disconnect', () => {
	void stop().then(() => process.exit(0));
});
process.on('SIGTERM', () => {
	void stop().then(() => process.exit(0));
});
main().catch(async () => {
	const directory = manifest?.directory;
	await stop();
	process.send?.({ type: 'failed', directory, error: 'Fictional fixture startup failed.' });
	process.exitCode = 1;
	process.disconnect?.();
});
