import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../db/index.js';
import { emptyModule } from '../../teaching/types.js';

vi.mock('./database.js', () => ({ withTeacherDatabase: vi.fn() }));
vi.mock('./service.js', () => ({ listClasses: vi.fn(), getModule: vi.fn() }));
vi.mock('../calendar/lesson-ownership.js', () => ({ getManagedLessons: vi.fn() }));
vi.mock('./student-views.js', () => ({ getPublishedModulePath: vi.fn() }));

import { withTeacherDatabase } from './database.js';
import { listClasses, getModule } from './service.js';
import { getManagedLessons } from '../calendar/lesson-ownership.js';
import { getPublishedModulePath } from './student-views.js';
import { load } from '../../../routes/enseignant/modules/[moduleId]/+page.server.js';

const moduleId = '01000000-0000-4000-8000-000000000001';
const teacher = {
	user: { id: 'teacher', role: 'teacher' },
	session: { userId: 'teacher', expiresAt: new Date('2099-01-01') }
};
const event = (locals: unknown = teacher, id = moduleId) =>
	({ locals, params: { moduleId: id } }) as Parameters<typeof load>[0];
const database = {} as Database;

beforeEach(() => {
	vi.mocked(withTeacherDatabase).mockImplementation((_locals, operation) => operation(database));
});
afterEach(() => {
	vi.resetAllMocks();
	vi.useRealTimers();
});

describe('Module page data loading', () => {
	it('loads independent data in one latency window and retains the complete page data', async () => {
		vi.useFakeTimers();
		const module = {
			...emptyModule(),
			id: moduleId,
			revision: 1,
			needsReview: false,
			agentChanges: [],
			paused: false
		};
		const delayed = async <T>(value: T) => {
			await new Promise((resolve) => setTimeout(resolve, 50));
			return value;
		};
		vi.mocked(listClasses).mockImplementation(() => delayed([]));
		vi.mocked(getModule).mockImplementation(() => delayed(module));
		vi.mocked(getManagedLessons).mockImplementation(() => delayed([]));
		vi.mocked(getPublishedModulePath).mockImplementation(() => delayed('/modules/published'));
		let completed = false;
		const loading = Promise.resolve(load(event())).then((data) => {
			completed = true;
			return data;
		});
		await vi.advanceTimersByTimeAsync(50);
		expect.soft(completed, 'Independent reads should not add their network waits').toBe(true);
		await vi.runAllTimersAsync();
		await expect(loading).resolves.toEqual({
			classes: [],
			module,
			managedLessons: [],
			publishedPath: '/modules/published'
		});
	});

	it.each([
		{ locals: { user: null, session: null }, status: 303 },
		{ locals: { ...teacher, user: { id: 'teacher', role: 'student' } }, status: 403 }
	])('authorizes before reading page data ($status)', ({ locals, status }) => {
		expect(() => load(event(locals))).toThrow(expect.objectContaining({ status }));
		expect(withTeacherDatabase).not.toHaveBeenCalled();
	});

	it('rejects malformed module identifiers before reading page data', () => {
		expect(() => load(event(teacher, 'invalid'))).toThrow(expect.objectContaining({ status: 404 }));
		expect(withTeacherDatabase).not.toHaveBeenCalled();
	});
});
