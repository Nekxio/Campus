import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { cpuUsage } from 'node:process';
import type { QuizAnswers, QuizContent } from './quiz-content.js';
import {
	applyQuizSessionCommand,
	createQuizRetakeSession,
	createQuizSession,
	expireQuizSession,
	getQuizSessionDeadline,
	projectQuizSessionForParticipant,
	projectQuizSessionForTeacher,
	quizSessionCommandSchema,
	type QuizSessionActor,
	type QuizSessionCommand,
	type QuizSessionState
} from './quiz-session.js';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const teacher = { kind: 'teacher' } as const;
const student = (
	participantId = id(1),
	connectionId = id(100)
): Extract<QuizSessionActor, { kind: 'participant' }> => ({
	kind: 'participant',
	participantId,
	credentialHash: (participantId === id(1) ? 'a' : 'b').repeat(64),
	connectionId
});

const content = (): QuizContent => ({
	version: 1,
	title: 'Fictional quiz',
	durationSeconds: 60,
	questions: [
		{
			id: id(10),
			type: 'single',
			prompt: 'First question',
			code: '',
			codeLanguage: '',
			options: [
				{ id: id(11), text: 'Correct' },
				{ id: id(12), text: 'Incorrect' }
			],
			correctOptionIds: [id(11)]
		},
		{
			id: id(20),
			type: 'multiple',
			prompt: 'Second question',
			code: 'const answer = 42;',
			codeLanguage: 'typescript',
			options: [
				{ id: id(21), text: 'First correct' },
				{ id: id(22), text: 'Second correct' },
				{ id: id(23), text: 'Incorrect' }
			],
			correctOptionIds: [id(21), id(22)]
		}
	]
});
const correctAnswers = (): QuizAnswers => [
	{ questionId: id(10), optionIds: [id(11)] },
	{ questionId: id(20), optionIds: [id(21), id(22)] }
];
const session = () =>
	createQuizSession({
		id: id(200),
		content: content(),
		roster: [
			{ id: id(1), name: 'First student' },
			{ id: id(2), name: 'Absent student' }
		],
		shuffleSeed: 'server-generated-seed',
		createdAt: 0
	});
type CommandInput = {
	[Type in QuizSessionCommand['type']]: Omit<Extract<QuizSessionCommand, { type: Type }>, 'requestId'>;
}[QuizSessionCommand['type']];
let requestNumber = 1000;
const command = <Input extends CommandInput>(input: Input): Input & { requestId: string } => ({
	...input,
	requestId: id(requestNumber++)
});
const apply = (state: QuizSessionState, actor: QuizSessionActor, input: CommandInput, now = 1000) =>
	applyQuizSessionCommand(state, actor, command(input), now);
const joined = () => apply(session(), student(), { type: 'join' }).state;
const started = () => apply(joined(), teacher, { type: 'start' }, 10000).state;
const saved = (answers = correctAnswers()) =>
	apply(
		started(),
		student(),
		{
			type: 'save_answers',
			version: 1,
			answers
		},
		11000
	).state;
const participant = (state: QuizSessionState, participantId = id(1)) => {
	const value = state.participants.find((value) => value.id === participantId);
	if (!value) throw new Error('Missing fictional participant.');
	return value;
};
const evictGeneralReceipt = (state: QuizSessionState, requestId: string) => {
	let crowded = state;
	const extraSeconds = participant(state, id(2)).extraSeconds;
	for (let index = 0; index < 140; index++)
		crowded = apply(
			crowded,
			teacher,
			{
				type: 'add_time',
				participantId: id(2),
				seconds: 1,
				expectedExtraSeconds: extraSeconds + index
			},
			state.updatedAt + index + 1
		).state;
	expect(crowded.receipts.some((entry) => entry.receipt.requestId === requestId)).toBe(false);
	const persisted: QuizSessionState = JSON.parse(JSON.stringify(crowded));
	return persisted;
};

