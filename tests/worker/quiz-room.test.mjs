import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const wrangler = createRequire(require.resolve('wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions } = wrangler('miniflare');
const { build } = wrangler('esbuild');
const sessionId = crypto.randomUUID();
const participantId = crypto.randomUUID();
const questionId = crypto.randomUUID();
const correctOptionId = crypto.randomUUID();
const incorrectOptionId = crypto.randomUUID();
const actor = {
	kind: 'participant',
	participantId,
	credentialHash: 'a'.repeat(64),
	connectionId: crypto.randomUUID()
};
const teacher = { kind: 'teacher' };
const input = {
	id: sessionId,
	shuffleSeed: 'fictional-shuffle-seed',
	createdAt: Date.now(),
	roster: [{ id: participantId, name: 'Fictional Student' }],
	content: {
		version: 1,
		title: 'Control flow',
		durationSeconds: 60,
		questions: [
			{
				id: questionId,
				type: 'single',
				prompt: 'What does this code print?',
				code: 'console.log(1 + 1);',
				codeLanguage: 'typescript',
				options: [
					{ id: correctOptionId, text: '2' },
					{ id: incorrectOptionId, text: '11' }
				],
				correctOptionIds: [correctOptionId]
			}
		]
	}
};

const createRoomRuntime = async (persistDirectory) => {
	const bundled = await build({
		stdin: {
			contents: `
import { QuizRoom as BaseRoom } from './src/lib/server/quizzes/room.ts';
import { WorkerEntrypoint } from 'cloudflare:workers';
export class QuizRoom extends BaseRoom { async socketsForTest() { return this.ctx.getWebSockets().map(s => ({ready:s.readyState, connectionId:s.deserializeAttachment()?.actor.connectionId})); } }
export class QuizAuthorization extends WorkerEntrypoint {
	async canReadTeacher(identity) {
		return identity.teacherId === 'fictional-teacher' && identity.sessionId === 'fictional-session' && identity.runId === '${sessionId}';
	}
}
export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const room = env.QUIZ_ROOMS.getByName(url.searchParams.get('id') ?? '${sessionId}');
		const action = url.pathname.slice(1);
		if (action === 'socket') return room.fetch(request);
		if (action === 'sockets-for-test') return Response.json(await room.socketsForTest());
		try {
			const body = await request.json();
			if (action === 'rpc') return Response.json(await room.rpc(body));
			if (action === 'initialize') return Response.json(await room.initialize(body));
			if (action === 'command') return Response.json(await room.command(body.actor, body.command));
			if (action === 'participant') return Response.json(await room.participantState(body));
			if (action === 'teacher') return Response.json(await room.teacherState());
			if (action === 'retake') return Response.json(await room.createRetake(body));
			if (action === 'purge') { await room.purge(); return Response.json({ purged: true }); }
			return new Response(null, { status: 404 });
		} catch (cause) {
			return Response.json({ message: cause.message }, { status: 422 });
		}
	}
};`,
			resolveDir: process.cwd()
		},
		bundle: true,
		write: false,
		format: 'esm',
		platform: 'browser',
		external: ['cloudflare:workers']
	});
	return new Miniflare({
		...convertV4MiniflareOptions({
			name: 'quiz-room-test',
			modules: true,
			compatibilityDate: '2026-10-11',
			compatibilityFlags: ['nodejs_compat'],
			cf: false,
			script: bundled.outputFiles[0].text,
			durableObjects: { QUIZ_ROOMS: { className: 'QuizRoom', useSQLite: true } },
			outboundService: () => {
				throw new Error('Quiz runtime must not contact an external service.');
			}
		}),
		resourcePersistencePath: persistDirectory
	});
};

const callRoom = async (runtime, action, body) => {
	const response = await runtime.dispatchFetch(`http://localhost/${action}`, {
		method: 'POST',
		body: JSON.stringify(body)
	});
	assert.equal(response.status, 200, await response.clone().text());
	return response.json();
};

const issue = (runtime, issuingActor, command) =>
	callRoom(runtime, 'command', {
		actor: issuingActor,
		command: { requestId: crypto.randomUUID(), ...command }
	});

const nextMessage = (socket, matches = () => true) =>
	new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			socket.removeEventListener('message', listener);
			reject(new Error('Timed out waiting for a quiz WebSocket message.'));
		}, 5000);
		const listener = (event) => {
			const message = JSON.parse(event.data);
			if (!matches(message)) return;
			clearTimeout(timeout);
			socket.removeEventListener('message', listener);
			resolve(message);
		};
		socket.addEventListener('message', listener);
	});

