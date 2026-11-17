import type { Page, WebSocketRoute } from '@playwright/test';
import { test, expect } from './fixtures.js';
import type { NativeQuizFixture } from '../../src/lib/server/db/testing/quiz-fixtures.js';
import type {
	QuizParticipantProjection,
	QuizSessionCommand,
	QuizSessionReview
} from '../../src/lib/domain/quiz-session.js';
import { projectQuizQuestions } from '../../src/lib/domain/quiz-content.js';
import { publicationReviewDataSchema } from '../../src/lib/domain/publication.js';
import { activate } from './support/auth.js';

const mockStudentParticipation = async (page: Page, fixture: NativeQuizFixture, closed = false) => {
	const roomPath = `/api/quizzes/${fixture.contextId}/rooms/${fixture.runId}`;
	const commands: QuizSessionCommand[] = [];
	const connections: { closed: boolean }[] = [];
	let heartbeats = 0;
	let silent = false;
	let channel: WebSocketRoute | null = null;
	let view: QuizParticipantProjection = {
		id: fixture.runId,
		title: fixture.content.title,
		status: closed ? 'closed' : 'running',
		revision: 1,
		serverNow: Date.now(),
		reviewAvailable: closed,
		questions: closed ? [] : projectQuizQuestions(fixture.content),
		participant: {
			...fixture.roster[0],
			status: closed ? 'submitted' : 'active',
			connected: true,
			answerVersion: 0,
			startedAt: Date.now(),
			deadlineAt: Date.now() + 600_000,
			extraSeconds: 0,
			points: null,
			incidents: { focus: 0, fullscreen: 0 },
			answers: []
		}
	};
	const publish = (
		participant: Partial<QuizParticipantProjection['participant']> = {},
		patch: Partial<QuizParticipantProjection> = {}
	) => {
		view = {
			...view,
			revision: view.revision + 1,
			serverNow: Date.now(),
			...patch,
			participant: { ...view.participant, ...participant }
		};
		channel?.send(JSON.stringify({ type: 'state', view }));
	};
	const acknowledge = (
		command: QuizSessionCommand,
		participant: Partial<QuizParticipantProjection['participant']> = {},
		review?: QuizSessionReview
	) => {
		view = {
			...view,
			revision: view.revision + 1,
			serverNow: Date.now(),
			reviewAvailable: review ? false : view.reviewAvailable,
			participant: {
				...view.participant,
				...(command.type === 'save_answers' ? { answerVersion: command.version, answers: command.answers } : {}),
				...participant
			}
		};
		channel?.send(
			JSON.stringify({
				type: 'ack',
				view,
				...(review ? { review } : {}),
				receipt: {
					requestId: command.requestId,
					type: command.type,
					sessionRevision: view.revision,
					receivedAt: Date.now(),
					participantId: fixture.roster[0].id,
					...(command.type === 'save_answers' ? { answerVersion: command.version } : {})
				}
			})
		);
	};
	await page.route('**' + roomPath, (route) =>
		route.fulfill({
			json: { id: fixture.runId, title: fixture.content.title, status: view.status, roster: [], joined: true }
		})
	);
	await page.routeWebSocket('**' + roomPath, (socket) => {
		const connection = { closed: false };
		connections.push(connection);
		socket.onClose(() => {
			connection.closed = true;
		});
		channel = socket;
		socket.send(JSON.stringify({ type: 'state', view }));
		socket.onMessage((raw) => {
			if (raw === 'ping') {
				heartbeats++;
				if (!silent) socket.send('pong');
				return;
			}
			commands.push(JSON.parse(String(raw)) as QuizSessionCommand);
		});
	});
	return {
		commands,
		heartbeats: () => heartbeats,
		setSilent: (value: boolean) => {
			silent = value;
		},
		connections,
		publish,
		acknowledge,
		disconnect: (reason = 'Fictional connection interruption') => channel?.close({ code: 1008, reason })
	};
};

test('student heartbeat keeps reading connected without treating pong as an answer acknowledgement', async ({
	app,
	page
}) => {
	const fixture = await app.call<NativeQuizFixture>('native-quiz-ui');
	const participation = await mockStudentParticipation(page, fixture);
	await page.clock.install();
	await page.goto(`${app.origin}/modules/${fixture.contextId}/quiz/${fixture.runId}`);
	await expect(page.getByRole('radio', { name: 'Première option', exact: true })).toBeEnabled();
	for (let tick = 1; tick <= 3; tick++) {
		await page.clock.runFor(20_000);
		await expect.poll(participation.heartbeats).toBe(tick);
	}
	await expect(page.getByRole('radio', { name: 'Première option', exact: true })).toBeEnabled();
	await expect(page.getByText(/La réponse du serveur est illisible/)).toHaveCount(0);
	expect(participation.commands.filter((command) => command.type === 'save_answers')).toHaveLength(0);
	expect(participation.connections).toHaveLength(1);
	expect(participation.connections[0].closed).toBe(false);
});

test('student heartbeat reconnects a silent transport and preserves unacknowledged answers', async ({ app, page }) => {
	const fixture = await app.call<NativeQuizFixture>('native-quiz-ui');
	const participation = await mockStudentParticipation(page, fixture);
	await page.clock.install();
	await page.goto(`${app.origin}/modules/${fixture.contextId}/quiz/${fixture.runId}`);
	const option = page.getByRole('radio', { name: 'Première option', exact: true });
	await expect(option).toBeEnabled();
	await option.check();
	await page.clock.runFor(1000);
	await expect.poll(() => participation.commands.filter((command) => command.type === 'save_answers').length).toBe(1);
	const pending = participation.commands.find((command) => command.type === 'save_answers')!;
	participation.setSilent(true);
	await page.clock.runFor(34_000);
	await expect.poll(() => participation.connections[0].closed).toBe(true);
	participation.setSilent(false);
	await page.clock.runFor(2000);
	await expect.poll(() => participation.connections.length).toBe(2);
	await expect.poll(() => participation.commands.filter((command) => command.type === 'save_answers').length).toBe(2);
	const retried = participation.commands.filter((command) => command.type === 'save_answers')[1];
	expect(retried).toEqual(pending);
	participation.acknowledge(retried);
	await expect(option).toBeChecked();
	await expect(option).toBeEnabled();
});

test('a replaced student socket does not fight the newer tab with automatic retries', async ({ app, page }) => {
	const fixture = await app.call<NativeQuizFixture>('native-quiz-ui');
	const participation = await mockStudentParticipation(page, fixture);
	await page.clock.install();
	await page.goto(`${app.origin}/modules/${fixture.contextId}/quiz/${fixture.runId}`);
	await expect(page.getByRole('radio', { name: 'Première option', exact: true })).toBeEnabled();
	participation.disconnect('Connection replaced');
	await expect(page.locator('#quiz').getByText(/Ce quiz a été ouvert dans un autre onglet/)).toBeVisible();
	await page.clock.runFor(120_000);
	expect(participation.connections).toHaveLength(1);
});