describe('Authoritative graded quiz sessions', () => {
	it('freezes content and the complete expected cohort without retaining mutable input references', () => {
		const input = {
			id: id(200),
			content: content(),
			roster: [{ id: id(1), name: 'First student' }],
			shuffleSeed: 'seed',
			createdAt: 0
		};
		const state = createQuizSession(input);
		input.content.questions[0].correctOptionIds[0] = id(12);
		input.roster[0].name = 'Changed';
		expect(state.content.questions[0].correctOptionIds).toEqual([id(11)]);
		expect(state.participants.map(({ id, name, status }) => ({ id, name, status }))).toEqual([
			{ id: id(1), name: 'First student', status: 'not_joined' }
		]);
		expect(JSON.parse(JSON.stringify(state))).toEqual(state);
	});

	it('reveals no question before start and starts all lobby participants at the server instant', () => {
		const lobby = joined();
		expect(projectQuizSessionForParticipant(lobby, student(), 9000).questions).toEqual([]);
		const state = apply(lobby, teacher, { type: 'start' }, 10000).state;
		expect(participant(state)).toMatchObject({
			status: 'active',
			startedAt: 10000,
			deadlineAt: 70000
		});
		expect(participant(state, id(2)).status).toBe('not_joined');
		expect(getQuizSessionDeadline(state)).toBe(70000);
		expect(lobby.status).toBe('lobby');
	});

	it('requires explicit teacher admission for late participants and retains the common deadline', () => {
		const waiting = apply(started(), student(id(2), id(101)), { type: 'join' }, 20000).state;
		expect(participant(waiting, id(2))).toMatchObject({
			status: 'awaiting_admission',
			deadlineAt: null
		});
		expect(projectQuizSessionForParticipant(waiting, student(id(2), id(101)), 20000).questions).toEqual([]);
		expect(() =>
			apply(waiting, student(id(2), id(101)), { type: 'save_answers', version: 1, answers: [] }, 20001)
		).toThrow();
		const admitted = apply(waiting, teacher, { type: 'admit_late', participantId: id(2) }, 30000).state;
		expect(participant(admitted, id(2))).toMatchObject({
			status: 'active',
			startedAt: 30000,
			deadlineAt: 70000
		});
	});

	it('requires sufficient individual extra time to admit a late participant after the common deadline', () => {
		const late = apply(started(), student(id(2), id(101)), { type: 'join' }, 80000).state;
		expect(() => apply(late, teacher, { type: 'admit_late', participantId: id(2) }, 80000)).toThrow();
		const extended = apply(
			late,
			teacher,
			{ type: 'add_time', participantId: id(2), seconds: 30, expectedExtraSeconds: 0 },
			80000
		).state;
		const admitted = apply(extended, teacher, { type: 'admit_late', participantId: id(2) }, 81000).state;
		expect(participant(admitted, id(2))).toMatchObject({
			status: 'active',
			startedAt: 81000,
			deadlineAt: 100000,
			extraSeconds: 30
		});
	});
	it.each([-1, 0, 1])('admits a late participant only before the common deadline at offset %i', (offset) => {
		const waiting = apply(started(), student(id(2), id(101)), { type: 'join' }, 20000).state;
		const original = structuredClone(waiting);
		if (offset < 0) {
			const admitted = apply(waiting, teacher, { type: 'admit_late', participantId: id(2) }, 70000 + offset);
			expect(participant(admitted.state, id(2))).toMatchObject({
				status: 'active',
				startedAt: 69999,
				deadlineAt: 70000
			});
		} else {
			expect(() => apply(waiting, teacher, { type: 'admit_late', participantId: id(2) }, 70000 + offset)).toThrowError(
				expect.objectContaining({ code: 'invalid_state' })
			);
		}
		expect(waiting).toEqual(original);
	});
	it('rejects admitting an active late participant again without resetting saved work or timing', () => {
		const actor = student(id(2), id(101));
		const waiting = apply(started(), actor, { type: 'join' }, 20000).state;
		const admitted = apply(waiting, teacher, { type: 'admit_late', participantId: id(2) }, 30000).state;
		const answered = apply(
			admitted,
			actor,
			{ type: 'save_answers', version: 1, answers: correctAnswers() },
			31000
		).state;
		const original = structuredClone(answered);
		expect(() => apply(answered, teacher, { type: 'admit_late', participantId: id(2) }, 40000)).toThrowError(
			expect.objectContaining({ code: 'invalid_state' })
		);
		expect(answered).toEqual(original);
	});

	it('releases a suspicious lobby claim while permanently revoking that access within this session', () => {
		const lobby = joined();
		const released = apply(lobby, teacher, { type: 'remove_lobby', participantId: id(1) }).state;
		expect(participant(released)).toMatchObject({
			status: 'not_joined',
			credentialHash: null,
			connectionId: null,
			connected: false
		});
		expect(released.participants.map((participant) => participant.id)).toEqual([id(1), id(2)]);
		expect(() => apply(released, student(), { type: 'join' })).toThrow();
		expect(() => apply(released, student(), { type: 'reconnect' })).toThrow();
		expect(() => apply(released, { ...student(), participantId: id(2) }, { type: 'join' })).toThrow();
		const rightfulStudent = {
			...student(id(1), id(103)),
			credentialHash: 'c'.repeat(64)
		} as QuizSessionActor;
		expect(participant(apply(released, rightfulStudent, { type: 'join' }).state)).toMatchObject({
			status: 'lobby',
			credentialHash: 'c'.repeat(64)
		});
		expect(() => apply(started(), teacher, { type: 'remove_lobby', participantId: id(1) })).toThrow();
	});

	it('revokes a late claim awaiting admission without disturbing active participants', () => {
		const lateActor = student(id(2), id(101));
		const waiting = apply(started(), lateActor, { type: 'join' }, 20000).state;
		const active = structuredClone(participant(waiting));
		const released = apply(waiting, teacher, { type: 'remove_lobby', participantId: id(2) }, 21000).state;
		expect(participant(released, id(2))).toMatchObject({
			status: 'not_joined',
			credentialHash: null,
			connectionId: null,
			connected: false
		});
		expect(participant(released)).toEqual(active);
		expect(() => apply(released, lateActor, { type: 'join' }, 22000)).toThrow();
	});

	it('applies individual extra time granted in the lobby when the quiz starts', () => {
		const extended = apply(
			joined(),
			teacher,
			{ type: 'add_time', participantId: id(1), seconds: 30, expectedExtraSeconds: 0 },
			9000
		).state;
		expect(participant(extended)).toMatchObject({ status: 'lobby', extraSeconds: 30, deadlineAt: null });
		const running = apply(extended, teacher, { type: 'start' }, 10000).state;
		expect(participant(running)).toMatchObject({ status: 'active', extraSeconds: 30, deadlineAt: 100000 });
	});

	it('updates the expected class roster before start while preserving existing claims and shuffled work', () => {
		const lobby = joined();
		const updated = apply(lobby, teacher, {
			type: 'set_roster',
			roster: [
				{ id: id(1), name: 'Renamed student' },
				{ id: id(3), name: 'Arriving student' }
			],
			shuffleSeed: 'injected-roster-seed'
		}).state;
		expect(updated.participants.map(({ id, name }) => ({ id, name }))).toEqual([
			{ id: id(1), name: 'Renamed student' },
			{ id: id(3), name: 'Arriving student' }
		]);
		expect(participant(updated)).toMatchObject({
			credentialHash: 'a'.repeat(64),
			questionOrder: participant(lobby).questionOrder,
			optionOrder: participant(lobby).optionOrder
		});
		expect(participant(updated, id(3))).toMatchObject({ status: 'not_joined', points: null });
		expect(() => apply(updated, student(id(2), id(101)), { type: 'join' })).toThrow();
		expect(() =>
			apply(apply(updated, teacher, { type: 'start' }).state, teacher, {
				type: 'set_roster',
				roster: [{ id: id(1), name: 'Student' }],
				shuffleSeed: 'seed'
			})
		).toThrow();
	});
	it('revokes a removed roster claim before its credential can claim another expected student', () => {
		const removedActor = student(id(2), id(101));
		const claimed = apply(session(), removedActor, { type: 'join' }).state;
		const refreshed = apply(claimed, teacher, {
			type: 'set_roster',
			roster: [{ id: id(1), name: 'First student' }],
			shuffleSeed: 'refreshed-roster'
		}).state;
		const persisted: QuizSessionState = JSON.parse(JSON.stringify(refreshed));
		const original = structuredClone(persisted);
		const reusedActor = { ...student(), credentialHash: removedActor.credentialHash };
		expect(() => apply(persisted, reusedActor, { type: 'join' })).toThrowError(
			expect.objectContaining({ code: 'credentials_conflict' })
		);
		expect(persisted).toEqual(original);
		expect(participant(apply(persisted, student(), { type: 'join' }).state)).toMatchObject({
			status: 'lobby',
			credentialHash: student().credentialHash
		});
	});

	it('removes a definitive departure only from this run expected cohort and preserves its private answers', () => {
		const state = saved();
		const removed = apply(state, teacher, { type: 'remove_expected', participantId: id(1) }, 12000).state;
		expect(removed.participants.map((participant) => participant.id)).toEqual([id(2)]);
		expect(removed.excludedParticipants).toHaveLength(1);
		expect(removed.excludedParticipants[0]).toMatchObject({
			id: id(1),
			answers: correctAnswers(),
			connected: false
		});
		expect(() => projectQuizSessionForParticipant(removed, student(), 12000)).toThrow();
		expect(() => apply(removed, student(), { type: 'reconnect' }, 12000)).toThrow();
		const closed = apply(removed, teacher, { type: 'close' }, 13000).state;
		expect(closed.participants.map(({ id, points }) => ({ id, points }))).toEqual([{ id: id(2), points: 0 }]);
		expect(() => apply(joined(), teacher, { type: 'remove_expected', participantId: id(1) })).toThrow();
		expect(session().participants).toHaveLength(2);
	});

	it('keeps shuffled questions and options stable through serialization and reconnection', () => {
		const state = started();
		const first = projectQuizSessionForParticipant(state, student(), 12000);
		const reconnected = apply(
			JSON.parse(JSON.stringify(state)),
			student(id(1), id(102)),
			{ type: 'reconnect' },
			13000
		).state;
		const second = projectQuizSessionForParticipant(reconnected, student(id(1), id(102)), 14000);
		expect(second.questions).toEqual(first.questions);
		expect(first.questions.map((question) => question.id).sort()).toEqual([id(10), id(20)]);
		expect(first.questions.flatMap((question) => question.options.map((option) => option.id)).sort()).toEqual([
			id(11),
			id(12),
			id(21),
			id(22),
			id(23)
		]);
		expect(JSON.stringify(first)).not.toContain('correctOptionIds');
		expect(JSON.stringify(first)).not.toContain('credentialHash');
	});

	it('rejects stolen roster identities and obsolete connections while accepting the same bound credential', () => {
		const state = started();
		const stolen = { ...student(), credentialHash: 'c'.repeat(64) } as QuizSessionActor;
		expect(() => apply(state, stolen, { type: 'join' }, 12000)).toThrow();
		const reconnected = apply(state, student(id(1), id(102)), { type: 'reconnect' }, 13000).state;
		expect(() => projectQuizSessionForParticipant(reconnected, student(), 14000)).toThrow();
		expect(() => apply(reconnected, student(), { type: 'save_answers', version: 1, answers: [] }, 14000)).toThrow();
		expect(projectQuizSessionForParticipant(reconnected, student(id(1), id(102)), 14000).participant.status).toBe(
			'active'
		);
	});
	it.each(['lobby', 'awaiting_admission'] as const)(
		'permits a fresh join request from the same bound %s identity',
		(status) => {
			const actor = status === 'lobby' ? student() : student(id(2), id(101));
			const waiting = status === 'lobby' ? joined() : apply(started(), actor, { type: 'join' }, 20000).state;
			const original = structuredClone(waiting);
			const repeated = apply(waiting, actor, { type: 'join' }, waiting.updatedAt + 1);
			expect(participant(repeated.state, actor.participantId)).toEqual(participant(waiting, actor.participantId));
			expect(repeated.state.revision).toBeGreaterThan(waiting.revision);
			expect(repeated.receipt.sessionRevision).toBe(repeated.state.revision);
			expect(waiting).toEqual(original);
		}
	);
	it('rejects a fresh join request after an attempt starts without replacing its saved work', () => {
		const state = saved();
		const original = structuredClone(state);
		expect(() => apply(state, student(), { type: 'join' }, 12000)).toThrowError(
			expect.objectContaining({ code: 'invalid_state' })
		);
		expect(state).toEqual(original);
	});
	it('permits reconnecting on the existing connection without changing the attempt', () => {
		const state = saved();
		const original = structuredClone(state);
		const reconnected = apply(state, student(), { type: 'reconnect' }, 12000);
		expect(participant(reconnected.state)).toEqual(participant(state));
		expect(state).toEqual(original);
	});
	it('rejects reconnecting to an unclaimed roster identity without creating a claim', () => {
		const state = session();
		const original = structuredClone(state);
		expect(() => apply(state, student(), { type: 'reconnect' })).toThrowError(
			expect.objectContaining({ code: 'credentials_conflict' })
		);
		expect(state).toEqual(original);
	});
	it('binds a cached reconnect receipt to its original connection', () => {
		const reconnect = command({ type: 'reconnect' });
		const actor = student(id(1), id(102));
		const accepted = applyQuizSessionCommand(saved(), actor, reconnect, 12000);
		const original = structuredClone(accepted.state);
		expect(() => applyQuizSessionCommand(accepted.state, student(id(1), id(103)), reconnect, 13000)).toThrowError(
			expect.objectContaining({ code: 'request_conflict' })
		);
		expect(accepted.state).toEqual(original);
		expect(applyQuizSessionCommand(accepted.state, actor, reconnect, 13000).receipt).toEqual(accepted.receipt);
	});
	it.each(['credential', 'connection'] as const)(
		"rejects a new participant reusing another participant's %s",
		(identity) => {
			const state = joined();
			const original = structuredClone(state);
			const actor = {
				...student(id(2), id(101)),
				...(identity === 'credential'
					? { credentialHash: student().credentialHash }
					: { connectionId: student().connectionId })
			};
			expect(() => apply(state, actor, { type: 'join' }, 2000)).toThrowError(
				expect.objectContaining({ code: 'credentials_conflict' })
			);
			expect(state).toEqual(original);
		}
	);
	it('rejects reconnecting with the connection already bound to another participant', () => {
		const state = apply(joined(), student(id(2), id(101)), { type: 'join' }, 2000).state;
		const original = structuredClone(state);
		expect(() => apply(state, student(id(1), id(101)), { type: 'reconnect' }, 3000)).toThrowError(
			expect.objectContaining({ code: 'connection_conflict' })
		);
		expect(state).toEqual(original);
	});
	it.each(['body', 'actor'] as const)('rejects reusing a cached request ID with a different %s', (difference) => {
		const lobby = apply(joined(), student(id(2), id(101)), { type: 'join' }, 2000).state;
		const running = apply(lobby, teacher, { type: 'start' }, 10000).state;
		const report = command({ type: 'report_incident', incident: 'focus' });
		const accepted = applyQuizSessionCommand(running, student(), report, 11000).state;
		const original = structuredClone(accepted);
		const actor = difference === 'actor' ? student(id(2), id(101)) : student();
		const retried = difference === 'body' ? { ...report, incident: 'fullscreen' as const } : report;
		expect(() => applyQuizSessionCommand(accepted, actor, retried, 12000)).toThrowError(
			expect.objectContaining({ code: 'request_conflict' })
		);
		expect(accepted).toEqual(original);
	});

	it('acknowledges full answer snapshots, permits edits and refuses delayed or conflicting versions', () => {
		const state = started();
		const save = command({ type: 'save_answers', version: 1, answers: correctAnswers() });
		const accepted = applyQuizSessionCommand(state, student(), save, 11000);
		expect(accepted.receipt).toMatchObject({
			type: 'save_answers',
			answerVersion: 1,
			requestId: save.requestId
		});
		expect(accepted.state.participants[0].answers).toEqual(correctAnswers());
		const duplicate = applyQuizSessionCommand(accepted.state, student(), save, 12000);
		expect(duplicate.receipt).toEqual(accepted.receipt);
		expect(duplicate.state).toEqual(accepted.state);
		const edited = apply(accepted.state, student(), { type: 'save_answers', version: 3, answers: [] }, 13000).state;
		expect(participant(edited)).toMatchObject({ answerVersion: 3, answers: [] });
		expect(() =>
			apply(edited, student(), { type: 'save_answers', version: 2, answers: correctAnswers() }, 14000)
		).toThrow();
		expect(() =>
			apply(edited, student(), { type: 'save_answers', version: 3, answers: correctAnswers() }, 14000)
		).toThrow();
		expect(participant(state).answers).toEqual([]);
	});

	it('replays an acknowledged save and submission after reconnecting with the bound credential', () => {
		const save = command({ type: 'save_answers', version: 1, answers: correctAnswers() });
		const accepted = applyQuizSessionCommand(started(), student(), save, 11000);
		const reconnectedActor = student(id(1), id(102));
		const reconnected = apply(accepted.state, reconnectedActor, { type: 'reconnect' }, 12000).state;
		const retried = applyQuizSessionCommand(reconnected, reconnectedActor, save, 13000);
		expect(retried.receipt).toEqual(accepted.receipt);
		expect(participant(retried.state).answerVersion).toBe(1);
		const submit = command({ type: 'submit', answerVersion: 1 });
		const submitted = applyQuizSessionCommand(retried.state, reconnectedActor, submit, 14000);
		const thirdActor = student(id(1), id(103));
		const third = apply(submitted.state, thirdActor, { type: 'reconnect' }, 15000).state;
		expect(applyQuizSessionCommand(third, thirdActor, submit, 16000).receipt).toEqual(submitted.receipt);
		expect(() => applyQuizSessionCommand(third, reconnectedActor, save, 16000)).toThrow();
	});

	it('replays an identical acknowledged answer save after its general receipt cache entry is evicted', () => {
		const save = command({ type: 'save_answers', version: 1, answers: correctAnswers() });
		const accepted = applyQuizSessionCommand(started(), student(), save, 11000);
		const persisted = evictGeneralReceipt(accepted.state, save.requestId);
		const original = structuredClone(persisted);
		const retried = applyQuizSessionCommand(persisted, student(), save, 15000);
		expect(retried.receipt).toEqual(accepted.receipt);
		expect(retried.state).toEqual(original);
		expect(persisted).toEqual(original);
	});
	it.each(['same', 'fresh'] as const)(
		'replays canonically identical answers after eviction with a %s request ID',
		(identity) => {
			const save = command({ type: 'save_answers', version: 1, answers: correctAnswers() });
			const accepted = applyQuizSessionCommand(started(), student(), save, 11000);
			const persisted = evictGeneralReceipt(accepted.state, save.requestId);
			const actor = student(id(1), id(102));
			const reconnected = apply(persisted, actor, { type: 'reconnect' }, 13000).state;
			const original = structuredClone(reconnected);
			const retry = {
				...save,
				requestId: identity === 'same' ? save.requestId : id(requestNumber++),
				answers: [...correctAnswers()]
					.reverse()
					.map((answer) => ({ ...answer, optionIds: [...answer.optionIds].reverse() }))
			};
			const retried = applyQuizSessionCommand(reconnected, actor, retry, 14000);
			expect(retried.receipt).toEqual({ ...accepted.receipt, requestId: retry.requestId });
			expect(retried.state).toEqual(original);
			expect(reconnected).toEqual(original);
		}
	);
	it.each(['version', 'answers'] as const)(
		'rejects conflicting %s under an evicted answer request ID',
		(difference) => {
			const save = command({ type: 'save_answers', version: 1, answers: correctAnswers() });
			const accepted = applyQuizSessionCommand(started(), student(), save, 11000);
			const persisted = evictGeneralReceipt(accepted.state, save.requestId);
			const original = structuredClone(persisted);
			const retry = {
				...save,
				...(difference === 'version'
					? { version: 2 }
					: {
							answers: correctAnswers().map((answer) =>
								answer.questionId === id(10) ? { ...answer, optionIds: [id(12)] } : answer
							)
						})
			};
			expect(() => applyQuizSessionCommand(persisted, student(), retry, 14000)).toThrowError(
				expect.objectContaining({ code: 'request_conflict' })
			);
			expect(persisted).toEqual(original);
		}
	);

	it('acknowledges a fresh higher answer version after eviction even when its answers are unchanged', () => {
		const save = command({ type: 'save_answers', version: 1, answers: correctAnswers() });
		const accepted = applyQuizSessionCommand(started(), student(), save, 11000);
		const persisted = evictGeneralReceipt(accepted.state, save.requestId);
		const original = structuredClone(persisted);
		const next = command({ type: 'save_answers', version: 2, answers: correctAnswers() });
		const updated = applyQuizSessionCommand(persisted, student(), next, 14000);
		expect(updated.receipt).toMatchObject({ requestId: next.requestId, answerVersion: 2, receivedAt: 14000 });
		expect(updated.receipt.sessionRevision).toBeGreaterThan(persisted.revision);
		expect(participant(updated.state)).toMatchObject({ answerVersion: 2, answers: correctAnswers() });
		expect(persisted).toEqual(original);
	});

	it('retains one submission receipt through cache eviction and rejects altered or unauthorized retries', () => {
		const submit = command({ type: 'submit', answerVersion: 1 });
		const submitted = applyQuizSessionCommand(saved(), student(), submit, 12000);
		const crowded = evictGeneralReceipt(submitted.state, submit.requestId);
		const currentActor = student(id(1), id(104));
		const restored = apply(JSON.parse(JSON.stringify(crowded)), currentActor, { type: 'reconnect' }, 14000).state;
		expect(applyQuizSessionCommand(restored, currentActor, submit, 15000).receipt).toEqual(submitted.receipt);
		expect(participant(restored)).toMatchObject({
			status: 'submitted',
			points: 2,
			answerVersion: 1
		});
		expect(() => applyQuizSessionCommand(restored, student(), submit, 15000)).toThrowError(
			expect.objectContaining({ code: 'connection_conflict' })
		);
		expect(() =>
			applyQuizSessionCommand(restored, { ...currentActor, credentialHash: 'c'.repeat(64) }, submit, 15000)
		).toThrowError(expect.objectContaining({ code: 'credentials_conflict' }));
		expect(() => applyQuizSessionCommand(restored, currentActor, { ...submit, answerVersion: 2 }, 15000)).toThrowError(
			expect.objectContaining({ code: 'request_conflict' })
		);
		const otherActor = student(id(2), id(105));
		const otherJoined = apply(restored, otherActor, { type: 'join' }, 15000).state;
		const otherAdmitted = apply(otherJoined, teacher, { type: 'admit_late', participantId: id(2) }, 15000).state;
		expect(() =>
			applyQuizSessionCommand(otherAdmitted, otherActor, { ...submit, answerVersion: 0 }, 15000)
		).toThrowError(expect.objectContaining({ code: 'request_conflict' }));
	});
	it('rejects another participant replaying an evicted submission even at the same answer version', () => {
		const submit = command({ type: 'submit', answerVersion: 1 });
		const submitted = applyQuizSessionCommand(saved(), student(), submit, 12000);
		const persisted = evictGeneralReceipt(submitted.state, submit.requestId);
		const actor = student(id(2), id(101));
		const waiting = apply(persisted, actor, { type: 'join' }, 14000).state;
		const admitted = apply(waiting, teacher, { type: 'admit_late', participantId: id(2) }, 15000).state;
		const answered = apply(
			admitted,
			actor,
			{ type: 'save_answers', version: 1, answers: correctAnswers() },
			16000
		).state;
		const original = structuredClone(answered);
		expect(() => applyQuizSessionCommand(answered, actor, submit, 17000)).toThrowError(
			expect.objectContaining({ code: 'request_conflict' })
		);
		expect(answered).toEqual(original);
	});

	it('rejects unknown answers and duplicate or invalid selections without mutating the saved snapshot', () => {
		const state = saved();
		for (const answers of [
			[{ questionId: id(99), optionIds: [id(11)] }],
			[{ questionId: id(10), optionIds: [id(21)] }],
			[{ questionId: id(10), optionIds: [id(11), id(12)] }],
			[{ questionId: id(10), optionIds: [id(11), id(11)] }]
		])
			expect(() => apply(state, student(), { type: 'save_answers', version: 2, answers }, 12000)).toThrow();
		expect(participant(state).answers).toEqual(correctAnswers());
	});

	it('rejects a multiple-choice snapshot containing both a valid and an unknown option', () => {
		const state = saved();
		const original = structuredClone(state);
		expect(() =>
			apply(
				state,
				student(),
				{
					type: 'save_answers',
					version: 2,
					answers: [{ questionId: id(20), optionIds: [id(21), id(99)] }]
				},
				12000
			)
		).toThrowError(expect.objectContaining({ code: 'invalid_answers' }));
		expect(state).toEqual(original);
	});
	it('requires the acknowledged version at explicit submission and locks all later edits', () => {
		const state = saved();
		expect(() => apply(state, student(), { type: 'submit', answerVersion: 2 }, 12000)).toThrow();
		const submitted = apply(state, student(), { type: 'submit', answerVersion: 1 }, 13000).state;
		expect(participant(submitted)).toMatchObject({
			status: 'submitted',
			points: 2,
			submittedAt: 13000
		});
		expect(projectQuizSessionForParticipant(submitted, student(), 14000).participant.points).toBeNull();
		expect(projectQuizSessionForParticipant(submitted, student(), 14000).questions).toEqual([]);
		expect(() => apply(submitted, student(), { type: 'save_answers', version: 2, answers: [] }, 14000)).toThrow();
	});

	it('rejects a second submission with a new request identity without replacing the original receipt', () => {
		const submitted = apply(saved(), student(), { type: 'submit', answerVersion: 1 }, 12000);
		const original = structuredClone(submitted.state);
		expect(() => apply(submitted.state, student(), { type: 'submit', answerVersion: 1 }, 13000)).toThrowError(
			expect.objectContaining({ code: 'invalid_state' })
		);
		expect(submitted.state).toEqual(original);
		expect(participant(submitted.state).lastSubmissionReceipt).toEqual(submitted.receipt);
	});

	it('expires exactly at the server deadline with unanswered questions at zero', () => {
		const state = saved([{ questionId: id(10), optionIds: [id(11)] }]);
		expect(expireQuizSession(state, 69999)).toEqual(state);
		const expired = expireQuizSession(state, 70000);
		expect(participant(expired)).toMatchObject({
			status: 'expired',
			points: 1,
			submittedAt: 70000
		});
		expect(getQuizSessionDeadline(expired)).toBeNull();
		expect(expireQuizSession(expired, 90000)).toEqual(expired);
		expect(() =>
			apply(state, student(), { type: 'save_answers', version: 2, answers: correctAnswers() }, 70000)
		).toThrow();
	});

	it('adds individual extra time from the server baseline without altering another participant', () => {
		const waiting = apply(started(), student(id(2), id(101)), { type: 'join' }, 12000).state;
		const admitted = apply(waiting, teacher, { type: 'admit_late', participantId: id(2) }, 13000).state;
		const extra = command({
			type: 'add_time',
			participantId: id(1),
			seconds: 30,
			expectedExtraSeconds: 0
		});
		const changed = applyQuizSessionCommand(admitted, teacher, extra, 14000);
		expect(participant(changed.state)).toMatchObject({ extraSeconds: 30, deadlineAt: 100000 });
		expect(participant(changed.state, id(2)).deadlineAt).toBe(70000);
		expect(applyQuizSessionCommand(changed.state, teacher, extra, 15000).state).toEqual(changed.state);
		expect(() =>
			apply(
				changed.state,
				teacher,
				{ type: 'add_time', participantId: id(1), seconds: 30, expectedExtraSeconds: 0 },
				15000
			)
		).toThrow();
		expect(() =>
			apply(
				changed.state,
				teacher,
				{ type: 'add_time', participantId: id(1), seconds: 30, expectedExtraSeconds: 30 },
				100000
			)
		).toThrow();
	});
	it('accumulates extra time for a late participant from the common start', () => {
		const actor = student(id(2), id(101));
		const waiting = apply(started(), actor, { type: 'join' }, 20000).state;
		const admitted = apply(waiting, teacher, { type: 'admit_late', participantId: id(2) }, 30000).state;
		const answered = apply(
			admitted,
			actor,
			{ type: 'save_answers', version: 1, answers: correctAnswers() },
			31000
		).state;
		const first = apply(
			answered,
			teacher,
			{ type: 'add_time', participantId: id(2), seconds: 10, expectedExtraSeconds: 0 },
			40000
		).state;
		expect(participant(first, id(2))).toMatchObject({ startedAt: 30000, extraSeconds: 10, deadlineAt: 80000 });
		const second = apply(
			first,
			teacher,
			{ type: 'add_time', participantId: id(2), seconds: 20, expectedExtraSeconds: 10 },
			50000
		).state;
		expect(participant(second, id(2))).toEqual({
			...participant(answered, id(2)),
			extraSeconds: 30,
			deadlineAt: 100000
		});
		expect(participant(second)).toEqual(participant(answered));
	});
	it('accepts exactly four hours of cumulative extra time and rejects one more second', () => {
		const extended = apply(joined(), teacher, {
			type: 'add_time',
			participantId: id(1),
			seconds: 14400,
			expectedExtraSeconds: 0
		}).state;
		expect(participant(extended)).toMatchObject({ extraSeconds: 14400, deadlineAt: null });
		const original = structuredClone(extended);
		expect(() =>
			apply(extended, teacher, { type: 'add_time', participantId: id(1), seconds: 1, expectedExtraSeconds: 14400 })
		).toThrowError(expect.objectContaining({ code: 'invalid_input' }));
		expect(extended).toEqual(original);
	});
	it.each(['not_joined', 'awaiting_admission'] as const)(
		'rejects interrupting an unstarted %s participant',
		(status) => {
			const state =
				status === 'not_joined' ? started() : apply(started(), student(id(2), id(101)), { type: 'join' }, 20000).state;
			const original = structuredClone(state);
			expect(() => apply(state, teacher, { type: 'interrupt', participantId: id(2) }, 30000)).toThrowError(
				expect.objectContaining({ code: 'invalid_state' })
			);
			expect(state).toEqual(original);
		}
	);
	it('expires only the earliest active participant and preserves students who never started', () => {
		const roster = apply(
			joined(),
			teacher,
			{
				type: 'set_roster',
				roster: [
					{ id: id(1), name: 'Extended-time student' },
					{ id: id(2), name: 'Standard-time student' },
					{ id: id(3), name: 'Student who never joined' }
				],
				shuffleSeed: 'seed'
			},
			2000
		).state;
		const lobby = apply(roster, student(id(2), id(101)), { type: 'join' }, 3000).state;
		const running = apply(lobby, teacher, { type: 'start' }, 10000).state;
		const extended = apply(
			running,
			teacher,
			{ type: 'add_time', participantId: id(1), seconds: 30, expectedExtraSeconds: 0 },
			11000
		).state;
		const firstSaved = apply(
			extended,
			student(),
			{ type: 'save_answers', version: 1, answers: correctAnswers() },
			12000
		).state;
		const state = apply(
			firstSaved,
			student(id(2), id(101)),
			{ type: 'save_answers', version: 1, answers: [{ questionId: id(10), optionIds: [id(11)] }] },
			13000
		).state;
		expect(getQuizSessionDeadline(state)).toBe(70000);
		expect(expireQuizSession(state, 69999)).toEqual(state);
		const firstExpired = expireQuizSession(state, 70000);
		expect(participant(firstExpired, id(2))).toMatchObject({ status: 'expired', points: 1, submittedAt: 70000 });
		expect(participant(firstExpired)).toMatchObject({
			status: 'active',
			points: null,
			submittedAt: null,
			deadlineAt: 100000
		});
		expect(participant(firstExpired, id(3))).toMatchObject({
			status: 'not_joined',
			startedAt: null,
			deadlineAt: null,
			points: null
		});
		expect(getQuizSessionDeadline(firstExpired)).toBe(100000);
		expect(expireQuizSession(firstExpired, 99999)).toEqual(firstExpired);
		const allExpired = expireQuizSession(firstExpired, 100000);
		expect(participant(allExpired)).toMatchObject({ status: 'expired', points: 2, submittedAt: 100000 });
		expect(participant(allExpired, id(2))).toEqual(participant(firstExpired, id(2)));
		expect(participant(allExpired, id(3))).toEqual(participant(state, id(3)));
		expect(getQuizSessionDeadline(allExpired)).toBeNull();
	});
	it.each(['submit', 'interrupt'] as const)(
		'preserves a participant after %s when another participant expires',
		(action) => {
			const lobby = apply(joined(), student(id(2), id(101)), { type: 'join' }, 2000).state;
			const running = apply(lobby, teacher, { type: 'start' }, 10000).state;
			const answered = apply(
				running,
				student(),
				{ type: 'save_answers', version: 1, answers: correctAnswers() },
				11000
			).state;
			const ended =
				action === 'submit'
					? apply(answered, student(), { type: 'submit', answerVersion: 1 }, 12000).state
					: apply(answered, teacher, { type: 'interrupt', participantId: id(1) }, 12000).state;
			const completedParticipant = structuredClone(participant(ended));
			expect(completedParticipant).toMatchObject({
				status: action === 'submit' ? 'submitted' : 'interrupted',
				points: action === 'submit' ? 2 : 0,
				submittedAt: 12000,
				deadlineAt: 70000
			});
			const expired = expireQuizSession(ended, 70000);
			expect(participant(expired)).toEqual(completedParticipant);
			expect(participant(expired, id(2))).toMatchObject({
				status: 'expired',
				points: 0,
				submittedAt: 70000
			});
			expect(getQuizSessionDeadline(expired)).toBeNull();
		}
	);

	it('records lobby focus/fullscreen reports once and preserves them through roster refresh and start', () => {
		const incident = command({ type: 'report_incident', incident: 'fullscreen' });
		const reported = applyQuizSessionCommand(joined(), student(), incident, 2000);
		const retried = applyQuizSessionCommand(reported.state, student(), incident, 3000);
		expect(retried.receipt).toEqual(reported.receipt);
		const focused = apply(retried.state, student(), { type: 'report_incident', incident: 'focus' }, 4000).state;
		expect(participant(focused)).toMatchObject({
			status: 'lobby',
			incidents: { focus: 1, fullscreen: 1 },
			points: null,
			answers: [],
			deadlineAt: null
		});
		expect(projectQuizSessionForTeacher(focused, 4000).participants[0].incidents).toEqual({
			focus: 1,
			fullscreen: 1
		});
		const refreshed = apply(focused, teacher, {
			type: 'set_roster',
			roster: [{ id: id(1), name: 'Renamed student' }],
			shuffleSeed: 'refreshed-seed'
		}).state;
		const running = apply(refreshed, teacher, { type: 'start' }, 10000).state;
		expect(participant(running).incidents).toEqual({ focus: 1, fullscreen: 1 });
		expect(projectQuizSessionForParticipant(focused, student(), 5000).questions).toEqual([]);
	});
	it('records reports while a late participant awaits admission', () => {
		const actor = student(id(2), id(101));
		const waiting = apply(started(), actor, { type: 'join' }, 12000).state;
		const reported = apply(
			waiting,
			actor,
			{
				type: 'report_incident',
				incident: 'fullscreen'
			},
			13000
		).state;
		expect(participant(reported, id(2))).toMatchObject({
			status: 'awaiting_admission',
			incidents: { focus: 0, fullscreen: 1 },
			points: null
		});
	});
	it('refuses new reports before joining and after submission, interruption, expiry or closure', () => {
		const ended = [
			session(),
			apply(saved(), student(), { type: 'submit', answerVersion: 1 }, 12000).state,
			apply(saved(), teacher, { type: 'interrupt', participantId: id(1) }, 12000).state,
			expireQuizSession(saved(), 70000),
			apply(saved(), teacher, { type: 'close' }, 12000).state
		];
		for (const state of ended)
			expect(() =>
				apply(
					state,
					student(),
					{
						type: 'report_incident',
						incident: 'fullscreen'
					},
					80000
				)
			).toThrow();
	});
	it('records bounded focus/fullscreen counters without changing any answer or assigning a sanction', () => {
		let state = saved();
		for (let index = 0; index < 1010; index++)
			state = apply(state, student(), { type: 'report_incident', incident: 'focus' }, 12000).state;
		state = apply(state, student(), { type: 'report_incident', incident: 'fullscreen' }, 12000).state;
		expect(participant(state)).toMatchObject({
			status: 'active',
			points: null,
			incidents: { focus: 999, fullscreen: 1 },
			answers: correctAnswers()
		});
		expect(JSON.stringify(state).length).toBeLessThan(100000);
	});

	it('lets the teacher force this quiz to zero while preserving saved answers, even after submission', () => {
		const submitted = apply(saved(), student(), { type: 'submit', answerVersion: 1 }, 12000).state;
		const interrupted = apply(submitted, teacher, { type: 'interrupt', participantId: id(1) }, 13000).state;
		expect(participant(interrupted)).toMatchObject({
			status: 'interrupted',
			points: 0,
			answers: correctAnswers(),
			answerVersion: 1
		});
		expect(participant(interrupted, id(2)).points).toBeNull();
	});

	it('closes early, scores saved work and assigns absence zero only to participants who never started', () => {
		const state = apply(saved([{ questionId: id(10), optionIds: [id(11)] }]), teacher, { type: 'close' }, 20000).state;
		expect(state).toMatchObject({ status: 'closed', closedAt: 20000 });
		expect(participant(state)).toMatchObject({ status: 'closed', points: 1, submittedAt: 20000 });
		expect(participant(state, id(2))).toMatchObject({ status: 'absent', points: 0 });
		expect(getQuizSessionDeadline(state)).toBeNull();
		expect(() => apply(state, student(id(2), id(101)), { type: 'join' }, 21000)).toThrow();
	});

	it.each(['submit', 'interrupt'] as const)('preserves an already %s attempt when closing the session', (action) => {
		const lobby = apply(joined(), student(id(2), id(101)), { type: 'join' }).state;
		const running = apply(lobby, teacher, { type: 'start' }, 10000).state;
		const answered = apply(
			running,
			student(),
			{ type: 'save_answers', version: 1, answers: correctAnswers() },
			11000
		).state;
		const finished =
			action === 'submit'
				? apply(answered, student(), { type: 'submit', answerVersion: 1 }, 12000).state
				: apply(answered, teacher, { type: 'interrupt', participantId: id(1) }, 12000).state;
		const closed = apply(finished, teacher, { type: 'close' }, 13000).state;
		expect(participant(closed)).toEqual({
			...participant(finished),
			review: { connectionId: id(100), status: 'available' }
		});
		expect(participant(closed, id(2))).toMatchObject({ status: 'closed', points: 0, submittedAt: 13000 });
	});

	it('issues the personal correction once to the connection present at closure and never caches it in state', () => {
		const closed = apply(saved(), teacher, { type: 'close' }, 20000).state;
		const projection = projectQuizSessionForParticipant(closed, student(), 21000);
		expect(projection).toMatchObject({
			questions: [],
			reviewAvailable: true,
			participant: { points: null, answers: [] }
		});
		const request = command({ type: 'consume_review' });
		const reviewed = applyQuizSessionCommand(closed, student(), request, 21000);
		expect(reviewed.review).toMatchObject({ sessionId: closed.id, points: 2, maxPoints: 2 });
		expect(reviewed.review?.questions.every((question) => question.correctOptionIds.length > 0)).toBe(true);
		expect(reviewed.review?.questions.find((question) => question.id === id(10))?.selectedOptionIds).toEqual([id(11)]);
		expect(projectQuizSessionForParticipant(reviewed.state, student(), 22000).reviewAvailable).toBe(false);
		expect(applyQuizSessionCommand(reviewed.state, student(), request, 22000).review).toBeUndefined();
		expect(() => apply(reviewed.state, student(), { type: 'consume_review' }, 22000)).toThrow();
		expect(reviewed.state.receipts.some((receipt) => 'review' in receipt)).toBe(false);
	});
	it.each([
		{
			name: 'an incorrect selection',
			answers: [
				{ questionId: id(10), optionIds: [id(11)] },
				{ questionId: id(20), optionIds: [id(21), id(23)] }
			],
			points: { [id(10)]: 1, [id(20)]: 0 }
		},
		{
			name: 'an unanswered question',
			answers: [{ questionId: id(20), optionIds: [id(21), id(22)] }],
			points: { [id(10)]: 0, [id(20)]: 1 }
		}
	])('returns the earned points for each reviewed question with $name', ({ answers, points }) => {
		const closed = apply(saved(answers), teacher, { type: 'close' }, 20000).state;
		const reviewed = apply(closed, student(), { type: 'consume_review' }, 21000);
		expect(reviewed.review).toMatchObject({ points: 1, maxPoints: 2 });
		expect(Object.fromEntries(reviewed.review!.questions.map(({ id, points }) => [id, points]))).toEqual(points);
	});

	it('allows a fresh close retry without changing final results or restoring a consumed correction', () => {
		const closed = apply(saved(), teacher, { type: 'close' }, 20000).state;
		const reviewed = apply(closed, student(), { type: 'consume_review' }, 21000).state;
		const repeated = apply(reviewed, teacher, { type: 'close' }, 22000).state;
		expect(repeated.closedAt).toBe(20000);
		expect(repeated.participants).toEqual(reviewed.participants);
		expect(projectQuizSessionForParticipant(repeated, student(), 22000).reviewAvailable).toBe(false);
	});

	it('revokes the correction on disconnect or a new connection after closure', () => {
		const closed = apply(saved(), teacher, { type: 'close' }, 20000).state;
		const disconnected = apply(closed, student(), { type: 'disconnect' }, 21000).state;
		expect(() => apply(disconnected, student(), { type: 'consume_review' }, 22000)).toThrow();
		const reconnected = apply(closed, student(id(1), id(102)), { type: 'reconnect' }, 21000).state;
		expect(projectQuizSessionForParticipant(reconnected, student(id(1), id(102)), 22000).reviewAvailable).toBe(false);
		expect(() => apply(reconnected, student(id(1), id(102)), { type: 'consume_review' }, 22000)).toThrow();
	});

	it('does not grant a correction to a disconnected participant when the teacher closes', () => {
		const disconnected = apply(saved(), student(), { type: 'disconnect' }, 19000).state;
		const closed = apply(disconnected, teacher, { type: 'close' }, 20000).state;
		const reconnected = apply(closed, student(id(1), id(102)), { type: 'reconnect' }, 21000).state;
		expect(projectQuizSessionForParticipant(reconnected, student(id(1), id(102)), 22000).reviewAvailable).toBe(false);
	});

	it('permits a fresh retake only for explicit absence zero and rejects genuine zero or externally protected grades', () => {
		const closed = apply(started(), teacher, { type: 'close' }, 20000).state;
		const input = {
			id: id(201),
			participantIds: [id(2)],
			protectedParticipantIds: [],
			shuffleSeed: 'retake-seed',
			createdAt: 30000
		};
		const retake = createQuizRetakeSession(closed, input);
		expect(retake).toMatchObject({ id: id(201), sourceSessionId: closed.id, status: 'lobby' });
		expect(retake.participants.map((participant) => participant.id)).toEqual([id(2)]);
		expect(retake.participants[0]).toMatchObject({
			status: 'not_joined',
			credentialHash: null,
			answers: [],
			points: null
		});
		expect(() => createQuizRetakeSession(closed, { ...input, participantIds: [id(1)] })).toThrow();
		expect(() => createQuizRetakeSession(closed, { ...input, protectedParticipantIds: [id(2)] })).toThrow();
		expect(() => createQuizRetakeSession(started(), input)).toThrow();
	});
	it('admits server-verified newcomers alongside absentees using the frozen source content', () => {
		const closed = apply(started(), teacher, { type: 'close' }, 20000).state;
		const original = structuredClone(closed);
		const input = {
			id: id(201),
			participantIds: [id(2), id(3)],
			protectedParticipantIds: [],
			newParticipants: [{ id: id(3), name: 'New student' }],
			shuffleSeed: 'newcomer-room',
			createdAt: 30000
		};
		const room = createQuizRetakeSession(closed, input);
		expect(room.participants.map((participant) => participant.id)).toEqual([id(2), id(3)]);
		expect(room.content).toEqual(closed.content);
		expect(room.participants[1]).toMatchObject({
			name: 'New student',
			points: null,
			answers: [],
			credentialHash: null
		});
		expect(closed).toEqual(original);
		expect(() =>
			createQuizRetakeSession(closed, { ...input, newParticipants: [{ id: id(1), name: 'Existing student' }] })
		).toThrow();
		expect(() => createQuizRetakeSession(closed, { ...input, newParticipants: [] })).toThrow();
	});
	it.each([
		{ name: 'source identity', id: id(200), createdAt: 20000 },
		{ name: 'instant before closure', id: id(201), createdAt: 19999 }
	])('rejects a retake with the $name independently of student eligibility', ({ id: retakeId, createdAt }) => {
		const closed = apply(started(), teacher, { type: 'close' }, 20000).state;
		const original = structuredClone(closed);
		expect(() =>
			createQuizRetakeSession(closed, {
				id: retakeId,
				participantIds: [id(2)],
				protectedParticipantIds: [],
				shuffleSeed: 'retake-seed',
				createdAt
			})
		).toThrowError(expect.objectContaining({ code: 'retake_not_allowed' }));
		expect(closed).toEqual(original);
	});
	it('opens a distinct retake at the exact source closure instant with fresh private attempt data', () => {
		const closed = apply(saved(), teacher, { type: 'close' }, 20000).state;
		const original = structuredClone(closed);
		const retake = createQuizRetakeSession(closed, {
			id: id(201),
			participantIds: [id(2)],
			protectedParticipantIds: [],
			shuffleSeed: 'retake-seed',
			createdAt: 20000
		});
		expect(retake).toMatchObject({
			id: id(201),
			sourceSessionId: closed.id,
			status: 'lobby',
			createdAt: closed.closedAt
		});
		expect(retake.content).toEqual(closed.content);
		expect(retake.participants).toHaveLength(1);
		expect(participant(retake, id(2))).toMatchObject({
			status: 'not_joined',
			credentialHash: null,
			answers: [],
			points: null
		});
		expect(closed).toEqual(original);
	});

	it.each([
		{ answers: Array(110000).fill(0), path: ['answers'] },
		{
			answers: [{ questionId: id(10), optionIds: Array(110000).fill(0) }],
			path: ['answers', 0, 'optionIds']
		}
	])('rejects oversized collections at $path without accumulating element errors', ({ answers, path }) => {
		const message = JSON.stringify({
			requestId: id(9000),
			type: 'save_answers',
			version: 1,
			answers
		});
		expect(Buffer.byteLength(message)).toBeLessThan(256 * 1024);
		const parsed = quizSessionCommandSchema.safeParse(JSON.parse(message));
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues.length).toBe(1);
			expect(parsed.error.issues[0]).toMatchObject({ code: 'too_big', path });
		}
	});

	it('never trusts participant teacher actions, client clocks, unknown fields or unbounded incidents', () => {
		const state = started();
		expect(() => apply(state, student(), { type: 'close' }, 20000)).toThrow();
		expect(() => apply(state, teacher, { type: 'save_answers', version: 1, answers: [] }, 20000)).toThrow();
		expect(
			quizSessionCommandSchema.safeParse({
				...command({ type: 'submit', answerVersion: 0 }),
				now: 0
			}).success
		).toBe(false);
		expect(
			quizSessionCommandSchema.safeParse({
				...command({ type: 'report_incident', incident: 'focus' }),
				incident: 'arbitrary telemetry',
				details: 'x'.repeat(200000)
			}).success
		).toBe(false);
		expect(quizSessionCommandSchema.safeParse(command({ type: 'save_answers', version: 0, answers: [] })).success).toBe(
			false
		);
		expect(() => apply(state, teacher, { type: 'close' }, Number.NaN)).toThrow();
		expect(JSON.stringify(projectQuizSessionForTeacher(state, 12000))).not.toContain('credentialHash');
	});
});