const openSocket = async (runtime, issuingActor) => {
	const response = await runtime.dispatchFetch('http://localhost/socket', {
		headers: {
			Upgrade: 'websocket',
			'x-campus-quiz-actor': JSON.stringify(issuingActor),
			...(issuingActor.kind === 'teacher'
				? {
						'x-campus-quiz-teacher': JSON.stringify({
							teacherId: 'fictional-teacher',
							sessionId: 'fictional-session'
						})
					}
				: {}),
			'x-campus-quiz-issued-at': String(Date.now()),
			'x-campus-quiz-expires-at': String(Date.now() + 60_000)
		}
	});
	assert.equal(response.status, 101);
	const socket = response.webSocket;
	assert.ok(socket);
	const message = nextMessage(socket);
	socket.accept();
	const initial = await message;
	assert.equal(initial.type, 'state');
	assert.doesNotMatch(JSON.stringify(initial), /correctOptionIds|credentialHash/);
	return socket;
};

test('quiz RPC preserves safe business error codes across the Worker boundary', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'campus-quiz-rpc-'));
	const runtime = await createRoomRuntime(directory);
	try {
		assert.deepEqual(await callRoom(runtime, 'rpc', { method: 'teacherState' }), {
			ok: false,
			error: {
				kind: 'room',
				code: 'quiz_room_not_initialized',
				message: 'quiz_room_not_initialized'
			}
		});
		const invalid = await callRoom(runtime, 'rpc', { method: 'teacherState', privateState: true });
		assert.equal(invalid.ok, false);
		assert.equal(invalid.error.kind, 'invalid_input');
		assert.equal(invalid.error.code, 'invalid_input');
		const initialized = await callRoom(runtime, 'rpc', { method: 'initialize', input });
		assert.equal(initialized.ok, true);
		assert.equal(initialized.method, 'initialize');
		assert.equal(initialized.value.status, 'lobby');
		const started = await callRoom(runtime, 'rpc', {
			method: 'command',
			actor: teacher,
			command: { type: 'start', requestId: crypto.randomUUID() }
		});
		assert.equal(started.ok, true);
		assert.equal(started.value.view.status, 'running');
		const rejected = await callRoom(runtime, 'rpc', {
			method: 'command',
			actor: teacher,
			command: { type: 'start', requestId: crypto.randomUUID() }
		});
		assert.equal(rejected.ok, false);
		assert.equal(rejected.error.kind, 'domain');
		assert.equal(rejected.error.code, 'invalid_state');
		assert.equal(typeof rejected.error.message, 'string');
		assert.deepEqual(Object.keys(rejected.error).sort(), ['code', 'kind', 'message']);
	} finally {
		await runtime.dispose();
	}
});

test('HTTP admission and a rejected handshake never advertise a connected student', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'campus-quiz-presence-'));
	const runtime = await createRoomRuntime(directory);
	try {
		await callRoom(runtime, 'initialize', input);
		await issue(runtime, actor, { type: 'join' });
		assert.equal((await callRoom(runtime, 'teacher', {})).participants[0].connected, false);
		const refused = await runtime.dispatchFetch('http://localhost/socket', {
			headers: {
				Upgrade: 'websocket',
				'x-campus-quiz-actor': JSON.stringify(actor),
				'x-campus-quiz-issued-at': String(Date.now()),
				'x-campus-quiz-expires-at': String(Date.now() - 1000)
			}
		});
		assert.equal(refused.status, 403);
		assert.equal((await callRoom(runtime, 'teacher', {})).participants[0].connected, false);
		const socket = await openSocket(runtime, { ...actor, connectionId: crypto.randomUUID() });
		assert.equal((await callRoom(runtime, 'teacher', {})).participants[0].connected, true);
		socket.close();
	} finally {
		await runtime.dispose();
	}
});