test('quiz history navigation replaces the room and closes the previous socket', async ({ app, page }) => {
	const firstFixture = await app.call<NativeQuizFixture>('native-quiz-ui');
	const secondFixture = await app.call<NativeQuizFixture>('native-quiz-ui');
	firstFixture.content.title = 'First fictional quiz';
	secondFixture.content.title = 'Second fictional quiz';
	const first = await mockStudentParticipation(page, firstFixture);
	const second = await mockStudentParticipation(page, secondFixture);
	const url = (fixture: NativeQuizFixture) => `${app.origin}/modules/${fixture.contextId}/quiz/${fixture.runId}`;
	const answer = page.getByRole('radio', { name: 'Première option', exact: true });
	await page.goto(url(firstFixture));
	await expect(page.getByRole('heading', { name: firstFixture.content.title, exact: true })).toBeVisible();
	await expect(answer).toBeEnabled();
	const documentStartedAt = await page.evaluate(() => performance.timeOrigin);
	await answer.check();
	await expect.poll(() => first.commands.some((command) => command.type === 'save_answers')).toBe(true);
	const saved = first.commands.find((command) => command.type === 'save_answers')!;
	first.acknowledge(saved);

	await page.evaluate((href) => {
		const link = document.createElement('a');
		link.href = href;
		link.textContent = 'Open another fictional quiz';
		link.dataset.testid = 'quiz-history-navigation';
		document.querySelector('main')!.prepend(link);
	}, url(secondFixture));
	await page.getByTestId('quiz-history-navigation').click();
	await expect(page).toHaveURL(url(secondFixture));
	await expect(page.getByRole('heading', { name: secondFixture.content.title, exact: true })).toBeVisible();
	await expect(answer).not.toBeChecked();
	await expect.poll(() => first.connections[0]?.closed).toBe(true);
	await expect.poll(() => second.connections.length).toBe(1);
	await page.evaluate(() => document.querySelector('[data-testid="quiz-history-navigation"]')?.remove());

	await page.goBack();
	await expect(page).toHaveURL(url(firstFixture));
	await expect(page.getByRole('heading', { name: firstFixture.content.title, exact: true })).toBeVisible();
	await expect(answer).toBeChecked();
	await expect.poll(() => second.connections[0]?.closed).toBe(true);
	await expect.poll(() => first.connections.length).toBe(2);

	await page.goForward();
	await expect(page).toHaveURL(url(secondFixture));
	await expect(page.getByRole('heading', { name: secondFixture.content.title, exact: true })).toBeVisible();
	await expect(answer).not.toBeChecked();
	await expect.poll(() => first.connections[1]?.closed).toBe(true);
	await expect.poll(() => second.connections.length).toBe(2);
	expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStartedAt);
	await answer.check();
	await expect.poll(() => second.commands.some((command) => command.type === 'save_answers')).toBe(true);
	expect(second.commands.find((command) => command.type === 'save_answers')?.answers[0].questionId).toBe(
		secondFixture.content.questions[0].id
	);
	expect(first.commands.filter((command) => command.type === 'save_answers')).toHaveLength(1);
});

for (const ending of ['interrupted', 'expired', 'submitted', 'closed'] as const) {
	test(`quiz lifecycle announces its start and ${ending} without losing keyboard focus`, async ({ app, page }) => {
		const fixture = await app.call<NativeQuizFixture>('native-quiz-ui');
		const roomPath = `/api/quizzes/${fixture.contextId}/rooms/${fixture.runId}`;
		let channel: WebSocketRoute | null = null;
		let view: QuizParticipantProjection = {
			id: fixture.runId,
			title: fixture.content.title,
			status: 'lobby',
			revision: 1,
			serverNow: Date.now(),
			reviewAvailable: false,
			questions: [],
			participant: {
				...fixture.roster[0],
				status: 'lobby',
				connected: true,
				answerVersion: 0,
				startedAt: null,
				deadlineAt: null,
				extraSeconds: 0,
				points: null,
				incidents: { focus: 0, fullscreen: 0 },
				answers: []
			}
		};
		const broadcast = () => channel?.send(JSON.stringify({ type: 'state', view }));
		await page.route('**' + roomPath, (route) =>
			route.fulfill({
				json: { id: fixture.runId, title: view.title, status: view.status, roster: [], joined: true }
			})
		);
		await page.routeWebSocket('**' + roomPath, (socket) => {
			channel = socket;
			broadcast();
		});
		await page.goto(`${app.origin}/modules/${fixture.contextId}/quiz/${fixture.runId}`);
		await expect(page.getByRole('heading', { name: 'Vous êtes dans la salle' })).toBeVisible();
		const lifecycle = page.getByRole('status', { name: 'État du quiz' });
		await expect(lifecycle).toBeEmpty();
		view = {
			...view,
			status: 'running',
			revision: 2,
			questions: projectQuizQuestions(fixture.content),
			participant: {
				...view.participant,
				status: 'active',
				startedAt: Date.now(),
				deadlineAt: Date.now() + 600_000
			}
		};
		broadcast();
		await expect(page.getByRole('heading', { name: fixture.content.questions[0].prompt, exact: true })).toBeFocused();
		await expect(lifecycle).toHaveText('Le quiz a commencé. Vous pouvez répondre aux questions.');
		const answer = page.getByRole('radio', { name: fixture.content.questions[0].options[0].text, exact: true });
		await answer.focus();
		view = {
			...view,
			revision: 3,
			participant: {
				...view.participant,
				answerVersion: 1,
				answers: [
					{ questionId: fixture.content.questions[0].id, optionIds: [fixture.content.questions[0].options[0].id] }
				]
			}
		};
		broadcast();
		await expect(answer).toBeChecked();
		await expect(answer).toBeFocused();
		await expect(lifecycle).toHaveText('Le quiz a commencé. Vous pouvez répondre aux questions.');
		if (ending === 'interrupted') {
			await page.getByRole('button', { name: /^Questions ·/ }).click();
			await expect(page.getByRole('dialog', { name: 'Vos questions' })).toBeVisible();
		} else if (ending === 'submitted') {
			for (let index = 1; index < fixture.content.questions.length; index++)
				await page.getByRole('button', { name: 'Suivante' }).click();
			await page.getByRole('button', { name: 'Vérifier mes réponses', exact: true }).click();
			await expect(page.getByRole('heading', { name: 'Vérifiez vos réponses', exact: true })).toBeFocused();
			await page.getByRole('button', { name: 'Remettre définitivement', exact: true }).click();
			await expect(page.getByRole('alertdialog')).toBeVisible();
		}
		if (ending === 'expired') {
			await page.getByRole('button', { name: 'Suivante' }).click();
			view = {
				...view,
				revision: 4,
				serverNow: Date.now(),
				participant: { ...view.participant, deadlineAt: Date.now() + 1_000 }
			};
		} else {
			view = {
				...view,
				revision: 4,
				status: ending === 'closed' ? 'closed' : 'running',
				questions: [],
				participant: { ...view.participant, status: ending === 'closed' ? 'submitted' : ending }
			};
		}
		broadcast();
		const title = {
			interrupted: 'Votre quiz a été arrêté',
			expired: 'Le temps est écoulé',
			submitted: 'Vos réponses sont remises',
			closed: 'Quiz clôturé'
		}[ending];
		await expect(page.getByRole('heading', { name: title, exact: true })).toBeFocused();
		await expect(lifecycle).toHaveText(title);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page.getByRole('alertdialog')).toHaveCount(0);
		if (ending === 'expired') {
			view = {
				...view,
				revision: 5,
				serverNow: Date.now(),
				participant: { ...view.participant, deadlineAt: Date.now() + 600_000, extraSeconds: 600 }
			};
			broadcast();
			await expect(page.getByRole('heading', { name: fixture.content.questions[1].prompt, exact: true })).toBeFocused();
			view = {
				...view,
				revision: 6,
				serverNow: Date.now(),
				participant: { ...view.participant, deadlineAt: Date.now() + 1_000 }
			};
			broadcast();
			await expect(page.getByRole('heading', { name: title, exact: true })).toBeFocused();
			const fullscreenButton = page.getByRole('button', { name: 'Revenir en plein écran' });
			await fullscreenButton.focus();
			view = {
				...view,
				revision: 7,
				serverNow: Date.now(),
				participant: { ...view.participant, deadlineAt: Date.now() + 600_000, extraSeconds: 1_200 }
			};
			broadcast();
			await expect(page.getByRole('heading', { name: fixture.content.questions[1].prompt, exact: true })).toBeVisible();
			await expect(fullscreenButton).toBeFocused();
			view = {
				...view,
				revision: 8,
				serverNow: Date.now(),
				participant: { ...view.participant, deadlineAt: Date.now() + 1_000 }
			};
			broadcast();
			await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
			await page.getByRole('heading', { name: title, exact: true }).focus();
			view = {
				...view,
				revision: 9,
				questions: [],
				participant: { ...view.participant, status: 'expired' }
			};
			broadcast();
			await expect(page.getByRole('timer')).toHaveCount(0);
			await expect(page.getByRole('heading', { name: title, exact: true })).toBeFocused();
			await expect(lifecycle).toHaveText(title);
		}
		const courseLink = page.getByRole('link', { name: 'Retour au cours' });
		if (ending !== 'expired') {
			await courseLink.focus();
			view = { ...view, revision: 5 };
			broadcast();
			await expect(courseLink).toBeFocused();
		}
	});
}

