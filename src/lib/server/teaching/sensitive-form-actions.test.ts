import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

const spies = vi.hoisted(() => ({
	openRoom: vi.fn(),
	saveQuiz: vi.fn(),
	getQuiz: vi.fn(),
	decideYear: vi.fn(),
	purge: vi.fn()
}));
vi.mock('./form-actions.js', () => ({
	teacherFormAction:
		(_schema: unknown, operation: (input: unknown, event: RequestEvent) => unknown) =>
		async (event: RequestEvent & { input: unknown }) =>
			operation(event.input, event)
}));
vi.mock('./database.js', () => ({
	withTeacherDatabase: (_locals: unknown, operation: (db: object) => unknown) => operation({})
}));
vi.mock('./quizzes.js', () => ({
	getQuizDraft: spies.getQuiz,
	listQuizDrafts: vi.fn(),
	saveQuizDraft: spies.saveQuiz
}));
vi.mock('./quiz-rooms.js', async (original) => ({ ...(await original<object>()), openQuizRoom: spies.openRoom }));
vi.mock('./annual.js', async (original) => ({ ...(await original<object>()), decideAnnualYear: spies.decideYear }));
vi.mock('../quizzes/http.js', () => ({ quizRoomStub: () => ({ purge: spies.purge }) }));

import { actions as quizActions } from '../../../routes/enseignant/modules/[moduleId]/quiz/+page.server.js';
import { actions as roomActions } from '../../../routes/enseignant/quiz/[runId]/+page.server.js';
import { actions as annualActions } from '../../../routes/enseignant/classes/annees/+page.server.js';

const moduleId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const event = (input: unknown, params: Record<string, string>) =>
	({
		input,
		params,
		locals: {
			user: { id: 'teacher', role: 'teacher' },
			session: { userId: 'teacher', expiresAt: new Date(Date.now() + 60000) }
		}
	}) as unknown as RequestEvent;

beforeEach(() => {
	vi.clearAllMocks();
	spies.getQuiz.mockResolvedValue({ moduleId });
	spies.openRoom.mockResolvedValue({ id: otherId });
	spies.saveQuiz.mockResolvedValue({ id: otherId });
});

describe('sensitive teacher page actions', () => {
	it('rejects quiz saves and room openings belonging to another module before mutation', async () => {
		await expect(quizActions.saveQuiz(event({ moduleId: otherId }, { moduleId }))).rejects.toMatchObject({
			status: 422
		});
		spies.getQuiz.mockResolvedValue({ moduleId: otherId });
		await expect(quizActions.openRoom(event({ quizId: otherId }, { moduleId }))).rejects.toMatchObject({ status: 422 });
		expect(spies.saveQuiz).not.toHaveBeenCalled();
		expect(spies.openRoom).not.toHaveBeenCalled();
	});
	it('requires a retake to use the exact room reviewed by its page', async () => {
		await expect(roomActions.createRetake(event({ sourceRunId: otherId }, { runId: moduleId }))).rejects.toMatchObject({
			status: 422
		});
		expect(spies.openRoom).not.toHaveBeenCalled();
		const input = { sourceRunId: moduleId, quizId: otherId };
		await roomActions.createRetake(event(input, { runId: moduleId }));
		expect(spies.openRoom).toHaveBeenCalledWith(expect.anything(), expect.any(Function), 'teacher', input);
	});
	it('opens the selected module quiz but keeps retakes on their room page', async () => {
		const input = { quizId: otherId };
		await quizActions.openRoom(event(input, { moduleId }));
		expect(spies.openRoom).toHaveBeenCalledWith(expect.anything(), expect.any(Function), 'teacher', input);
		spies.openRoom.mockClear();
		await expect(quizActions.openRoom(event({ ...input, sourceRunId: moduleId }, { moduleId }))).rejects.toMatchObject({
			status: 422
		});
		expect(spies.openRoom).not.toHaveBeenCalled();
	});
	it('keeps durable quiz-room purges in the annual decision orchestration', async () => {
		const input = { academicYear: '2026-2027', action: 'purge' };
		spies.decideYear.mockImplementation(async (_db, _teacher, _input, options) =>
			options.purgeQuizRuns([moduleId, otherId])
		);
		await expect(annualActions.decideYear(event(input, {}))).resolves.toEqual([moduleId, otherId]);
		expect(spies.purge).toHaveBeenCalledTimes(2);
		expect(spies.decideYear).toHaveBeenCalledWith(expect.anything(), 'teacher', input, expect.anything());
	});
});