test('simultaneous reconnects accept atomically and leave only the newest student transport active', async () => {
	const runtime = await createRoomRuntime(await mkdtemp(join(tmpdir(), 'campus-quiz-concurrent-')));
	try {
		await callRoom(runtime, 'initialize', input);
		await issue(runtime, actor, { type: 'join' });
		await issue(runtime, teacher, { type: 'start' });
		const actors = Array.from({ length: 6 }, () => ({ ...actor, connectionId: crypto.randomUUID() }));
		const sockets = await Promise.all(actors.map((candidate) => openSocket(runtime, candidate)));
		// Miniflare's upgraded clients can retain OPEN after a server-side close before accept.
		// Inspect the actual Durable Object transports, not the client shim's readyState.
		const registered = await (await runtime.dispatchFetch('http://localhost/sockets-for-test')).json();
		const activeServer = registered.filter((socket) => socket.ready === 1);
		assert.equal(activeServer.length, 1);
		const active = [sockets[actors.findIndex((candidate) => candidate.connectionId === activeServer[0].connectionId)]];
		assert.equal((await callRoom(runtime, 'teacher', {})).participants[0].connected, true);
		const ack = nextMessage(active[0], (message) => message.type === 'ack');
		active[0].send(
			JSON.stringify({
				type: 'save_answers',
				requestId: crypto.randomUUID(),
				version: 1,
				answers: [{ questionId, optionIds: [correctOptionId] }]
			})
		);
		assert.equal((await ack).view.participant.answerVersion, 1);
		active[0].close();
	} finally {
		await runtime.dispose();
	}
});

test('hibernating quiz sockets answer heartbeat without changing answers or session revision', async () => {
	const runtime = await createRoomRuntime(await mkdtemp(join(tmpdir(), 'campus-quiz-heartbeat-')));
	try {
		await callRoom(runtime, 'initialize', input);
		await issue(runtime, actor, { type: 'join' });
		const socket = await openSocket(runtime, actor);
		const before = await callRoom(runtime, 'teacher', {});
		const pong = new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Heartbeat response missing')), 5000);
			socket.addEventListener(
				'message',
				(event) => {
					clearTimeout(timer);
					resolve(event.data);
				},
				{ once: true }
			);
		});
		socket.send('ping');
		assert.equal(await pong, 'pong');
		const after = await callRoom(runtime, 'teacher', {});
		assert.equal(after.revision, before.revision);
		assert.equal(after.participants[0].answerVersion, 0);
		socket.close();
	} finally {
		await runtime.dispose();
	}
});

test('room accepts a valid ahead-clock lease without exceeding its receiver-clock bound', async () => {
	const runtime = await createRoomRuntime(await mkdtemp(join(tmpdir(), 'campus-quiz-clock-')));
	try {
		await callRoom(runtime, 'initialize', input);
		await issue(runtime, actor, { type: 'join' });
		// This is a deterministic synthetic skew, not evidence of deployed clock skew.
		const gatewayNow = Date.now() + 60_000;
		const refused = await runtime.dispatchFetch('http://localhost/socket', {
			headers: {
				Upgrade: 'websocket',
				'x-campus-quiz-actor': JSON.stringify(actor),
				'x-campus-quiz-issued-at': String(gatewayNow),
				'x-campus-quiz-expires-at': String(gatewayNow + 8 * 3600000)
			}
		});
		assert.equal(refused.status, 101);
		refused.webSocket.accept();
		refused.webSocket.close();
	} finally {
		await runtime.dispose();
	}
});

test('quiz answers and final submissions survive runtime restarts and identical retries', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'campus-quiz-room-'));
	let runtime = await createRoomRuntime(directory);
	const saveCommand = {
		type: 'save_answers',
		requestId: crypto.randomUUID(),
		version: 1,
		answers: [{ questionId, optionIds: [correctOptionId] }]
	};
	try {
		await callRoom(runtime, 'initialize', input);
		await issue(runtime, actor, { type: 'join' });
		await issue(runtime, teacher, { type: 'start' });
		const socket = await openSocket(runtime, actor);
		await runtime.unsafeEvictDurableObject('quiz-room-test', 'QuizRoom', {
			name: sessionId,
			webSockets: 'hibernate'
		});
		const acknowledgement = nextMessage(socket, (message) => message.type === 'ack');
		socket.send(JSON.stringify(saveCommand));
		const saved = await acknowledgement;
		assert.equal(saved.receipt.answerVersion, 1);
		assert.doesNotMatch(JSON.stringify(saved.view), /correctOptionIds|credentialHash/);
		await runtime.dispose();
		runtime = await createRoomRuntime(directory);
		const restored = await callRoom(runtime, 'participant', actor);
		assert.equal(restored.participant.answerVersion, 1);
		assert.deepEqual(restored.participant.answers, saveCommand.answers);
		const retried = await callRoom(runtime, 'command', { actor, command: saveCommand });
		assert.deepEqual(retried.receipt, saved.receipt);
		const submitCommand = {
			type: 'submit',
			requestId: crypto.randomUUID(),
			answerVersion: 1
		};
		const submitted = await callRoom(runtime, 'command', { actor, command: submitCommand });
		for (let index = 0; index < 140; index++) await issue(runtime, actor, { type: 'reconnect' });
		await runtime.dispose();
		runtime = await createRoomRuntime(directory);
		const currentActor = { ...actor, connectionId: crypto.randomUUID() };
		await issue(runtime, currentActor, { type: 'reconnect' });
		const submissionRetry = await callRoom(runtime, 'command', {
			actor: currentActor,
			command: submitCommand
		});
		assert.deepEqual(submissionRetry.receipt, submitted.receipt);
		assert.equal(submissionRetry.view.participant.status, 'submitted');
	} finally {
		await runtime.dispose();
	}
});

