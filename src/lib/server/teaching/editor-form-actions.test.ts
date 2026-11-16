import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Database } from '../db/index.js';
import { moduleDraftSchema } from '#lib/domain/teaching.js';
import { emptyModule } from '#lib/teaching/types.js';

vi.mock('./database.js', () => ({ withTeacherDatabase: vi.fn() }));
vi.mock('./service.js', () => ({
	listClasses: vi.fn(),
	getModule: vi.fn(),
	createModule: vi.fn(),
	updateModule: vi.fn()
}));
vi.mock('./grading.js', () => ({
	getRubric: vi.fn(),
	getDetailedCorrection: vi.fn(),
	replaceRubric: vi.fn(),
	saveCorrection: vi.fn(),
	saveSemesterComment: vi.fn()
}));
vi.mock('../calendar/lesson-ownership.js', () => ({ getManagedLessons: vi.fn() }));
vi.mock('./student-views.js', () => ({ getPublishedModulePath: vi.fn() }));

import { withTeacherDatabase } from './database.js';
import { createModule, updateModule } from './service.js';
import { replaceRubric, saveCorrection, saveSemesterComment } from './grading.js';
import * as creationPage from '../../../routes/enseignant/modules/nouveau/+page.server.js';
import * as modulePage from '../../../routes/enseignant/modules/[moduleId]/+page.server.js';
import * as rubricPage from '../../../routes/enseignant/modules/[moduleId]/bareme/+page.server.js';
import * as correctionPage from '../../../routes/enseignant/notation/[contextId]/[studentId]/+page.server.js';

const require = createRequire(import.meta.url);
const { stringify }: { stringify: (value: unknown) => string } = await import(
	pathToFileURL(require.resolve('devalue', { paths: [dirname(require.resolve('sveltekit-superforms'))] })).href
);

const ids = {
	moduleId: '01000000-0000-4000-8000-000000000001',
	contextId: '01000000-0000-4000-8000-000000000002',
	studentId: '01000000-0000-4000-8000-000000000003',
	assessmentId: '01000000-0000-4000-8000-000000000004',
	lineId: '01000000-0000-4000-8000-000000000005'
};
const database = {} as Database;
const draft = moduleDraftSchema.parse({ ...emptyModule(), title: 'Module fictif' });
const receipt = { id: ids.moduleId, revision: 2, ...draft };
const request = (command: unknown, params: Record<string, string> = ids) => {
	const body = new FormData();
	body.set('__superform_json', stringify(command));
	const request = new Request('https://fixture.invalid/enseignant/modules/nouveau?/createModule', {
		method: 'POST',
		headers: { origin: 'https://fixture.invalid' },
		body
	});
	return {
		request,
		url: new URL(request.url),
		params,
		locals: {
			user: { id: 'teacher', role: 'teacher' },
			session: { userId: 'teacher', expiresAt: new Date('2099-01-01') }
		}
	} as unknown as RequestEvent;
};

beforeEach(() => {
	vi.mocked(withTeacherDatabase).mockImplementation((_locals, operation) => operation(database));
	vi.mocked(createModule).mockResolvedValue(receipt);
	vi.mocked(updateModule).mockResolvedValue(receipt);
});
afterEach(() => vi.resetAllMocks());

describe('Teaching editor page actions', () => {
	it('retains the requested module identity when retrying the same creation', async () => {
		const command = { id: ids.moduleId, draft };
		for (let attempt = 0; attempt < 2; attempt++) {
			await expect(creationPage.actions.createModule(request(command))).resolves.toMatchObject({ receipt });
		}
		expect(createModule).toHaveBeenCalledTimes(2);
		expect(createModule).toHaveBeenLastCalledWith(database, draft, ids.moduleId);
	});

	it('rejects a creation command without its retry identity before opening the database', async () => {
		const command = { draft };
		await expect(creationPage.actions.createModule(request(command))).resolves.toMatchObject({ status: 422 });
		expect(withTeacherDatabase).not.toHaveBeenCalled();
	});

	it('uses the page module identity and preserves its optimistic revision for updates', async () => {
		const command = { ...draft, expectedRevision: 7 };
		await expect(modulePage.actions.saveModule(request(command))).resolves.toMatchObject({ receipt });
		expect(updateModule).toHaveBeenCalledWith(database, ids.moduleId, { ...draft, expectedRevision: 7 });
	});

	it('refuses body identities and missing update revisions before opening the database', async () => {
		for (const command of [{ ...draft, id: ids.moduleId, expectedRevision: 7 }, draft]) {
			await expect(modulePage.actions.saveModule(request(command))).resolves.toMatchObject({ status: 422 });
		}
		expect(withTeacherDatabase).not.toHaveBeenCalled();
	});

	it('saves the rubric with the context and module revisions supplied by the editor', async () => {
		const command = {
			assessments: [],
			results: [],
			contexts: [{ id: ids.contextId, expectedRevision: 3, deadlines: [] }],
			expectedRevision: 7
		};
		vi.mocked(replaceRubric).mockResolvedValue({ reviewRequiredCorrections: 0 } as never);
		await expect(rubricPage.actions.saveRubric(request(command))).resolves.toHaveProperty('receipt');
		expect(replaceRubric).toHaveBeenCalledWith(database, ids.moduleId, {
			assessments: [],
			results: [],
			contexts: [{ id: ids.contextId, expectedRevision: 3, deadlines: [] }],
			expectedRevision: 7
		});
	});

	it('saves only the selected assessment using the page context and student', async () => {
		const correction = {
			expectedRevision: 3,
			rubricRevision: 7,
			status: 'graded',
			submissionUrl: null,
			submittedAt: null,
			latenessDecision: 'automatic',
			scores: [{ lineId: ids.lineId, points: 0 }]
		};
		const command = { assessmentId: ids.assessmentId, correction };
		vi.mocked(saveCorrection).mockResolvedValue({ id: ids.studentId } as never);
		await expect(correctionPage.actions.saveAssessment(request(command))).resolves.toHaveProperty('receipt');
		expect(saveCorrection).toHaveBeenCalledWith(database, ids.contextId, ids.studentId, ids.assessmentId, correction);
		expect(saveSemesterComment).not.toHaveBeenCalled();
	});

	it('saves the private semester comment independently of assessment writes', async () => {
		vi.mocked(saveSemesterComment).mockResolvedValue({ revision: 5, content: 'Commentaire fictif' });
		const command = { expectedRevision: 4, content: 'Commentaire fictif' };
		await expect(correctionPage.actions.saveComment(request(command))).resolves.toMatchObject({
			receipt: { revision: 5, content: 'Commentaire fictif' }
		});
		expect(saveSemesterComment).toHaveBeenCalledWith(database, ids.contextId, ids.studentId, {
			expectedRevision: 4,
			content: 'Commentaire fictif'
		});
		expect(saveCorrection).not.toHaveBeenCalled();
	});

	it('rejects a correction command that tries to include another private comment', async () => {
		const command = {
			assessmentId: ids.assessmentId,
			correction: {
				expectedRevision: 0,
				rubricRevision: 7,
				status: 'to_evaluate',
				submissionUrl: null,
				submittedAt: null,
				latenessDecision: 'automatic',
				scores: []
			},
			comment: { expectedRevision: 0, content: 'Unrelated draft' }
		};
		await expect(correctionPage.actions.saveAssessment(request(command))).resolves.toMatchObject({ status: 422 });
		expect(withTeacherDatabase).not.toHaveBeenCalled();
		expect(saveSemesterComment).not.toHaveBeenCalled();
	});
});
