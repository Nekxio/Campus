import { POST as classPost } from '../../routes/api/agent/classes/+server.js';
import { GET as rosterGet, POST as rosterPost } from '../../routes/api/agent/roster/+server.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type Client as SqlClient } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, open, readFile, writeFile, rm, symlink, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import {
	listenLoopbackFixture,
	type LoopbackFixture,
	type FixtureChildEnvironment
} from '../../../scripts/test-loopback.mjs';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createDatabase, type Database } from '../server/db/index.js';
import { seedFoundationFixtures } from '../server/db/testing/fixtures.js';
import { createAuth, type Auth } from '../server/auth.js';
import { issueAgentKey, revokeAgentKey } from '../server/agent/keys.js';
import { sampleLocalModule } from '../server/agent/testing/fixtures.js';
import { getModule } from '../server/teaching/service.js';
import { agentConnectionSchema, agentClient, type AgentConnection } from '../../../scripts/mcp/client.js';
import { moduleOperations } from '../../../scripts/mcp/operations.js';
import { readBinding, withFolderLock, allowedFolder } from '../../../scripts/mcp/folders.js';
import { localModuleSchema } from '../domain/local-module.js';
vi.mock('../server/auth/runtime.js', () => ({ withAuth: vi.fn() }));
import { withAuth } from '../server/auth/runtime.js';
import { GET } from '../../routes/api/agent/context/+server.js';
import { POST } from '../../routes/api/agent/modules/+server.js';
import { GET as correctionContextGet } from '../../routes/api/agent/correction-context/+server.js';
import { POST as proposalPost } from '../../routes/api/agent/proposals/+server.js';
import { correctionContextSchema } from '../domain/proposals.js';
import { getGradeGrid } from '../server/teaching/grading.js';
import { correctionProposals, assessments, rubricGroups, rubricLines } from '../server/db/schema.js';
import { quizContextSchema } from '../domain/quiz-agent.js';
import { GET as quizContextGet } from '../../routes/api/agent/quizzes/context/+server.js';
import { POST as quizPost } from '../../routes/api/agent/quizzes/+server.js';
import { PATCH as quizPatch } from '../../routes/api/agent/quizzes/[quizId]/+server.js';
import { PATCH } from '../../routes/api/agent/modules/[moduleId]/+server.js';