test('an unreadable quiz response preserves choices and waits for confirmed recovery', async ({ app, page }) => {
	const fixture = await app.call<NativeQuizFixture>('native-quiz-ui');
	const roomPath = `/api/quizzes/${fixture.contextId}/rooms/${fixture.runId}`;
	let channel: WebSocketRoute | null = null;
	const saves: Extract<QuizSessionCommand, { type: 'save_answers' }>[] = [];
	let view: QuizParticipantProjection = {
		id: fixture.runId,
		title: fixture.content.title,
		status: 'running',
		revision: 2,
		serverNow: Date.now(),
		reviewAvailable: false,
		questions: projectQuizQuestions(fixture.content),
		participant: {
			...fixture.roster[0],
			status: 'active',
			connected: true,
			answerVersion: 0,
			startedAt: Date.now(),
			deadlineAt: Date.now() + 600_000,
			extraSeconds: 0,
			points: null,
			incidents: { focus: 0, fullscreen: 0 },
			answers: []
		}
	};
	const broadcast = (projection = view) => channel?.send(JSON.stringify({ type: 'state', view: projection }));
	const sendUnreadableResponse = () => channel?.send('unreadable-fictional-response');
	const acknowledge = (index: number) => {
		const command = saves[index];
		view = {
			...view,
			revision: view.revision + 1,
			serverNow: Date.now(),
			participant: { ...view.participant, answerVersion: command.version, answers: command.answers }
		};
		channel?.send(
			JSON.stringify({
				type: 'ack',
				view,
				receipt: {
					requestId: command.requestId,
					type: command.type,
					sessionRevision: view.revision,
					receivedAt: Date.now(),
					participantId: fixture.roster[0].id,
					answerVersion: command.version
				}
			})
		);
	};
	await page.route('**' + roomPath, (route) =>
		route.fulfill({
			json: {
				id: fixture.runId,
				title: fixture.content.title,
				status: 'running',
				roster: [],
				joined: true
			}
		})
	);
	await page.routeWebSocket('**' + roomPath, (socket) => {
		channel = socket;
		broadcast();
		socket.onMessage((raw) => {
			if (raw === 'ping') {
				socket.send('pong');
				return;
			}
			const command = JSON.parse(String(raw)) as QuizSessionCommand;
			if (command.type === 'save_answers') saves.push(command);
		});
	});
	await page.goto(`${app.origin}/modules/${fixture.contextId}/quiz/${fixture.runId}`);
	const savedStatus = page.getByText('Réponses enregistrées', { exact: true });
	const recovery = page
		.locator('.quiz-student')
		.getByText(
			'La réponse du serveur est illisible. Conservez cet écran et prévenez l’enseignant ; la sauvegarde de vos derniers choix n’est pas confirmée.',
			{ exact: true }
		);
	await expect(savedStatus).toBeVisible();
	sendUnreadableResponse();
	await expect(recovery).toBeVisible();
	await expect(savedStatus).toHaveCount(0);
	await expect(page.getByText('Sauvegarde non confirmée · Vos derniers choix restent sur cet écran')).toBeVisible();
	const first = page.getByRole('radio', { name: fixture.content.questions[0].options[0].text, exact: true });
	const second = page.getByRole('radio', { name: fixture.content.questions[0].options[1].text, exact: true });
	await first.check();
	await expect.poll(() => saves.length).toBe(1);
	await second.check();
	broadcast({ ...view, revision: 1 });
	await expect(recovery).toBeVisible();
	await expect(second).toBeChecked();
	view = { ...view, revision: 3 };
	broadcast();
	await expect(recovery).toHaveCount(0);
	await expect(page.getByText('Enregistrement des réponses…', { exact: true })).toBeVisible();
	await expect(savedStatus).toHaveCount(0);
	await expect(second).toBeChecked();
	acknowledge(0);
	await expect.poll(() => saves.length).toBe(2);
	expect(saves[1].answers[0].optionIds).toEqual([fixture.content.questions[0].options[1].id]);
	sendUnreadableResponse();
	await expect(recovery).toBeVisible();
	acknowledge(1);
	await expect(recovery).toHaveCount(0);
	await expect(
		page.locator('[data-sonner-toast]').filter({ hasText: 'La réponse du serveur est illisible.' })
	).toHaveCount(0);
	await expect(savedStatus).toBeVisible();
	await expect(second).toBeChecked();
});