test('quiz WebSockets require an internal actor, project safe state and reject malformed commands', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'campus-quiz-room-'));
	const runtime = await createRoomRuntime(directory);
	try {
		await callRoom(runtime, 'initialize', input);
		await issue(runtime, actor, { type: 'join' });
		const refused = await runtime.dispatchFetch('http://localhost/socket', {
			headers: { Upgrade: 'websocket' }
		});
		assert.equal(refused.status, 403);
		const socket = await openSocket(runtime, actor);
		const rejection = nextMessage(socket);
		socket.send(JSON.stringify({ type: 'start', requestId: crypto.randomUUID(), role: 'teacher' }));
		assert.equal((await rejection).type, 'error');
		for (const type of ['join', 'reconnect', 'disconnect', 'start']) {
			const forbidden = nextMessage(socket);
			socket.send(JSON.stringify({ type, requestId: crypto.randomUUID() }));
			assert.equal((await forbidden).type, 'error', `${type} must not be accepted from a participant socket`);
		}
		socket.close();
		const teacherSocket = await openSocket(runtime, teacher);
		const forbiddenClose = nextMessage(teacherSocket);
		teacherSocket.send(JSON.stringify({ type: 'close', requestId: crypto.randomUUID() }));
		assert.equal((await forbiddenClose).type, 'error');
		assert.equal((await callRoom(runtime, 'teacher', {})).status, 'lobby');
		teacherSocket.close();
	} finally {
		await runtime.dispose();
	}
});

test('a complete 200-question multiple-choice answer snapshot is durably acknowledged', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'campus-quiz-room-'));
	const runtime = await createRoomRuntime(directory);
	const questions = Array.from({ length: 200 }, () => {
		const options = Array.from({ length: 12 }, (_, index) => ({
			id: crypto.randomUUID(),
			text: String(index)
		}));
		return {
			id: crypto.randomUUID(),
			type: 'multiple',
			prompt: 'Select the correct answer.',
			code: '',
			codeLanguage: '',
			options,
			correctOptionIds: [options[0].id]
		};
	});
	const answers = questions.map((question) => ({
		questionId: question.id,
		optionIds: question.options.map((option) => option.id)
	}));
	const command = { type: 'save_answers', requestId: crypto.randomUUID(), version: 1, answers };
	assert.ok(new TextEncoder().encode(JSON.stringify(command)).byteLength > 65536);
	try {
		await callRoom(runtime, 'initialize', { ...input, content: { ...input.content, questions } });
		await issue(runtime, actor, { type: 'join' });
		await issue(runtime, teacher, { type: 'start' });
		const socket = await openSocket(runtime, actor);
		const acknowledgement = nextMessage(socket, (message) => message.type === 'ack');
		socket.send(JSON.stringify(command));
		const result = await acknowledgement;
		assert.equal(result.receipt.answerVersion, 1);
		assert.equal(result.view.participant.answers.length, 200);
		assert.equal((await callRoom(runtime, 'teacher', {})).participants[0].answeredCount, 200);
		socket.close();
	} finally {
		await runtime.dispose();
	}
});