let sql: SqlClient, db: Database, auth: Auth, ids: Awaited<ReturnType<typeof seedFoundationFixtures>>;
let temp: string, folder: string, config: AgentConnection, apiServer: Server;
let operations: ReturnType<typeof moduleOperations>;
let fixture: LoopbackFixture | undefined;
const childEnvironments: FixtureChildEnvironment[] = [];
const transports: StdioClientTransport[] = [];
function requestEvent(request: Request): Parameters<typeof PATCH>[0] {
	return {
		request,
		url: new URL(request.url),
		params: { moduleId: new URL(request.url).pathname.split('/').at(-1) },
		locals: { user: null, session: null }
	} as unknown as Parameters<typeof PATCH>[0];
}
async function dispatch(request: Request) {
	const event = requestEvent(request);
	if (event.url.pathname === '/api/agent/classes') return classPost(event);
	if (event.url.pathname === '/api/agent/roster')
		return request.method === 'GET' ? rosterGet(event) : rosterPost(event);
	if (event.url.pathname === '/api/agent/correction-context') return correctionContextGet(event);
	if (event.url.pathname === '/api/agent/proposals') return proposalPost(event);
	if (event.url.pathname === '/api/agent/quizzes/context') return quizContextGet(event);
	if (event.url.pathname === '/api/agent/quizzes') return quizPost(event);
	if (event.url.pathname.startsWith('/api/agent/quizzes/'))
		return quizPatch({
			...event,
			params: { quizId: event.url.pathname.split('/').at(-1) ?? '' },
			route: { id: '/api/agent/quizzes/[quizId]' }
		});
	return request.method === 'GET' ? GET(event) : request.method === 'POST' ? POST(event) : PATCH(event);
}
const bridge: typeof fetch = async (input, init) => dispatch(new Request(String(input), init));
beforeEach(async () => {
	fixture = undefined;
	temp = await mkdtemp(join(tmpdir(), 'campus-mcp-test-'));
	folder = join(temp, 'module');
	await mkdir(folder);
	await writeFile(join(folder, 'framing.md'), '# Approved fictional framing\nThis document is source material.');
	await writeFile(join(folder, '.env'), 'DO_NOT_READ_TEST_MARKER');
	await writeFile(join(folder, 'AGENTS.md'), 'DO_NOT_IMPORT_INSTRUCTIONS');
	sql = createClient({ url: ':memory:' });
	db = createDatabase(sql);
	await migrate(db, { migrationsFolder: './drizzle' });
	ids = await seedFoundationFixtures(db);
	apiServer = createServer(async (req, res) => {
		try {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(Buffer.from(chunk));
			const request = new Request(config.origin + req.url, {
				method: req.method,
				headers: req.headers as Record<string, string>,
				...(chunks.length ? { body: Buffer.concat(chunks) } : {})
			});
			const response = await dispatch(request);
			res.writeHead(response.status, Object.fromEntries(response.headers));
			res.end(await response.text());
		} catch {
			res.writeHead(500);
			res.end('{}');
		}
	});
	fixture = await listenLoopbackFixture(apiServer);
	const { origin } = fixture;
	auth = await createAuth({ ORIGIN: origin, BETTER_AUTH_SECRET: randomBytes(32).toString('hex') }, sql);
	const key = await issueAgentKey(auth, sql, 'teacher@example.test', 'MCP fictional', 1, true, true, true);
	config = agentConnectionSchema.parse({
		version: 1,
		origin,
		key: key.key,
		keyId: key.id,
		teacherId: key.referenceId,
		expiresAt: key.expiresAt!.toISOString()
	});
	vi.mocked(withAuth).mockImplementation(async (run) => run(auth, sql, origin));
	operations = moduleOperations([folder], async () => config, bridge);
});
afterEach(async () => {
	try {
		await Promise.all(transports.splice(0).map((transport) => transport.close()));
	} finally {
		try {
			for (const environment of childEnvironments.splice(0)) environment.close();
			await fixture?.close();
		} finally {
			sql?.close();
			if (temp) await rm(temp, { recursive: true, force: true });
			vi.restoreAllMocks();
		}
	}
});

async function connectTransport(client: Client, transport: StdioClientTransport) {
	let stderr = '';
	const capture = (chunk: Buffer) => {
		stderr += chunk.toString();
	};
	transport.stderr?.on('data', capture);
	try {
		await client.connect(transport);
	} catch (error) {
		// Report only error codes and stack function names, never env/capability/key values.
		const codes = stderr.match(/CAMPUS_TEST_[A-Z_]+|ERR_[A-Z0-9_]+|\bat [\w.<>]+/g) ?? [];
		throw new Error(`Fictional MCP startup failed: ${[...new Set(codes)].join(', ') || 'unclassified stderr'}`, {
			cause: error
		});
	} finally {
		transport.stderr?.removeListener('data', capture);
	}
}

function transportEnvironment(values: Record<string, string>) {
	if (!fixture) throw new Error('Missing fictional API fixture');
	const environment = fixture.childEnvironment(process.env, values);
	childEnvironments.push(environment);
	return environment.env;
}

