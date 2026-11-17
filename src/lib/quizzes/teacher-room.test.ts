import { describe, expect, it } from 'vitest';
import { confirmQuizRoomCommand, quizTimeRemaining } from './teacher-room.js';
import type { QuizTeacherProjection } from '#lib/domain/quiz-session.js';

const view: QuizTeacherProjection = {
	id: crypto.randomUUID(),
	title: 'Fictional quiz',
	status: 'running',
	revision: 2,
	serverNow: 10000,
	startedAt: 1000,
	closedAt: null,
	maxPoints: 1,
	participants: []
};

describe('teacher quiz room confirmations', () => {
	it('requires the pending command and room identities before confirming an action', () => {
		const command = { type: 'close' as const, requestId: crypto.randomUUID() };
		const payload = {
			receipt: {
				requestId: command.requestId,
				type: 'close',
				sessionRevision: 2,
				receivedAt: 10000,
				participantId: null
			},
			view,
			grades: { reported: 3, conflicts: [] }
		};
		expect(confirmQuizRoomCommand(view.id, command, payload).grades?.reported).toBe(3);
		expect(() => confirmQuizRoomCommand(crypto.randomUUID(), command, payload)).toThrow();
		expect(() => confirmQuizRoomCommand(view.id, { ...command, requestId: crypto.randomUUID() }, payload)).toThrow();
		expect(() => confirmQuizRoomCommand(view.id, { ...command, type: 'start' }, payload)).toThrow();
	});

	it('shows a server deadline without extending it while a client clock advances', () => {
		expect(quizTimeRemaining(null, 10000, 'active', 'running')).toBe('N/D');
		expect(quizTimeRemaining(71000, 10000, 'active', 'running')).toBe('1 min 1 s');
		expect(quizTimeRemaining(71000, 11000, 'active', 'running')).toBe('60 s');
		expect(quizTimeRemaining(71000, 72000, 'active', 'running')).toBe('0 s');
	});
	it('stops all countdowns after room closure even if their original deadlines remain', () => {
		for (const at of [10000, 20000, 80000]) {
			expect(quizTimeRemaining(71000, at, 'active', 'closed')).toBe('Clôturé');
			expect(quizTimeRemaining(null, at, 'absent', 'closed')).toBe('Clôturé');
		}
	});
	it.each([
		['submitted', 'Rendu'],
		['expired', 'Temps écoulé'],
		['interrupted', 'Interrompu'],
		['closed', 'Clôturé']
	] as const)('stops the countdown for a %s participant while the room remains open', (status, label) => {
		expect(quizTimeRemaining(71000, 10000, status, 'running')).toBe(label);
		expect(quizTimeRemaining(71000, 20000, status, 'running')).toBe(label);
	});
	it('counts down only for active participants in a running room', () => {
		expect(quizTimeRemaining(71000, 10000, 'active', 'running')).toBe('1 min 1 s');
		expect(quizTimeRemaining(71000, 10000, 'active', 'lobby')).toBe('N/D');
		expect(quizTimeRemaining(71000, 10000, 'awaiting_admission', 'running')).toBe('N/D');
	});
});