test('forty participants can save a maximum-size quiz and recover every confirmed answer after restart', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'campus-quiz-room-'));
	let runtime = await createRoomRuntime(directory);
	const questions = Array.from({ length: 200 }, () => {
		const options = Array.from({ length: 12 }, (_, index) => ({
			id: crypto.randomUUID(),
			text: String(index)
		}));
		return {
			id: crypto.randomUUID(),
			type: 'multiple',
			prompt: 'Select an answer.',
			code: '',
			codeLanguage: '',
			options,
			correctOptionIds: [options[0].id]
		};
	});
	const roster = Array.from({ length: 40 }, (_, index) => ({
		id: crypto.randomUUID(),
		name: `Fictional Student ${index}`
	}));
	const actors = roster.map((entry, index) => ({
		kind: 'participant',
		participantId: entry.id,
		credentialHash: index.toString(16).padStart(64, '0'),
		connectionId: crypto.randomUUID()
	}));
	const answers = questions.map((question) => ({
		questionId: question.id,
		optionIds: question.options.map((option) => option.id)
	}));
	try {
		await callRoom(runtime, 'initialize', {
			...input,
			roster,
			content: { ...input.content, durationSeconds: 600, questions }
		});
		for (const issuingActor of actors) await issue(runtime, issuingActor, { type: 'join' });
		await issue(runtime, teacher, { type: 'start' });
		for (const issuingActor of actors) {
			const saved = await issue(runtime, issuingActor, {
				type: 'save_answers',
				version: 1,
				answers
			});
			assert.equal(saved.receipt.answerVersion, 1);
		}
		await runtime.dispose();
		runtime = await createRoomRuntime(directory);
		const restored = await callRoom(runtime, 'teacher', {});
		assert.equal(restored.participants.length, 40);
		assert.ok(restored.participants.every((participant) => participant.answeredCount === 200));
		assert.deepEqual((await callRoom(runtime, 'participant', actors[39])).participant.answers, answers);
		await issue(runtime, teacher, { type: 'close' });
		await callRoom(runtime, 'purge', {});
		assert.equal((await runtime.dispatchFetch('http://localhost/teacher', { method: 'POST', body: '{}' })).status, 422);
	} finally {
		await runtime.dispose();
	}
});

test('the durable alarm expires a quiz without a student request and refuses late answers', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'campus-quiz-room-'));
	const runtime = await createRoomRuntime(directory);
	try {
		await callRoom(runtime, 'initialize', {
			...input,
			content: { ...input.content, durationSeconds: 1 }
		});
		await issue(runtime, actor, { type: 'join' });
		const socket = await openSocket(runtime, teacher);
		const expired = nextMessage(socket, (message) => message.view?.participants?.[0]?.status === 'expired');
		await issue(runtime, teacher, { type: 'start' });
		const notification = await expired;
		assert.ok(notification.view.serverNow >= notification.view.participants[0].deadlineAt);
		const response = await runtime.dispatchFetch('http://localhost/command', {
			method: 'POST',
			body: JSON.stringify({
				actor,
				command: {
					type: 'save_answers',
					requestId: crypto.randomUUID(),
					version: 1,
					answers: [{ questionId, optionIds: [correctOptionId] }]
				}
			})
		});
		assert.equal(response.status, 422);
		socket.close();
	} finally {
		await runtime.dispose();
	}
});