describe('local classroom runtime load', () => {
	it.each([12, 40])(
		'durably serializes acknowledged work for %i participants answering 30 questions',
		(count) => {
			const questions: QuizContent['questions'] = Array.from({ length: 30 }, (_, index) => ({
				id: id(10000 + index * 10),
				type: 'single',
				prompt: `Fictional question ${index + 1}`,
				code: '',
				codeLanguage: '',
				options: Array.from({ length: 4 }, (_, option) => ({
					id: id(10001 + index * 10 + option),
					text: `Option ${option + 1}`
				})),
				correctOptionIds: [id(10001 + index * 10)]
			}));
			const actors = Array.from({ length: count }, (_, index) => ({
				kind: 'participant' as const,
				participantId: id(index + 1),
				credentialHash: (index + 1).toString(16).padStart(64, '0'),
				connectionId: id(500 + index)
			}));
			let state = createQuizSession({
				id: id(200),
				content: { ...content(), durationSeconds: 600, questions },
				roster: actors.map((actor, index) => ({
					id: actor.participantId,
					name: `Fictional Student ${index + 1}`
				})),
				shuffleSeed: 'local-load-seed',
				createdAt: 0
			});
			for (const actor of actors) state = apply(state, actor, { type: 'join' }, 1000).state;
			state = apply(state, teacher, { type: 'start' }, 10000).state;
			const startedAt = performance.now();
			const initialCpu = cpuUsage();
			let maximumBytes = 0;
			for (let version = 1; version <= questions.length; version++) {
				const answers = questions
					.slice(0, version)
					.map((question) => ({ questionId: question.id, optionIds: question.correctOptionIds }));
				for (const actor of actors) {
					const result = apply(state, actor, { type: 'save_answers', version, answers }, 10000 + version * 1000);
					expect(result.receipt.answerVersion).toBe(version);
					const serialized = JSON.stringify(result.state);
					maximumBytes = Math.max(maximumBytes, Buffer.byteLength(serialized));
					state = JSON.parse(serialized);
				}
			}
			for (const actor of actors) state = apply(state, actor, { type: 'submit', answerVersion: 30 }, 45000).state;
			state = apply(state, teacher, { type: 'close' }, 50000).state;
			maximumBytes = Math.max(maximumBytes, Buffer.byteLength(JSON.stringify(state)));
			const elapsedMs = Math.round(performance.now() - startedAt);
			const cpu = cpuUsage(initialCpu);
			expect(maximumBytes).toBeLessThan(2 * 1024 * 1024);
			expect(
				state.participants.every((participant) => participant.points === 30 && participant.answerVersion === 30)
			).toBe(true);
			expect(
				projectQuizSessionForTeacher(state, 50000).participants.every((participant) => participant.answeredCount === 30)
			).toBe(true);
			console.info(
				JSON.stringify({
					participants: count,
					acknowledgedSaves: count * 30,
					maximumBytes,
					elapsedMs,
					localCpuMs: Math.round((cpu.user + cpu.system) / 1000)
				})
			);
		},
		15000
	);
});
