import type { NativeQuizFixture } from '../../src/lib/server/db/testing/quiz-fixtures.js';
import type {
	QuizParticipantProjection,
	QuizSessionReceipt,
	QuizSessionReview
} from '../../src/lib/domain/quiz-session.js';
import { quizTeacherProjectionSchema } from '../../src/lib/domain/quiz-session.js';
import { test, expect } from './fixtures.js';
import { activate } from './support/auth.js';

type WireMessage = {
	type: 'state' | 'ack' | 'error';
	view?: QuizParticipantProjection;
	receipt?: QuizSessionReceipt;
	review?: QuizSessionReview;
	code?: string;
};

test('published quiz uses real HTTP, durable WebSocket ACKs, reconnect retries and one personal review', async ({
	app,
	page,
	context
}) => {
	await activate(page, app);
	const fixture = await app.call<NativeQuizFixture>('native-quiz');
	const teacherPath = `/api/teaching/quiz-rooms/${fixture.runId}`;
	const publicPath = `/api/quizzes/${fixture.contextId}/rooms/${fixture.runId}`;
	const opened = await context.request.post(`${app.origin}/api/teaching/quizzes/${fixture.quizId}/rooms`, {
		headers: { Origin: app.origin },
		data: {
			id: fixture.runId,
			quizId: fixture.quizId,
			expectedQuizRevision: fixture.quizRevision
		}
	});
	expect(opened.status()).toBe(200);
	const available = await context.request.get(app.origin + publicPath);
	expect(available.status()).toBe(200);
	expect(await available.json()).toEqual({
		id: fixture.runId,
		title: fixture.content.title,
		status: 'lobby',
		roster: fixture.roster,
		joined: false,
		preparedParticipantId: null
	});
	const prepared = await context.request.put(app.origin + publicPath, {
		headers: { Origin: app.origin },
		data: { participantId: fixture.roster[0].id, fullscreenConfirmed: true }
	});
	expect(prepared.status()).toBe(200);
	const joined = await context.request.post(app.origin + publicPath, {
		headers: { Origin: app.origin },
		data: { participantId: fixture.roster[0].id, fullscreenConfirmed: true }
	});
	expect(joined.status()).toBe(200);
	const cookie = (await context.cookies(app.origin + publicPath)).find((entry) => entry.name === 'coursely_quiz');
	expect(cookie?.httpOnly).toBe(true);
	expect(cookie?.path).toBe(publicPath);
	const question = fixture.content.questions[0];
	const result = await page.evaluate(
		async ({ teacherPath, publicPath, question }) => {
			const next = (socket: WebSocket, matches: (message: WireMessage) => boolean) =>
				new Promise<WireMessage>((resolve, reject) => {
					const cleanup = () => {
						clearTimeout(timeout);
						socket.removeEventListener('message', receive);
						socket.removeEventListener('error', failed);
					};
					const failed = () => {
						cleanup();
						reject(new Error('The real quiz WebSocket failed.'));
					};
					const receive = (event: MessageEvent<string>) => {
						const message: WireMessage = JSON.parse(event.data);
						if (message.type === 'error') {
							cleanup();
							reject(new Error(`The real quiz rejected a command: ${message.code}`));
							return;
						}
						if (!matches(message)) return;
						cleanup();
						resolve(message);
					};
					const timeout = setTimeout(() => {
						cleanup();
						reject(new Error('The real quiz did not acknowledge the command.'));
					}, 10000);
					socket.addEventListener('message', receive);
					socket.addEventListener('error', failed);
				});
			const post = async (path: string, data: unknown) => {
				const response = await fetch(path, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(data)
				});
				if (!response.ok) throw new Error(`The real quiz HTTP command failed: ${response.status}`);
				return response.json();
			};
			const connect = async () => {
				const socket = new WebSocket(new URL(publicPath, location.href).href.replace(/^http/, 'ws'));
				const initial = await next(socket, (message) => message.type === 'state');
				return { socket, initial };
			};
			const send = <T extends { requestId: string; type: string }>(socket: WebSocket, command: T) => {
				const response = next(
					socket,
					(message) => message.type === 'ack' && message.receipt?.requestId === command.requestId
				);
				socket.send(JSON.stringify(command));
				return response;
			};
			const disconnect = (socket: WebSocket) =>
				new Promise<void>((resolve) => {
					socket.addEventListener('close', () => resolve(), { once: true });
					socket.close();
				});
			let connection = await connect();
			const lobby = connection.initial;
			const runningMessage = next(connection.socket, (message) => message.view?.status === 'running');
			await post(teacherPath, { type: 'start', requestId: crypto.randomUUID() });
			const running = await runningMessage;
			const rejectedStart = await fetch(teacherPath, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ type: 'start', requestId: crypto.randomUUID() })
			});
			const refused = { status: rejectedStart.status, body: await rejectedStart.json() };
			const save = {
				type: 'save_answers',
				requestId: crypto.randomUUID(),
				version: 1,
				answers: [{ questionId: question.id, optionIds: question.correctOptionIds }]
			};
			const acknowledged = await send(connection.socket, save);
			await disconnect(connection.socket);
			connection = await connect();
			const restored = connection.initial;
			const retried = await send(connection.socket, save);
			const submitted = await send(connection.socket, {
				type: 'submit',
				requestId: crypto.randomUUID(),
				answerVersion: 1
			});
			const closedMessage = next(connection.socket, (message) => message.view?.status === 'closed');
			const closedHttp = await post(teacherPath, { type: 'close', requestId: crypto.randomUUID() });
			const closed = await closedMessage;
			const reviewCommand = { type: 'consume_review', requestId: crypto.randomUUID() };
			const review = await send(connection.socket, reviewCommand);
			const reviewRetry = await send(connection.socket, reviewCommand);
			await disconnect(connection.socket);
			connection = await connect();
			const afterReviewReconnect = connection.initial;
			await disconnect(connection.socket);
			return {
				lobby,
				running,
				refused,
				acknowledged,
				restored,
				retried,
				submitted,
				closed,
				closedHttp,
				review,
				reviewRetry,
				afterReviewReconnect
			};
		},
		{ teacherPath, publicPath, question }
	);
	expect(result.lobby.view?.questions).toEqual([]);
	expect(result.running.view?.questions).toHaveLength(3);
	expect(result.refused.status).toBe(409);
	expect(typeof result.refused.body.message).toBe('string');
	expect(result.acknowledged.receipt?.answerVersion).toBe(1);
	expect(result.restored.view?.participant.answers).toEqual([
		{ questionId: question.id, optionIds: question.correctOptionIds }
	]);
	expect(result.retried.receipt).toEqual(result.acknowledged.receipt);
	expect(result.submitted.view?.participant.status).toBe('submitted');
	expect(
		JSON.stringify([
			result.lobby,
			result.running,
			result.acknowledged,
			result.restored,
			result.submitted,
			result.closed
		])
	).not.toMatch(/correctOptionIds|credentialHash/);
	expect(result.closed.view?.participant.points).toBeNull();
	expect(result.closed.view?.participant.answers).toEqual([]);
	expect(result.closedHttp.grades).toEqual({ reported: fixture.roster.length, conflicts: [] });
	expect(result.review.review).toMatchObject({ points: 1, maxPoints: 3 });
	expect(result.reviewRetry.review).toBeUndefined();
	expect(result.afterReviewReconnect.view?.reviewAvailable).toBe(false);
	const teacherResponse = await context.request.get(app.origin + teacherPath);
	expect(teacherResponse.status()).toBe(200);
	const teacher = quizTeacherProjectionSchema.parse((await teacherResponse.json()).view);
	expect(teacher.status).toBe('closed');
	expect(teacher.participants.find((entry) => entry.id === fixture.roster[0].id)).toMatchObject({
		status: 'submitted',
		answeredCount: 1,
		points: 1
	});
	expect(teacher.participants.filter((entry) => entry.status === 'absent')).toHaveLength(fixture.roster.length - 1);
});