test('student keeps newer choices through ACKs and receives one ephemeral review', async ({ app, page }) => {
	const fixture = await app.call<NativeQuizFixture>('native-quiz-ui');
	const roomPath = `/api/quizzes/${fixture.contextId}/rooms/${fixture.runId}`;
	let joined = false;
	let channel: WebSocketRoute | null = null;
	let revision = 1;
	const saved: Extract<QuizSessionCommand, { type: 'save_answers' }>[] = [];
	let reviewRequests = 0;
	let fullscreenReports = 0;
	let view: QuizParticipantProjection = {
		id: fixture.runId,
		title: fixture.content.title,
		status: 'lobby',
		revision,
		serverNow: Date.now(),
		reviewAvailable: false,
		questions: [],
		participant: {
			...fixture.roster[0],
			status: 'lobby',
			connected: true,
			answerVersion: 0,
			startedAt: null,
			deadlineAt: null,
			extraSeconds: 0,
			points: null,
			incidents: { focus: 0, fullscreen: 0 },
			answers: []
		}
	};
	const broadcast = () => {
		view = { ...view, serverNow: Date.now() };
		channel?.send(JSON.stringify({ type: 'state', view }));
	};
	const disconnect = () => channel?.close();
	await page.route('**' + roomPath, async (route) => {
		if (route.request().method() === 'PUT') return route.fulfill({ json: { prepared: true } });
		if (route.request().method() === 'POST') {
			expect(route.request().postDataJSON()).toEqual({
				participantId: fixture.roster[0].id,
				fullscreenConfirmed: true
			});
			joined = true;
			await route.fulfill({ json: { joined: true } });
		} else
			await route.fulfill({
				json: {
					id: fixture.runId,
					title: fixture.content.title,
					status: view.status,
					roster: fixture.roster,
					joined
				}
			});
	});
	await page.routeWebSocket('**' + roomPath, (socket) => {
		channel = socket;
		broadcast();
		socket.onMessage((raw) => {
			if (raw === 'ping') {
				socket.send('pong');
				return;
			}
			const command = JSON.parse(String(raw)) as QuizSessionCommand;
			if (command.type === 'save_answers') saved.push(command);
			if (command.type === 'report_incident') {
				if (command.incident === 'fullscreen') fullscreenReports++;
				view = {
					...view,
					revision: ++revision,
					participant: {
						...view.participant,
						incidents: {
							...view.participant.incidents,
							[command.incident]: view.participant.incidents[command.incident] + 1
						}
					}
				};
				socket.send(
					JSON.stringify({
						type: 'ack',
						view,
						receipt: {
							requestId: command.requestId,
							type: command.type,
							sessionRevision: revision,
							receivedAt: Date.now(),
							participantId: fixture.roster[0].id
						}
					})
				);
			}
			if (command.type === 'submit') {
				expect(command.answerVersion).toBe(2);
				view = {
					...view,
					revision: ++revision,
					questions: [],
					participant: { ...view.participant, status: 'submitted' }
				};
				socket.send(
					JSON.stringify({
						type: 'ack',
						view,
						receipt: {
							requestId: command.requestId,
							type: command.type,
							sessionRevision: revision,
							receivedAt: Date.now(),
							participantId: fixture.roster[0].id
						}
					})
				);
			}
			if (command.type === 'consume_review') {
				reviewRequests++;
				const review: QuizSessionReview = {
					sessionId: fixture.runId,
					title: fixture.content.title,
					participant: fixture.roster[0],
					status: 'submitted',
					points: 0,
					maxPoints: fixture.content.questions.length,
					questions: fixture.content.questions.map((question, index) => ({
						...question,
						selectedOptionIds: index === 0 ? [question.options[1].id] : [],
						points: 0
					}))
				};
				view = { ...view, revision: ++revision, reviewAvailable: false };
				socket.send(
					JSON.stringify({
						type: 'ack',
						view,
						review,
						receipt: {
							requestId: command.requestId,
							type: command.type,
							sessionRevision: revision,
							receivedAt: Date.now(),
							participantId: fixture.roster[0].id
						}
					})
				);
				broadcast();
			}
		});
	});
	await page.goto(`${app.origin}/modules/${fixture.contextId}/quiz/${fixture.runId}`);
	const participant = page.getByLabel('Votre prénom et nom', { exact: true });
	await page.getByRole('button', { name: 'Passer en plein écran et rejoindre', exact: true }).click();
	await expect(participant).toHaveAttribute('aria-invalid', 'true');
	await expect(participant).toHaveAccessibleDescription(/Sélectionnez votre prénom et nom/);
	await expect(participant).toBeFocused();
	await expect(
		page.locator('[data-sonner-toast][data-type="error"]').filter({ hasText: 'Sélectionnez votre prénom et nom.' })
	).toBeVisible();
	expect(joined).toBe(false);
	await participant.selectOption(fixture.roster[0].id);
	await expect(participant).not.toHaveAttribute('aria-invalid', 'true');
	await page.getByRole('button', { name: 'Passer en plein écran et rejoindre', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Vous êtes dans la salle', exact: true })).toBeVisible();
	await page.evaluate(() => document.exitFullscreen());
	await expect.poll(() => fullscreenReports).toBe(1);
	await expect(page.getByText('Le plein écran est désactivé', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Revenir en plein écran', exact: true }).click();
	await expect(page.getByText('Le plein écran est désactivé', { exact: true })).toHaveCount(0);
	expect(fullscreenReports).toBe(1);
	view = {
		...view,
		status: 'running',
		revision: ++revision,
		serverNow: Date.now(),
		questions: projectQuizQuestions(fixture.content),
		participant: {
			...view.participant,
			status: 'active',
			startedAt: Date.now(),
			deadlineAt: Date.now() + 600_000
		}
	};
	broadcast();
	const first = page.getByRole('radio', {
		name: fixture.content.questions[0].options[0].text,
		exact: true
	});
	const second = page.getByRole('radio', {
		name: fixture.content.questions[0].options[1].text,
		exact: true
	});
	await first.check();
	await expect.poll(() => saved.length).toBe(1);
	await second.check();
	expect(saved).toHaveLength(1);
	const acknowledge = (index: number) => {
		const command = saved[index];
		view = {
			...view,
			revision: ++revision,
			serverNow: Date.now(),
			participant: { ...view.participant, answerVersion: command.version, answers: command.answers }
		};
		channel?.send(
			JSON.stringify({
				type: 'ack',
				view,
				receipt: {
					requestId: command.requestId,
					type: command.type,
					sessionRevision: revision,
					receivedAt: Date.now(),
					participantId: fixture.roster[0].id,
					answerVersion: command.version
				}
			})
		);
	};
	acknowledge(0);
	await expect(second).toBeChecked();
	await expect.poll(() => saved.length).toBe(2);
	expect(saved[1].answers[0].optionIds).toEqual([fixture.content.questions[0].options[1].id]);
	disconnect();
	await expect.poll(() => saved.length).toBe(3);
	expect(saved[2]).toEqual(saved[1]);
	await expect(second).toBeChecked();
	acknowledge(2);
	await expect(page.getByText('Réponses enregistrées', { exact: true })).toBeVisible();
	await expect(page.locator('pre code')).toHaveText(fixture.content.questions[0].code);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.getByRole('button', { name: 'Questions · 1/3', exact: true }).click();
	await page.getByRole('button', { name: 'Question 3 Sans réponse', exact: true }).click();
	await page.getByRole('button', { name: 'Vérifier mes réponses', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Vérifiez vos réponses', exact: true })).toBeFocused();
	await page.getByRole('button', { name: 'Remettre définitivement', exact: true }).click();
	await expect(page.getByRole('alertdialog')).toContainText('1 question répondue sur 3.');
	await page.getByRole('alertdialog').getByRole('button', { name: 'Remettre définitivement', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Vos réponses sont remises', exact: true })).toBeVisible();
	await expect(page.getByRole('alertdialog')).toBeHidden();
	await expect(page.getByText('1 question répondue sur 0.', { exact: false })).toHaveCount(0);
	view = {
		...view,
		status: 'closed',
		revision: ++revision,
		reviewAvailable: true,
		participant: { ...view.participant, answers: [] }
	};
	broadcast();
	await expect(page.getByRole('heading', { name: 'Votre correction', exact: true })).toBeVisible();
	const review = page.getByRole('region', { name: 'Votre correction', exact: true });
	const showFirst = review.getByRole('button', { name: 'Afficher la correction de la question 1', exact: true });
	const showSecond = review.getByRole('button', { name: 'Afficher la correction de la question 2', exact: true });
	const firstQuestion = review.getByRole('region', { name: fixture.content.questions[0].prompt, exact: true });
	const secondQuestion = review.getByRole('region', { name: fixture.content.questions[1].prompt, exact: true });
	const incorrectChoice = review.getByText('Votre choix · Réponse incorrecte', { exact: true });
	await expect(review.getByRole('heading', { level: 3 })).toHaveText(
		fixture.content.questions.map((question) => question.prompt)
	);
	await expect(review.getByRole('button', { name: /^Afficher la correction de la question/ })).toHaveCount(3);
	await expect(incorrectChoice).toHaveCount(0);
	await expect(review.getByText(/Bonne réponse/)).toHaveCount(0);
	await expect(review.getByText(/^\d+ \/ 1 point$/)).toHaveCount(0);
	await expect(review.getByText(`0 / ${fixture.content.questions.length}`, { exact: true })).toBeVisible();
	await expect(showFirst).toHaveAttribute('aria-expanded', 'false');
	expect(reviewRequests).toBe(1);
	await expect(page.getByRole('alertdialog')).toBeHidden();
	await expect(page.getByRole('heading', { name: 'Votre correction', exact: true })).toBeFocused();
	const skipLink = page.getByRole('link', { name: 'Aller au contenu', exact: true });
	await expect(skipLink).not.toBeInViewport();
	await skipLink.focus();
	await expect(skipLink).toBeInViewport();
	await page.getByRole('heading', { name: 'Votre correction', exact: true }).focus();
	await expect(skipLink).not.toBeInViewport();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.evaluate(async () => {
		if (document.fullscreenElement) await document.exitFullscreen();
	});
	await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
	await showFirst.click();
	await expect(incorrectChoice).toBeVisible();
	await expect(firstQuestion.getByText('Bonne réponse', { exact: true })).toBeVisible();
	await expect(firstQuestion.getByText('0 / 1 point', { exact: true })).toBeVisible();
	await expect(review.getByRole('button', { expanded: true })).toHaveCount(1);
	await showSecond.click();
	await expect(incorrectChoice).toHaveCount(0);
	await expect(firstQuestion.getByText('0 / 1 point', { exact: true })).toHaveCount(0);
	await expect(secondQuestion.getByText('Vous n’avez pas répondu à cette question.', { exact: true })).toBeVisible();
	const hideSecond = review.getByRole('button', { name: 'Masquer la correction de la question 2', exact: true });
	await hideSecond.focus();
	await hideSecond.press('Enter');
	await expect(showSecond).toBeFocused();
	await expect(showSecond).toHaveAttribute('aria-expanded', 'false');
	await showSecond.press('Space');
	await expect(hideSecond).toHaveAttribute('aria-expanded', 'true');
	await hideSecond.press('Space');
	await expect(review.getByRole('button', { expanded: true })).toHaveCount(0);
	await showFirst.click();
	await page.evaluate(() => window.dispatchEvent(new Event('blur')));
	await expect(incorrectChoice).toHaveCount(0);
	await expect(showFirst).toHaveAttribute('aria-expanded', 'false');
	await showFirst.click();
	await page.evaluate(() => {
		const descriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
		document.dispatchEvent(new Event('visibilitychange'));
		if (descriptor) Object.defineProperty(document, 'visibilityState', descriptor);
		else Reflect.deleteProperty(document, 'visibilityState');
		document.dispatchEvent(new Event('visibilitychange'));
	});
	await expect(incorrectChoice).toHaveCount(0);
	await expect(showFirst).toHaveAttribute('aria-expanded', 'false');
	await showFirst.click();
	await page.emulateMedia({ media: 'print' });
	await expect(incorrectChoice).toBeHidden();
	await expect(firstQuestion.getByText('0 / 1 point', { exact: true })).toBeHidden();
	await expect(
		review.getByRole('button', { name: 'Masquer la correction de la question 1', exact: true })
	).toBeHidden();
	await expect(review.getByText(`0 / ${fixture.content.questions.length}`, { exact: true })).toBeVisible();
	await page.emulateMedia({ media: 'screen' });
	await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
	await expect(incorrectChoice).toHaveCount(0);
	await showFirst.click();
	await expect(incorrectChoice).toBeVisible();
	expect(fullscreenReports).toBe(1);
	expect(reviewRequests).toBe(1);
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Quiz clôturé', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Votre correction', exact: true })).toHaveCount(0);
	expect(reviewRequests).toBe(1);
});

for (const capability of ['disabled', 'missing'] as const) {
	test(`a browser with fullscreen ${capability} can join without false fullscreen incidents`, async ({ app, page }) => {
		const fixture = await app.call<NativeQuizFixture>('native-quiz-ui');
		await page.addInitScript((capability) => {
			Object.defineProperty(document, 'fullscreenEnabled', { value: capability !== 'disabled' });
			if (capability === 'missing') Object.defineProperty(Element.prototype, 'requestFullscreen', { value: undefined });
		}, capability);
		const roomPath = `/api/quizzes/${fixture.contextId}/rooms/${fixture.runId}`;
		let claims = 0;
		let channel: WebSocketRoute | null = null;
		const incidents: string[] = [];
		const view: QuizParticipantProjection = {
			id: fixture.runId,
			title: fixture.content.title,
			status: 'lobby',
			revision: 1,
			serverNow: Date.now(),
			reviewAvailable: false,
			questions: [],
			participant: {
				...fixture.roster[0],
				status: 'lobby',
				connected: true,
				answerVersion: 0,
				startedAt: null,
				deadlineAt: null,
				extraSeconds: 0,
				points: null,
				incidents: { focus: 0, fullscreen: 0 },
				answers: []
			}
		};
		await page.route('**' + roomPath, async (route) => {
			if (route.request().method() === 'PUT') return route.fulfill({ json: { prepared: true } });
			if (route.request().method() === 'POST') {
				expect(route.request().postDataJSON()).toEqual({
					participantId: fixture.roster[0].id,
					fullscreenConfirmed: false
				});
				claims++;
				await route.fulfill({ json: { joined: true } });
				return;
			}
			await route.fulfill({
				json: {
					id: fixture.runId,
					title: fixture.content.title,
					status: 'lobby',
					roster: fixture.roster,
					joined: false
				}
			});
		});
		await page.routeWebSocket('**' + roomPath, (socket) => {
			channel = socket;
			socket.send(JSON.stringify({ type: 'state', view }));
			socket.onMessage((raw) => {
				if (raw === 'ping') {
					socket.send('pong');
					return;
				}
				const command = JSON.parse(String(raw)) as QuizSessionCommand;
				if (command.type === 'report_incident') incidents.push(command.incident);
			});
		});
		await page.goto(`${app.origin}/modules/${fixture.contextId}/quiz/${fixture.runId}`);
		const joinButton = page.getByRole('button', { name: 'Rejoindre la salle', exact: true });
		await expect(joinButton).toBeEnabled();
		await joinButton.click();
		await expect(page.getByLabel('Votre prénom et nom', { exact: true })).toHaveAttribute('aria-invalid', 'true');
		expect(claims).toBe(0);
		await page.getByLabel('Votre prénom et nom', { exact: true }).selectOption(fixture.roster[0].id);
		await joinButton.click();
		await expect(page.getByRole('heading', { name: 'Vous êtes dans la salle', exact: true })).toBeVisible();
		expect(claims).toBe(1);
		await expect(page.getByRole('button', { name: 'Revenir en plein écran', exact: true })).toHaveCount(0);
		await expect(page.getByText('Le plein écran est désactivé', { exact: true })).toHaveCount(0);
		await page.evaluate(() => window.dispatchEvent(new Event('blur')));
		await expect.poll(() => incidents.filter((incident) => incident === 'focus').length).toBe(1);
		expect(incidents).not.toContain('fullscreen');
		const at = Date.now();
		channel!.send(
			JSON.stringify({
				type: 'state',
				view: {
					...view,
					status: 'running',
					revision: 2,
					serverNow: at,
					questions: projectQuizQuestions(fixture.content),
					participant: { ...view.participant, status: 'active', startedAt: at, deadlineAt: at + 600_000 }
				}
			})
		);
		await expect(page.getByRole('radio').first()).toBeEnabled();
		await expect(page.getByRole('button', { name: 'Revenir en plein écran', exact: true })).toHaveCount(0);
		expect(incidents).not.toContain('fullscreen');
	});
}

test('the shared server deadline freezes input without revealing answers', async ({ app, page }) => {
	const fixture = await app.call<NativeQuizFixture>('native-quiz-ui');
	const roomPath = `/api/quizzes/${fixture.contextId}/rooms/${fixture.runId}`;
	await page.route('**' + roomPath, (route) =>
		route.fulfill({
			json: {
				id: fixture.runId,
				title: fixture.content.title,
				status: 'running',
				roster: [],
				joined: true
			}
		})
	);
	await page.routeWebSocket('**' + roomPath, (socket) => {
		const at = Date.now();
		const view: QuizParticipantProjection = {
			id: fixture.runId,
			title: fixture.content.title,
			status: 'running',
			revision: 1,
			serverNow: at,
			reviewAvailable: false,
			questions: projectQuizQuestions(fixture.content),
			participant: {
				...fixture.roster[0],
				status: 'active',
				connected: true,
				answerVersion: 0,
				startedAt: at - 599_000,
				deadlineAt: at + 1000,
				extraSeconds: 0,
				points: null,
				incidents: { focus: 0, fullscreen: 0 },
				answers: []
			}
		};
		socket.send(JSON.stringify({ type: 'state', view }));
	});
	await page.goto(`${app.origin}/modules/${fixture.contextId}/quiz/${fixture.runId}`);
	await expect(page.getByRole('heading', { name: 'Le temps est écoulé', exact: true })).toBeVisible();
	await expect(page.getByRole('radio')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Remettre définitivement', exact: true })).toHaveCount(0);
	await expect(page.getByText('Bonne réponse', { exact: true })).toHaveCount(0);
	await expect(page.getByRole('timer')).toHaveText('0 s');
});

test('public course history navigation isolates quiz rooms and ignores a previous context response', async ({
	app,
	page
}, testInfo) => {
	await activate(page, app);
	const publicationPath = `${app.origin}/api/teaching/modules/${app.ids.module}/publication`;
	const review = await page.request.get(`${publicationPath}?contexte=${app.ids.currentContext}`);
	expect(review.ok()).toBe(true);
	const selected = publicationReviewDataSchema.parse(await review.json()).selected!;
	const requestId = crypto.randomUUID();
	const published = await page.request.post(publicationPath, {
		headers: { Origin: app.origin, 'Idempotency-Key': requestId },
		data: {
			requestId,
			contextId: app.ids.currentContext,
			action: 'publish',
			expectedRevision: selected.publicationRevision,
			moduleRevision: selected.moduleRevision,
			contextRevision: selected.contextRevision,
			classRevision: selected.classRevision,
			confirm: true
		}
	});
	expect(published.ok()).toBe(true);
	const firstContext = app.ids.publicationContext;
	const secondContext = app.ids.currentContext;
	const room = (title: string) => ({
		id: crypto.randomUUID(),
		title,
		lessonId: crypto.randomUUID(),
		durationSeconds: 600,
		status: 'lobby',
		runId: crypto.randomUUID()
	});
	const firstRoom = room('Quiz du premier cours');
	const secondRoom = room('Quiz du deuxième cours');
	const delayedRoom = room('Ancienne réponse du premier cours');
	const oldResponse = Promise.withResolvers<void>();
	const nextResponse = Promise.withResolvers<void>();
	let firstRequests = 0;
	await page.route(`**/api/quizzes/${firstContext}`, async (route) => {
		firstRequests += 1;
		if (firstRequests === 2) {
			await oldResponse.promise;
			await route.fulfill({ json: [delayedRoom] });
		} else await route.fulfill({ json: [firstRoom] });
	});
	await page.route(`**/api/quizzes/${secondContext}`, async (route) => {
		await nextResponse.promise;
		await route.fulfill({ json: [secondRoom] });
	});
	const courseUrl = (contextId: string) => `${app.origin}/modules/${contextId}`;
	const section = page.getByRole('region', { name: 'Quiz en classe' });
	const openQuizSection = async () => {
		if (await section.isVisible()) return;
		if (testInfo.project.name === 'mobile') {
			const dialog = page.getByRole('dialog', { name: 'Contenu du cours' });
			await expect(async () => {
				await page.getByRole('button', { name: /^Changer de rubrique :/ }).click();
				await expect(dialog).toBeVisible({ timeout: 1000 });
			}).toPass();
			await dialog.getByRole('button', { name: 'Quiz', exact: true }).click();
			await expect(dialog).toHaveCount(0);
		} else {
			await expect(async () => {
				await page.getByRole('tab', { name: 'Quiz', exact: true }).click();
				await expect(section).toBeVisible({ timeout: 1000 });
			}).toPass();
		}
	};
	const expectRoom = async (contextId: string, currentRoom: ReturnType<typeof room>) => {
		await expect(page).toHaveURL(courseUrl(contextId));
		await expect(section.getByRole('link', { name: /Rejoindre/ })).toHaveCount(1);
		await expect(section.getByRole('link', { name: `Rejoindre ${currentRoom.title}` })).toHaveAttribute(
			'href',
			`/modules/${contextId}/quiz/${currentRoom.runId}`
		);
	};
	await page.goto(courseUrl(firstContext));
	await openQuizSection();
	await expectRoom(firstContext, firstRoom);
	const documentStartedAt = await page.evaluate(() => performance.timeOrigin);
	await section.getByRole('button', { name: 'Actualiser les salles', exact: true }).click();
	await expect.poll(() => firstRequests).toBe(2);
	await page.evaluate((href) => {
		const link = document.createElement('a');
		link.href = href;
		link.textContent = 'Open another fictional course';
		link.dataset.testid = 'course-history-navigation';
		document.querySelector('main')!.prepend(link);
	}, courseUrl(secondContext));
	await page.getByTestId('course-history-navigation').click();
	await expect(page).toHaveURL(courseUrl(secondContext));
	await expect(page.getByRole('heading', { name: firstRoom.title, exact: true })).toHaveCount(0);
	await page.evaluate(() => document.querySelector('[data-testid="course-history-navigation"]')?.remove());
	await openQuizSection();
	await expect(section.getByText('Recherche des salles ouvertes…')).toBeVisible();
	await expect(section.getByRole('link', { name: /Rejoindre/ })).toHaveCount(0);
	nextResponse.resolve();
	await expectRoom(secondContext, secondRoom);
	const delayed = page.waitForResponse((response) => response.url().endsWith(`/api/quizzes/${firstContext}`));
	oldResponse.resolve();
	await (await delayed).finished();
	await page.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
	);
	await expectRoom(secondContext, secondRoom);
	await expect(page.getByRole('heading', { name: delayedRoom.title, exact: true })).toHaveCount(0);

	await page.goBack();
	await expect(page).toHaveURL(courseUrl(firstContext));
	await expect(page.getByRole('heading', { name: secondRoom.title, exact: true })).toHaveCount(0);
	await openQuizSection();
	await expectRoom(firstContext, firstRoom);
	await page.goForward();
	await expect(page).toHaveURL(courseUrl(secondContext));
	await expect(page.getByRole('heading', { name: firstRoom.title, exact: true })).toHaveCount(0);
	await openQuizSection();
	await expectRoom(secondContext, secondRoom);
	expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentStartedAt);
});

test('course quiz section shows current rooms, retries errors and handles an empty list', async ({
	app,
	page
}, testInfo) => {
	const quizId = '9a7de9b8-1c76-4721-b144-f52bebd54d01';
	const lessonId = '9a7de9b8-1c76-4721-b144-f52bebd54d02';
	const runId = '9a7de9b8-1c76-4721-b144-f52bebd54d03';
	let response: 'empty' | 'error' | 'rooms' = 'empty';
	let secondRoomOpen = false;
	await page.route(`**/api/quizzes/${app.ids.publicationContext}`, (route) => {
		if (response === 'error') return route.fulfill({ status: 503, json: {} });
		return route.fulfill({
			json:
				response === 'empty'
					? []
					: [
							{
								id: quizId,
								title: 'Quiz ouvert',
								lessonId,
								durationSeconds: 600,
								status: secondRoomOpen ? 'locked' : 'lobby',
								runId: secondRoomOpen ? null : runId
							},
							{
								id: '9a7de9b8-1c76-4721-b144-f52bebd54d04',
								title: 'Quiz à venir',
								lessonId,
								durationSeconds: 60,
								status: secondRoomOpen ? 'lobby' : 'locked',
								runId: secondRoomOpen ? runId : null
							}
						]
		});
	});
	await page.goto(`${app.origin}/modules/${app.ids.publicationContext}`);
	await expect(page.getByRole('heading', { name: 'Quiz en classe' })).toHaveCount(0);
	if (testInfo.project.name === 'mobile') {
		const dialog = page.getByRole('dialog', { name: 'Contenu du cours' });
		await expect(async () => {
			await page.getByRole('button', { name: /^Changer de rubrique :/ }).click();
			await expect(dialog).toBeVisible({ timeout: 1000 });
		}).toPass();
		await dialog.getByRole('button', { name: 'Quiz', exact: true }).click();
		await expect(dialog).toHaveCount(0);
	} else {
		await page.getByRole('tab', { name: 'Quiz', exact: true }).click();
	}
	const section = page.getByRole('region', { name: 'Quiz en classe' });
	await expect(section).toBeVisible();
	await expect(section.getByText('Aucun quiz disponible pour le moment.')).toBeVisible();
	response = 'error';
	await section.getByRole('button', { name: 'Actualiser les salles' }).click();
	await expect(section.getByText(/Les salles de quiz sont indisponibles/)).toBeVisible();
	response = 'rooms';
	await section.getByRole('button', { name: 'Actualiser les salles' }).click();
	await expect(section.getByRole('heading', { name: 'Quiz ouvert' })).toBeVisible();
	await expect(section.getByText('Salle ouverte')).toBeVisible();
	await expect(section.getByText('En attente d’ouverture')).toBeVisible();
	await expect(section.getByText('En attente d’ouverture')).not.toHaveClass('sr-only');
	await expect(section.getByRole('link', { name: 'Rejoindre Quiz ouvert' })).toHaveAttribute(
		'href',
		`/modules/${app.ids.publicationContext}/quiz/${runId}`
	);
	await expect(section.getByRole('link', { name: /Rejoindre/ })).toHaveCount(1);
	const firstCard = section.getByRole('listitem').filter({ hasText: 'Quiz ouvert' }).locator('[data-content-card]');
	const secondCard = section.getByRole('listitem').filter({ hasText: 'Quiz à venir' }).locator('[data-content-card]');
	await expect(firstCard).toContainText('10 min');
	await expect(secondCard).toContainText('60 s');
	const activeBackground = await firstCard.evaluate((element) => getComputedStyle(element).backgroundColor);
	const unavailableBackground = await secondCard.evaluate((element) => getComputedStyle(element).backgroundColor);
	expect(activeBackground).not.toBe(unavailableBackground);
	secondRoomOpen = true;
	await section.getByRole('button', { name: 'Actualiser les salles' }).click();
	await expect(section.getByRole('link', { name: 'Rejoindre Quiz à venir' })).toBeVisible();
	await expect(section.getByRole('link', { name: 'Rejoindre Quiz ouvert' })).toHaveCount(0);
	await expect(firstCard).toHaveCSS('background-color', unavailableBackground);
	await expect(secondCard).toHaveCSS('background-color', activeBackground);
});

test('answer summary retains choices and gates final submission on saved connected answers', async ({
	page,
	app
}, info) => {
	const fixture = await app.call<NativeQuizFixture>('native-quiz-ui');
	const room = await mockStudentParticipation(page, fixture);
	const saves = () =>
		room.commands.filter(
			(command): command is Extract<QuizSessionCommand, { type: 'save_answers' }> => command.type === 'save_answers'
		);
	const submissions = () =>
		room.commands.filter(
			(command): command is Extract<QuizSessionCommand, { type: 'submit' }> => command.type === 'submit'
		);
	await page.goto(`${app.origin}/modules/${fixture.contextId}/quiz/${fixture.runId}`);
	await page.getByRole('radio', { name: fixture.content.questions[0].options[0].text, exact: true }).check();
	await expect.poll(() => saves().length).toBe(1);
	for (let index = 1; index < fixture.content.questions.length; index++)
		await page.getByRole('button', { name: 'Suivante', exact: true }).click();
	await page.screenshot({ path: info.outputPath('last-question-before-summary.png'), fullPage: true });
	await expect(page.getByRole('button', { name: 'Remettre définitivement', exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Vérifier mes réponses', exact: true }).click();
	const summary = page.getByRole('region', { name: 'Vérifiez vos réponses', exact: true });
	const title = summary.getByRole('heading', { name: 'Vérifiez vos réponses', exact: true });
	const submit = summary.getByRole('button', { name: 'Remettre définitivement', exact: true });
	await expect(title).toBeFocused();
	await expect(summary).toContainText('1 question répondue sur 3.');
	await expect(summary.getByRole('button', { name: 'Question 2 Sans réponse', exact: true })).toBeVisible();
	await expect(summary.getByRole('button', { name: 'Question 3 Sans réponse', exact: true })).toBeVisible();
	await expect(submit).toBeDisabled();
	expect(submissions()).toHaveLength(0);
	room.acknowledge(saves()[0]);
	await expect(submit).toBeEnabled();
	for (const colorScheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme });
		await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /dark/ : /^(?!.*dark)/);
		await page.screenshot({ path: info.outputPath(`answer-summary-${colorScheme}.png`), fullPage: true });
	}
	await summary.getByRole('button', { name: 'Question 2 Sans réponse', exact: true }).focus();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: fixture.content.questions[1].prompt, exact: true })).toBeFocused();
	await page.getByRole('button', { name: 'Précédente', exact: true }).click();
	await expect(
		page.getByRole('radio', { name: fixture.content.questions[0].options[0].text, exact: true })
	).toBeChecked();
	for (let index = 1; index < fixture.content.questions.length; index++)
		await page.getByRole('button', { name: 'Suivante', exact: true }).click();
	await page.getByRole('button', { name: 'Vérifier mes réponses', exact: true }).click();
	room.disconnect();
	await expect(submit).toBeDisabled();
	expect(submissions()).toHaveLength(0);
	await page.getByRole('button', { name: 'Reprendre la connexion', exact: true }).click();
	await expect(submit).toBeEnabled();
	await submit.click();
	const confirmation = page.getByRole('alertdialog');
	await expect(confirmation).toContainText('Les questions sans réponse valent zéro.');
	await confirmation.getByRole('button', { name: 'Continuer le quiz', exact: true }).click();
	await expect(confirmation).toBeHidden();
	await expect(submit).toBeFocused();
	expect(submissions()).toHaveLength(0);
	await submit.click();
	await confirmation.getByRole('button', { name: 'Remettre définitivement', exact: true }).click();
	await expect.poll(() => submissions().length).toBe(1);
	await expect(summary.getByRole('button', { name: 'Remise en cours…', exact: true })).toBeDisabled();
	await expect(summary.getByRole('button', { name: 'Revenir aux questions', exact: true })).toBeDisabled();
	expect(submissions()[0].answerVersion).toBe(saves()[0].version);
	room.acknowledge(submissions()[0], { status: 'submitted' });
	await expect(page.getByRole('heading', { name: 'Vos réponses sont remises', exact: true })).toBeFocused();
	await expect(summary).toHaveCount(0);
	expect(submissions()).toHaveLength(1);
});

test('answer summary preserves empty answers across expiration and renewed time before explicit submission', async ({
	page,
	app
}) => {
	const fixture = await app.call<NativeQuizFixture>('native-quiz-ui');
	const room = await mockStudentParticipation(page, fixture);
	const submissions = () =>
		room.commands.filter(
			(command): command is Extract<QuizSessionCommand, { type: 'submit' }> => command.type === 'submit'
		);
	await page.goto(`${app.origin}/modules/${fixture.contextId}/quiz/${fixture.runId}`);
	for (let index = 1; index < fixture.content.questions.length; index++)
		await page.getByRole('button', { name: 'Suivante', exact: true }).click();
	await page.getByRole('button', { name: 'Vérifier mes réponses', exact: true }).click();
	const summary = page.getByRole('region', { name: 'Vérifiez vos réponses', exact: true });
	await expect(summary).toContainText('0 question répondue sur 3.');
	await expect(summary.getByRole('button', { name: /^Question [123] Sans réponse$/ })).toHaveCount(3);
	await expect(summary.getByRole('button', { name: 'Remettre définitivement', exact: true })).toBeEnabled();
	expect(submissions()).toHaveLength(0);
	room.publish({ deadlineAt: Date.now() + 500 });
	await expect(page.getByRole('heading', { name: 'Le temps est écoulé', exact: true })).toBeFocused();
	await expect(summary).toHaveCount(0);
	expect(submissions()).toHaveLength(0);
	room.publish({ deadlineAt: Date.now() + 600_000, extraSeconds: 600 });
	await expect(summary.getByRole('heading', { name: 'Vérifiez vos réponses', exact: true })).toBeFocused();
	await expect(summary).toContainText('0 question répondue sur 3.');
	await summary.getByRole('button', { name: 'Revenir aux questions', exact: true }).click();
	await expect(page.getByRole('heading', { name: fixture.content.questions[2].prompt, exact: true })).toBeFocused();
	await page.getByRole('button', { name: 'Vérifier mes réponses', exact: true }).click();
	await summary.getByRole('button', { name: 'Remettre définitivement', exact: true }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Remettre définitivement', exact: true }).click();
	await expect.poll(() => submissions().length).toBe(1);
	expect(submissions()[0].answerVersion).toBe(0);
	expect(room.commands.filter((command) => command.type === 'save_answers')).toHaveLength(0);
	room.acknowledge(submissions()[0], { status: 'submitted' });
	await expect(page.getByRole('heading', { name: 'Vos réponses sont remises', exact: true })).toBeFocused();
});

test('four-option personal review keeps a two-column grid and collapses on screenshot shortcuts', async ({
	page,
	app
}, info) => {
	const fixture = await app.call<NativeQuizFixture>('native-quiz-ui');
	const room = await mockStudentParticipation(page, fixture, true);
	const reviewRequests = () =>
		room.commands.filter(
			(command): command is Extract<QuizSessionCommand, { type: 'consume_review' }> => command.type === 'consume_review'
		);
	const original = fixture.content.questions[0];
	const options = [
		...original.options,
		{
			id: crypto.randomUUID(),
			text: 'Un choix fictif plus long qui doit rester entièrement lisible dans la correction.'
		},
		{ id: crypto.randomUUID(), text: 'LongUnbrokenFictionalAnswerForResponsiveLayoutVerification1234567890' }
	];
	const review: QuizSessionReview = {
		sessionId: fixture.runId,
		title: fixture.content.title,
		participant: fixture.roster[0],
		status: 'submitted',
		points: 0,
		maxPoints: 3,
		questions: fixture.content.questions.map((question, index) => ({
			...question,
			...(index === 0 ? { options } : {}),
			selectedOptionIds: index === 0 ? [question.options[1].id] : [],
			points: 0
		}))
	};
	await page.goto(`${app.origin}/modules/${fixture.contextId}/quiz/${fixture.runId}`);
	await expect.poll(() => reviewRequests().length).toBe(1);
	room.acknowledge(reviewRequests()[0], {}, review);
	const region = page.getByRole('region', { name: 'Votre correction', exact: true });
	const question = region.getByRole('region', { name: original.prompt, exact: true });
	const show = region.getByRole('button', { name: 'Afficher la correction de la question 1', exact: true });
	const hidden = () => region.getByRole('button', { name: 'Masquer la correction de la question 1', exact: true });
	await expect(region.getByRole('heading', { name: 'Votre correction', exact: true })).toBeFocused();
	await show.focus();
	await page.keyboard.press('Enter');
	await expect(hidden()).toBeFocused();
	for (const width of info.project.name === 'mobile' ? [320, 390] : [1440]) {
		await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme });
			await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /dark/ : /^(?!.*dark)/);
			await page.screenshot({ path: info.outputPath(`review-grid-${width}-${colorScheme}.png`), fullPage: true });
			const choices = question.locator('.review-option');
			await expect(choices).toHaveCount(4);
			const boxes = await choices.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
			expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThanOrEqual(1);
			expect(Math.abs(boxes[2].y - boxes[3].y)).toBeLessThanOrEqual(1);
			expect(Math.abs(boxes[0].x - boxes[2].x)).toBeLessThanOrEqual(1);
			expect(Math.abs(boxes[1].x - boxes[3].x)).toBeLessThanOrEqual(1);
			expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
			expect(boxes[2].y).toBeGreaterThan(boxes[0].y);
			for (const option of options) await expect(question.getByText(option.text, { exact: true })).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
		}
	}
	await hidden().focus();
	await page.keyboard.press('Space');
	await expect(show).toBeFocused();
	await page.keyboard.press('Space');
	await expect(hidden()).toBeFocused();
	const unrelated = await page.evaluate(() => {
		const events = [
			new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, bubbles: true, cancelable: true }),
			new KeyboardEvent('keydown', { key: 'Shift', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }),
			new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true })
		];
		return events.map((event) => ({ dispatched: window.dispatchEvent(event), prevented: event.defaultPrevented }));
	});
	expect(unrelated).toEqual([
		{ dispatched: true, prevented: false },
		{ dispatched: true, prevented: false },
		{ dispatched: true, prevented: false }
	]);
	await expect(hidden()).toHaveAttribute('aria-expanded', 'true');
	await page.keyboard.press('Tab');
	await page.keyboard.press('Shift+Tab');
	await expect(hidden()).toBeFocused();
	for (const shortcut of [
		{ key: 'S', code: 'KeyS', metaKey: true, shiftKey: true },
		{ key: 'PrintScreen', code: 'PrintScreen' }
	]) {
		const eventResult = await page.evaluate((shortcut) => {
			const event = new KeyboardEvent('keydown', { ...shortcut, bubbles: true, cancelable: true });
			return { dispatched: window.dispatchEvent(event), prevented: event.defaultPrevented };
		}, shortcut);
		expect(eventResult).toEqual({ dispatched: true, prevented: false });
		await expect(show).toHaveAttribute('aria-expanded', 'false');
		await expect(question.locator('.review-option')).toHaveCount(0);
		await show.click();
		await expect(hidden()).toHaveAttribute('aria-expanded', 'true');
		expect(reviewRequests()).toHaveLength(1);
	}
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Quiz clôturé', exact: true })).toBeVisible();
	await expect(region).toHaveCount(0);
	expect(reviewRequests()).toHaveLength(1);
});