test('quiz initialization is immutable and an absent-only retake gets a separate durable room', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'campus-quiz-room-'));
	const runtime = await createRoomRuntime(directory);
	try {
		await callRoom(runtime, 'initialize', input);
		await callRoom(runtime, 'initialize', input);
		const changed = await runtime.dispatchFetch('http://localhost/initialize', {
			method: 'POST',
			body: JSON.stringify({ ...input, content: { ...input.content, title: 'Changed' } })
		});
		assert.equal(changed.status, 422);
		await issue(runtime, teacher, { type: 'start' });
		await issue(runtime, teacher, { type: 'close' });
		const retakeId = crypto.randomUUID();
		const retakeInput = {
			id: retakeId,
			participantIds: [participantId],
			protectedParticipantIds: [],
			shuffleSeed: 'fictional-retake-seed',
			createdAt: Date.now()
		};
		const retake = await callRoom(runtime, 'retake', retakeInput);
		assert.equal(retake.id, retakeId);
		assert.equal(retake.status, 'lobby');
		assert.equal(retake.participants[0].status, 'not_joined');
		assert.equal(retake.participants[0].points, null);
		assert.doesNotMatch(JSON.stringify(retake), /correctOptionIds|credentialHash/);
		const retry = await callRoom(runtime, 'retake', retakeInput);
		assert.equal(retry.id, retakeId);
		const target = await callRoom(runtime, `teacher?id=${retakeId}`, {});
		assert.equal(target.id, retakeId);
		const source = await callRoom(runtime, 'teacher', {});
		assert.equal(source.status, 'closed');
		assert.equal(source.participants[0].status, 'absent');
		const newcomerId = crypto.randomUUID();
		const newcomerInput = {
			...retakeInput,
			id: crypto.randomUUID(),
			participantIds: [participantId, newcomerId],
			newParticipants: [{ id: newcomerId, name: 'Fictional newcomer' }]
		};
		const newcomerRoom = await callRoom(runtime, 'retake', newcomerInput);
		assert.deepEqual(
			newcomerRoom.participants.map((entry) => entry.id),
			newcomerInput.participantIds
		);
		assert.equal(newcomerRoom.participants[1].points, null);
		assert.deepEqual((await callRoom(runtime, 'retake', newcomerInput)).participants, newcomerRoom.participants);
		assert.equal((await callRoom(runtime, 'teacher', {})).participants.length, 1);
	} finally {
		await runtime.dispose();
	}
});

test('purging refuses lobby and running rooms without losing saved answers or closing sockets', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'campus-quiz-purge-guard-'));
	const runtime = await createRoomRuntime(directory);
	try {
		await callRoom(runtime, 'initialize', input);
		const lobbyRefusal = await callRoom(runtime, 'rpc', { method: 'purge' });
		assert.equal(lobbyRefusal.ok, false);
		assert.equal(lobbyRefusal.error.kind, 'domain');
		assert.equal(lobbyRefusal.error.code, 'invalid_state');
		assert.equal((await callRoom(runtime, 'teacher', {})).status, 'lobby');
		await issue(runtime, actor, { type: 'join' });
		await issue(runtime, teacher, { type: 'start' });
		await issue(runtime, actor, {
			type: 'save_answers',
			version: 1,
			answers: [{ questionId, optionIds: [correctOptionId] }]
		});
		const socket = await openSocket(runtime, actor);
		const runningRefusal = await callRoom(runtime, 'rpc', { method: 'purge' });
		assert.equal(runningRefusal.ok, false);
		assert.equal(runningRefusal.error.code, 'invalid_state');
		const restored = await callRoom(runtime, 'participant', actor);
		assert.equal(restored.status, 'running');
		assert.deepEqual(restored.participant.answers, [{ questionId, optionIds: [correctOptionId] }]);
		const acknowledged = nextMessage(socket, (message) => message.type === 'ack');
		socket.send(
			JSON.stringify({
				type: 'save_answers',
				requestId: crypto.randomUUID(),
				version: 2,
				answers: [{ questionId, optionIds: [incorrectOptionId] }]
			})
		);
		assert.equal((await acknowledged).receipt.answerVersion, 2);
		socket.close();
	} finally {
		await runtime.dispose();
	}
});

test('purging a closed quiz removes durable answers, closes sockets and permanently rejects resurrection', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'campus-quiz-room-'));
	let runtime = await createRoomRuntime(directory);
	try {
		await callRoom(runtime, 'initialize', input);
		await issue(runtime, actor, { type: 'join' });
		await issue(runtime, teacher, { type: 'start' });
		const socket = await openSocket(runtime, actor);
		await issue(runtime, teacher, { type: 'close' });
		const closed = new Promise((resolve) => socket.addEventListener('close', resolve, { once: true }));
		await callRoom(runtime, 'purge', {});
		await closed;
		socket.close();
		const response = await runtime.dispatchFetch('http://localhost/teacher', {
			method: 'POST',
			body: '{}'
		});
		assert.equal(response.status, 422);
		assert.equal((await response.json()).message, 'quiz_room_purged');
		await runtime.dispose();
		runtime = await createRoomRuntime(directory);
		const reopened = await runtime.dispatchFetch('http://localhost/initialize', {
			method: 'POST',
			body: JSON.stringify(input)
		});
		assert.equal(reopened.status, 422);
		assert.equal((await reopened.json()).message, 'quiz_room_purged');
		await callRoom(runtime, 'purge', {});
	} finally {
		await runtime.dispose();
	}
});