describe('Local folder import workflow', () => {
	it('lists documents without reading sources, hidden secrets or instruction files', async () => {
		const inspected = await operations.inspect(folder);
		expect(inspected.documents).toEqual([{ path: 'framing.md', kind: 'md' }]);
		expect(JSON.stringify(inspected)).not.toContain('DO_NOT_READ_TEST_MARKER');
		expect(JSON.stringify(inspected)).not.toContain('This document is source material.');
		expect(inspected.binding).toBeNull();
	});
	it('rejects outside roots and symlink escapes, including unsafe binding files', async () => {
		const outside = join(temp, 'module-other');
		await mkdir(outside);
		await expect(allowedFolder(outside, [folder])).rejects.toThrow('outside');
		await symlink(outside, join(folder, 'escape'));
		await expect(allowedFolder(join(folder, 'escape'), [folder])).rejects.toThrow('outside');
		await writeFile(join(outside, 'binding.json'), '{}');
		await symlink(join(outside, 'binding.json'), join(folder, '.coursely.json'));
		await expect(operations.inspect(folder)).rejects.toThrow('unsafe');
		expect(await readFile(join(outside, 'binding.json'), 'utf8')).toBe('{}');
	});
	it('persists a retry key before sending and recovers a lost response without duplicating the module', async () => {
		let first = true;
		const unreliable: typeof fetch = async (input, init) => {
			const response = await bridge(input, init);
			if (first) {
				first = false;
				throw new Error('network lost after commit');
			}
			return response;
		};
		const ops = moduleOperations([folder], async () => config, unreliable);
		const draft = sampleLocalModule(ids.currentClass);
		await expect(ops.import('create', folder, draft)).rejects.toThrow('network');
		const pending = await readBinding(folder);
		expect(pending?.linked).toBe(false);
		const saved = await ops.import('create', folder, draft);
		expect(saved.requestId).toBe(pending?.lastOperation?.requestId);
		expect((await getModule(db, saved.moduleId)).resources[0].id).toBe(pending?.ids.resources.slides);
		expect((await operations.context(folder)).modules).toHaveLength(3);
		expect((await stat(join(folder, '.coursely.json'))).mode & 0o777).toBe(0o600);
		expect(await readFile(join(folder, '.coursely.json'), 'utf8')).not.toContain(config.key);
	});
	it('keeps identities when labels change and replays an update safely', async () => {
		const draft = sampleLocalModule(ids.currentClass);
		const created = await operations.import('create', folder, draft);
		const binding = await readBinding(folder),
			remote = await operations.context(folder);
		draft.title = 'Renamed module';
		draft.resources[0].label = 'Renamed slides';
		draft.rubric!.assessments[0].lines[0].label = 'Renamed criterion';
		draft.contexts[0].expectedRevision = remote.module!.contexts[0].expectedRevision;
		const updated = await operations.import('update', folder, draft, created.revision, true);
		expect(await operations.import('update', folder, draft, created.revision, true)).toEqual(updated);
		expect((await readBinding(folder))?.ids).toEqual(binding?.ids);
		expect((await getModule(db, updated.moduleId)).title).toBe('Renamed module');
		await expect(
			operations.import('update', folder, { ...draft, title: 'Distinct stale update' }, created.revision, true)
		).rejects.toMatchObject({ status: 409 });
		expect((await getModule(db, updated.moduleId)).revision).toBe(updated.revision);
	});
	it('requires explicit binding for a manual module and checks exact module identities', async () => {
		const remote = await operations.context(folder, ids.secondModule);
		const mappings = {
			resources: {},
			contexts: { [ids.currentClass]: ids.secondContext },
			lessons: {},
			assessments: {},
			groups: {},
			lines: {},
			results: {}
		};
		await expect(
			operations.bind(folder, ids.secondModule, {
				...mappings,
				resources: { slides: ids.resource }
			})
		).rejects.toThrow('exact module');
		expect(await readBinding(folder)).toBeNull();
		await operations.bind(folder, ids.secondModule, mappings);
		expect((await readBinding(folder))?.revision).toBe(remote.module?.revision);
		await expect(operations.bind(folder, ids.module, mappings)).rejects.toThrow('existing module');
	});
	it('refuses invalid keys or ambiguous duplicate entities before creating a binding or sending', async () => {
		const fetcher = vi.fn(bridge);
		const ops = moduleOperations([folder], async () => config, fetcher);
		const draft = sampleLocalModule(ids.currentClass);
		draft.resources.push({ ...draft.resources[0] });
		await expect(ops.import('create', folder, draft)).rejects.toThrow();
		expect(fetcher).not.toHaveBeenCalled();
		expect(await readBinding(folder)).toBeNull();
		expect(
			localModuleSchema.safeParse({
				...draft,
				resources: [{ ...draft.resources[0], key: '__proto__' }]
			}).success
		).toBe(false);
	});
	it('never sends the private key to the origin in a tampered binding', async () => {
		await operations.import('create', folder, sampleLocalModule(ids.currentClass));
		const binding = await readBinding(folder);
		binding!.origin = 'https://hostile.example.test';
		await writeFile(join(folder, '.coursely.json'), JSON.stringify(binding));
		const fetcher = vi.fn(bridge),
			ops = moduleOperations([folder], async () => config, fetcher);
		await expect(ops.context(folder)).rejects.toThrow('another Campus origin');
		expect(fetcher).not.toHaveBeenCalled();
	});
	it('preserves a folder lock while its owner has not written its PID yet', async () => {
		const path = join(folder, '.coursely.lock');
		const owner = await open(path, 'wx', 0o600);
		const operation = vi.fn(async () => true);
		try {
			const original = await owner.stat();
			await expect(withFolderLock(folder, operation)).rejects.toThrow('Retry shortly');
			expect(operation).not.toHaveBeenCalled();
			expect((await stat(path)).ino).toBe(original.ino);
			expect(await readFile(path, 'utf8')).toBe('');
			await owner.writeFile(String(process.pid));
			await expect(withFolderLock(folder, operation)).rejects.toThrow('Another import');
			expect(operation).not.toHaveBeenCalled();
			expect(await readFile(path, 'utf8')).toBe(String(process.pid));
		} finally {
			await owner.close();
		}
	});
	it('serializes imports and releases the folder lock after an operation fails', async () => {
		let release!: () => void;
		const first = withFolderLock(
			folder,
			() =>
				new Promise<void>((done) => {
					release = done;
				})
		);
		while (!release) await new Promise((done) => setTimeout(done, 1));
		await expect(withFolderLock(folder, async () => true)).rejects.toThrow('Another import');
		release();
		await first;
		await expect(
			withFolderLock(folder, async () => {
				throw new Error('fictional failure');
			})
		).rejects.toThrow('fictional failure');
		expect(await withFolderLock(folder, async () => true)).toBe(true);
	});
	it('redacts error echoes and refuses remote HTTP or expired client configuration', async () => {
		expect(agentConnectionSchema.safeParse({ ...config, origin: 'http://hostile.example.test' }).success).toBe(false);
		await expect(agentClient({ ...config, expiresAt: new Date(0).toISOString() }, bridge).context()).rejects.toThrow(
			'expired'
		);
		const hostile: typeof fetch = async () => new Response(JSON.stringify({ message: config.key }), { status: 401 });
		await expect(agentClient(config, hostile).context()).rejects.toThrow('[redacted]');
	});
	it('starts through the registered pnpm command and inspects without a connection file', async () => {
		const transport = new StdioClientTransport({
			command: 'pnpm',
			args: ['--dir', process.cwd(), 'exec', 'tsx', 'scripts/campus-mcp.ts'],
			cwd: process.cwd(),
			env: transportEnvironment({
				CAMPUS_MODULE_ROOTS: folder,
				CAMPUS_AGENT_CONFIG_FILE: join(temp, 'not-configured.json')
			}),
			stderr: 'pipe'
		});
		transports.push(transport);
		const client = new Client({ name: 'campus-no-key-test', version: '1.0.0' });
		await connectTransport(client, transport);
		const inspected = await client.callTool({
			name: 'inspect_module_folder',
			arguments: { folder }
		});
		expect(inspected.isError).not.toBe(true);
		const unavailable = await client.callTool({
			name: 'get_import_context',
			arguments: { folder }
		});
		expect(unavailable.isError).toBe(true);
		expect(JSON.stringify(unavailable.content)).toContain('Agent setup is required');
		await client.close();
	}, 20000);
	it('runs authoring and proposal tools over real stdio and HTTP, preserving private drafts and scores', async () => {
		const privateFile = join(temp, 'agent-test.json');
		await writeFile(privateFile, JSON.stringify(config), { mode: 0o600 });
		const require = createRequire(import.meta.url);
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [resolve(require.resolve('tsx/package.json'), '../dist/cli.mjs'), resolve('scripts/campus-mcp.ts')],
			cwd: process.cwd(),
			env: transportEnvironment({
				CAMPUS_MODULE_ROOTS: folder,
				CAMPUS_AGENT_CONFIG_FILE: privateFile
			}),
			stderr: 'pipe'
		});
		transports.push(transport);
		const client = new Client({ name: 'campus-fictional-test', version: '1.0.0' });
		await connectTransport(client, transport);
		const listed = await client.listTools();
		expect(listed.tools.map((t) => t.name)).toEqual([
			'patch_module_draft',
			'inspect_module_folder',
			'get_import_context',
			'bind_module_folder',
			'create_module_draft',
			'update_module_draft',
			'get_correction_context',
			'propose_correction',
			'get_quiz_context',
			'create_quiz_draft',
			'patch_quiz_draft',
			'get_class_roster',
			'create_class',
			'add_class_students'
		]);
		const newClass = crypto.randomUUID();
		const classInput = { id: newClass, name: 'Stdio Roster Demo', academicYear: '2026-2027' };
		expect((await client.callTool({ name: 'create_class', arguments: classInput })).isError).not.toBe(true);
		expect((await client.callTool({ name: 'create_class', arguments: classInput })).isError).not.toBe(true);
		const add = {
			classId: newClass,
			expectedRevision: 1,
			students: [{ id: crypto.randomUUID(), name: 'Stdio Student Demo' }]
		};
		const added = await client.callTool({ name: 'add_class_students', arguments: add });
		expect(added.isError).not.toBe(true);
		expect((await client.callTool({ name: 'add_class_students', arguments: add })).structuredContent).toEqual(
			added.structuredContent
		);
		const roster = await client.callTool({
			name: 'get_class_roster',
			arguments: { classId: newClass }
		});
		expect(roster.structuredContent).toMatchObject({
			revision: 2,
			students: [{ name: 'Stdio Student Demo' }]
		});
		const inspected = await client.callTool({
			name: 'inspect_module_folder',
			arguments: { folder }
		});
		expect(inspected.isError).not.toBe(true);
		const draft = sampleLocalModule(ids.currentClass);
		const created = await client.callTool({
			name: 'create_module_draft',
			arguments: { folder, draft }
		});
		expect(created.isError, JSON.stringify(created.content)).not.toBe(true);
		const receipt = created.structuredContent as { moduleId: string; revision: number };
		const remote = await operations.context(folder);
		draft.contexts[0].expectedRevision = remote.module!.contexts[0].expectedRevision;
		draft.title = 'Updated through stdio';
		delete draft.rubric;
		const updated = await client.callTool({
			name: 'update_module_draft',
			arguments: { folder, draft, expectedRevision: receipt.revision }
		});
		expect(updated.isError, JSON.stringify(updated.content)).not.toBe(true);
		expect((await getModule(db, receipt.moduleId)).title).toBe('Updated through stdio');
		const beforePatch = await operations.context(folder);
		const patchArguments = {
			folder,
			expectedRevision: beforePatch.module!.revision,
			patch: { preparation: { nextSteps: 'Targeted stdio edit' } }
		};
		const patched = await client.callTool({
			name: 'patch_module_draft',
			arguments: patchArguments
		});
		expect(patched.isError, JSON.stringify(patched.content)).not.toBe(true);
		const patchedModule = await getModule(db, receipt.moduleId);
		expect(patchedModule.resources).toEqual(beforePatch.module!.resources);
		expect(patchedModule.preparation.framing).toEqual(beforePatch.module!.preparation.framing);
		expect(
			(await client.callTool({ name: 'patch_module_draft', arguments: patchArguments })).structuredContent
		).toEqual(patched.structuredContent);
		const contextId = remote.module!.contexts[0].id;
		const read = await client.callTool({
			name: 'get_correction_context',
			arguments: { folder, contextId, studentId: ids.students[0] }
		});
		expect(read.isError, JSON.stringify(read.content)).not.toBe(true);
		const correction = correctionContextSchema.parse(read.structuredContent);
		const proposal = {
			requestId: crypto.randomUUID(),
			proposalId: crypto.randomUUID(),
			payload: {
				version: 2 as const,
				moduleId: receipt.moduleId,
				contextId,
				studentId: ids.students[0],
				assessmentId: correction.assessments[0].id,
				rubricRevision: correction.rubricRevision,
				contextRevision: correction.contextRevision,
				correctionRevision: 0,
				scores: [{ lineId: correction.assessments[0].lines[0].id, points: 8 }],
				semesterComment: 'Fictional proposal only',
				commentRevision: 0
			}
		};
		const submitted = await client.callTool({
			name: 'propose_correction',
			arguments: { folder, proposal }
		});
		expect(submitted.isError, JSON.stringify(submitted.content)).not.toBe(true);
		const retry = await client.callTool({
			name: 'propose_correction',
			arguments: { folder, proposal }
		});
		expect(retry.structuredContent).toEqual(submitted.structuredContent);
		expect((await db.select().from(correctionProposals)).filter((p) => p.id === proposal.proposalId)).toHaveLength(1);
		const grid = await getGradeGrid(db, receipt.moduleId, contextId);
		expect(grid.students[0].corrections).toEqual([]);
		expect(grid.students[0].comment.content).toBe('');
		const assessmentId = crypto.randomUUID(),
			groupId = crypto.randomUUID(),
			lineId = crypto.randomUUID(),
			optionId = crypto.randomUUID();
		await db.insert(assessments).values({
			id: assessmentId,
			moduleId: receipt.moduleId,
			title: 'Native quizzes',
			kind: 'quiz'
		});
		await db.insert(rubricGroups).values({ id: groupId, assessmentId, title: 'Quizzes' });
		await db.insert(rubricLines).values({ id: lineId, assessmentId, groupId, label: 'Native quiz', maxPoints: 1 });
		const quizDraft = {
			id: crypto.randomUUID(),
			requestId: crypto.randomUUID(),
			moduleId: receipt.moduleId,
			contextId,
			lessonId: remote.module!.contexts[0].lessons[0].id,
			assessmentId,
			lineId,
			expectedRevision: 0,
			content: {
				version: 1,
				title: 'Fictional native quiz',
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
		const quizCreated = await client.callTool({
			name: 'create_quiz_draft',
			arguments: { folder, draft: quizDraft }
		});
		expect(quizCreated.isError, JSON.stringify(quizCreated.content)).not.toBe(true);
		const quizCommand = {
			moduleId: receipt.moduleId,
			id: quizDraft.id,
			requestId: crypto.randomUUID(),
			expectedRevision: 1,
			patch: {
				questions: [{ id: quizDraft.content.questions[0].id, options: [{ id: optionId, text: 'Two' }] }]
			}
		};
		const quizPatched = await client.callTool({
			name: 'patch_quiz_draft',
			arguments: { folder, command: quizCommand }
		});
		expect(quizPatched.isError, JSON.stringify(quizPatched.content)).not.toBe(true);
		expect(
			(
				await client.callTool({
					name: 'patch_quiz_draft',
					arguments: { folder, command: quizCommand }
				})
			).structuredContent
		).toEqual(quizPatched.structuredContent);
		expect(
			(
				await client.callTool({
					name: 'create_quiz_draft',
					arguments: { folder, draft: quizDraft }
				})
			).structuredContent
		).toEqual(quizCreated.structuredContent);
		const quizRead = await client.callTool({
			name: 'get_quiz_context',
			arguments: { folder, contextId, quizId: quizDraft.id }
		});
		expect(quizRead.isError, JSON.stringify(quizRead.content)).not.toBe(true);
		const nativeContext = quizContextSchema.parse(quizRead.structuredContent);
		expect(nativeContext.quiz).toMatchObject({
			revision: 2,
			needsReview: true,
			content: {
				questions: [
					expect.objectContaining({
						code: '1 + 1',
						options: [{ id: optionId, text: 'Two' }, quizDraft.content.questions[0].options[1]]
					})
				]
			}
		});
		expect(JSON.stringify(nativeContext)).not.toContain('Student Demo');
		const bindingSource = await readFile(join(folder, '.coursely.json'), 'utf8');
		expect(bindingSource).not.toContain(ids.students[0]);
		expect(bindingSource).not.toContain('Fictional proposal only');
		expect(bindingSource).not.toContain('Fictional native quiz');
		await revokeAgentKey(sql, 'teacher@example.test', config.keyId);
		const refused = await client.callTool({ name: 'get_import_context', arguments: { folder } });
		expect(refused.isError).toBe(true);
		expect(JSON.stringify(refused)).not.toContain(config.key);
		await client.close();
	}, 20000);
});
