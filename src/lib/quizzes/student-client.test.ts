import { describe, expect, it, vi } from 'vitest';
import {
	createQuizAnswerDraft,
	prepareQuizAnswerSave,
	reconcileQuizAnswers,
	remainingQuizSeconds,
	setQuizAnswer,
	readQuizRoom,
	joinQuizRoom,
	readQuizSocketMessage
} from './student-client.js';

const questionId = '10000000-0000-4000-8000-000000000001';
const firstOption = '10000000-0000-4000-8000-000000000002';
const secondOption = '10000000-0000-4000-8000-000000000003';
const requestId = '10000000-0000-4000-8000-000000000004';
const locks = { request: (_name: string, operation: () => Promise<unknown>) => operation() } as unknown as LockManager;
const answer = (optionId: string) => [{ questionId, optionIds: [optionId] }];

describe('student quiz answer delivery', () => {
	it('keeps a later choice while an earlier answer is acknowledged', () => {
		const changed = setQuizAnswer(createQuizAnswerDraft(), questionId, [firstOption]);
		const sending = prepareQuizAnswerSave(changed, requestId);
		const newer = setQuizAnswer(sending, questionId, [secondOption]);
		const confirmed = reconcileQuizAnswers(newer, 1, answer(firstOption));
		expect(confirmed.answers).toEqual(answer(secondOption));
		expect(confirmed.pending).toBeNull();
		const next = prepareQuizAnswerSave(confirmed, crypto.randomUUID());
		expect(next.pending).toMatchObject({ version: 2, answers: answer(secondOption) });
	});

	it('retries the identical request after a cut and recognizes an already saved answer on reconnect', () => {
		const sending = prepareQuizAnswerSave(setQuizAnswer(createQuizAnswerDraft(), questionId, [firstOption]), requestId);
		expect(prepareQuizAnswerSave(sending, crypto.randomUUID()).pending).toEqual(sending.pending);
		const resumed = reconcileQuizAnswers(sending, 1, answer(firstOption));
		expect(resumed.pending).toBeNull();
		expect(prepareQuizAnswerSave(resumed, crypto.randomUUID()).pending).toBeNull();
	});

	it('restores only acknowledged server answers and preserves a conflicting local draft', () => {
		const restored = reconcileQuizAnswers(createQuizAnswerDraft(), 3, answer(firstOption));
		expect(restored.answers).toEqual(answer(firstOption));
		const local = prepareQuizAnswerSave(setQuizAnswer(restored, questionId, []), requestId);
		const conflicted = reconcileQuizAnswers(local, 4, answer(secondOption));
		expect(conflicted.conflict).toBe(true);
		expect(conflicted.answers).toEqual([]);
		expect(prepareQuizAnswerSave(conflicted, crypto.randomUUID()).pending).toEqual(local.pending);
	});

	it('counts down from the server deadline instead of restarting a duration on reconnect', () => {
		expect(remainingQuizSeconds(600_000, 580_000, 10_000, 15_001)).toBe(15);
		expect(remainingQuizSeconds(600_000, 599_000, 20_000, 22_000)).toBe(0);
		expect(remainingQuizSeconds(null, 0, 0, 0)).toBeNull();
	});

	it('rejects malformed socket envelopes rather than presenting them as a saved result', () => {
		expect(readQuizSocketMessage('{"type":"ack","receipt":{}}')).toBeNull();
		expect(readQuizSocketMessage('bad json')).toBeNull();
		expect(readQuizSocketMessage('{"type":"error","code":"stale_answers"}')).toEqual({
			type: 'error',
			code: 'stale_answers'
		});
	});
});

describe('student room requests', () => {
	it('waits for acknowledged credential preparation before claiming the student name', async () => {
		const request = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response('{"prepared":true}'))
			.mockResolvedValueOnce(new Response('{"joined":true}'));
		await joinQuizRoom('/room', questionId, true, request, locks);
		expect(request.mock.calls.map(([path, input]) => [path, input?.method])).toEqual([
			['/room', 'PUT'],
			['/room', 'POST']
		]);
	});

	it.each([true, false])(
		'uses the same-origin claim cookie and reports fullscreen as %s',
		async (fullscreenConfirmed) => {
			const request = vi
				.fn<typeof fetch>()
				.mockResolvedValueOnce(new Response('{"prepared":true}'))
				.mockResolvedValueOnce(new Response('{"joined":true}'));
			await joinQuizRoom('/api/quizzes/context/rooms/run', questionId, fullscreenConfirmed, request, locks);
			expect(request).toHaveBeenCalledWith(
				'/api/quizzes/context/rooms/run',
				expect.objectContaining({
					method: 'POST',
					credentials: 'same-origin',
					cache: 'no-store',
					body: JSON.stringify({ participantId: questionId, fullscreenConfirmed })
				})
			);
		}
	);

	it('does not claim when preparation fails or its HTTP response is lost', async () => {
		const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('Response lost'));
		await expect(joinQuizRoom('/room', questionId, true, request, locks)).rejects.toThrow('Response lost');
		expect(request).toHaveBeenCalledTimes(1);
		expect(request.mock.calls[0][1]?.method).toBe('PUT');
	});
	it('refuses an unsafe concurrent fallback when browser locks are unavailable', async () => {
		const request = vi.fn<typeof fetch>();
		await expect(joinQuizRoom('/room', questionId, true, request, null)).rejects.toThrow('navigateur');
		expect(request).not.toHaveBeenCalled();
	});
	it('surfaces a refused claim and does not interpret an error as a room', async () => {
		const request = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response('{"message":"Cet accès est déjà associé à un étudiant."}', { status: 409 }));
		await expect(readQuizRoom('/room', request)).rejects.toThrow('Cet accès est déjà associé');
	});
});