for (const ending of ['online', 'offline', 'after suspension'] as const) {
	test(`personal review expires after fifteen minutes ${ending}`, async ({ page, context, app }, info) => {
		const fixture = await app.call<NativeQuizFixture>('native-quiz-ui');
		const room = await mockStudentParticipation(page, fixture, true);
		const review: QuizSessionReview = {
			sessionId: fixture.runId,
			title: fixture.content.title,
			participant: fixture.roster[0],
			status: 'submitted',
			points: 0,
			maxPoints: 3,
			questions: fixture.content.questions.map((question) => ({ ...question, selectedOptionIds: [], points: 0 }))
		};
		await page.clock.install({ time: new Date('2030-01-01T12:00:00Z') });
		await page.clock.pauseAt(new Date('2030-01-01T12:00:01Z'));
		await page.goto(`${app.origin}/modules/${fixture.contextId}/quiz/${fixture.runId}`);
		await expect.poll(() => room.commands.filter((command) => command.type === 'consume_review').length).toBe(1);
		const consume = room.commands.find((command) => command.type === 'consume_review')!;
		room.acknowledge(consume, {}, review);
		const region = page.getByRole('region', { name: 'Votre correction', exact: true });
		await expect(region).toBeVisible();
		const timer = region.getByRole('timer');
		await expect(timer).toHaveText('15 min');
		await expect(region).toContainText('Retour automatique au module à la fin du temps.');
		await page.getByRole('button', { name: 'Afficher la correction de la question 1', exact: true }).click();
		const moduleUrl = `${app.origin}/modules/${fixture.contextId}`;
		const failedNavigations: string[] = [];
		if (ending === 'offline') {
			page.on('requestfailed', (request) => {
				if (request.isNavigationRequest() && request.url() === moduleUrl) failedNavigations.push(request.url());
			});
			await context.setOffline(true);
		} else {
			await page.evaluate(() => {
				window.addEventListener(
					'beforeunload',
					() =>
						sessionStorage.setItem('review-cleared-before-navigation', String(!document.querySelector('.quiz-review'))),
					{ once: true }
				);
			});
			await page.route(moduleUrl, async (route) => {
				if (!route.request().isNavigationRequest()) return route.abort();
				await route.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>Accueil du module fictif</h1>' });
			});
		}
		if (ending === 'after suspension') {
			await page.evaluate(() => window.dispatchEvent(new Event('blur')));
			await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + 2 * 24 * 60 * 60 * 1000);
			await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
		} else {
			await page.clock.fastForward(5 * 60 * 1000);
			await expect(timer).toHaveText('10 min');
			await page.evaluate(() => window.dispatchEvent(new Event('blur')));
			await page.getByRole('button', { name: 'Afficher la correction de la question 1', exact: true }).click();
			await expect(timer).toHaveText('10 min');
			if (ending === 'online') {
				await page.screenshot({ path: info.outputPath('personal-review-timer.png'), fullPage: true });
				await page.clock.setSystemTime((await page.evaluate(() => Date.now())) - 60 * 60 * 1000);
			}
			await page.clock.fastForward(10 * 60 * 1000 - 1000);
			await expect(timer).toHaveText('1 s');
			await page.clock.fastForward(1000);
		}
		await expect(region).toHaveCount(0);
		if (ending === 'offline') {
			await expect.poll(() => failedNavigations.length).toBe(1);
			await expect(page).not.toHaveURL(`${app.origin}/modules/${fixture.contextId}/quiz/${fixture.runId}`);
		} else {
			await expect(page).toHaveURL(moduleUrl);
			await expect(page.getByRole('heading', { name: 'Accueil du module fictif' })).toBeVisible();
			expect(await page.evaluate(() => sessionStorage.getItem('review-cleared-before-navigation'))).toBe('true');
		}
		expect(room.commands.filter((command) => command.type === 'consume_review')).toHaveLength(1);
	});
}
