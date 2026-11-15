import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
vi.mock('./database.js', () => ({ withTeacherDatabase: vi.fn() }));
import { withTeacherDatabase } from './database.js';
import { PATCH as rubricPatch } from '../../../routes/api/teaching/modules/[moduleId]/rubric/+server.js';
import { PATCH as correctionPatch } from '../../../routes/api/teaching/contexts/[contextId]/students/[studentId]/assessments/[assessmentId]/+server.js';
import { PATCH as commentPatch } from '../../../routes/api/teaching/contexts/[contextId]/students/[studentId]/comment/+server.js';
import { load as rubricLoad } from '../../../routes/enseignant/modules/[moduleId]/bareme/+page.server.js';
import { load as gridLoad } from '../../../routes/enseignant/notation/+page.server.js';
import { load as correctionLoad } from '../../../routes/enseignant/notation/[contextId]/[studentId]/+page.server.js';
import { POST as proposalDecision } from '../../../routes/api/teaching/proposals/[proposalId]/decision/+server.js';
import { load as proposalLoad } from '../../../routes/enseignant/propositions/+page.server.js';
const url = new URL('https://campus.example/api/teaching/anything');
const anonymous = { user: null, session: null, authUnavailable: false };
describe('Grading route authorization', () => {
	it.each([rubricPatch, correctionPatch, commentPatch, proposalDecision])(
		'refuses an anonymous write before decoding or opening the database',
		async (endpoint) => {
			vi.mocked(withTeacherDatabase).mockClear();
			const event = {
				request: new Request(url, { method: 'PATCH', body: 'not JSON' }),
				url,
				params: {},
				locals: anonymous
			} as unknown as RequestEvent;
			expect((await endpoint(event)).status).toBe(401);
			expect(withTeacherDatabase).not.toHaveBeenCalled();
		}
	);
	it.each([rubricPatch, correctionPatch, commentPatch, proposalDecision])(
		'rejects forged origins and strict payload extras without DB access',
		async (endpoint) => {
			vi.mocked(withTeacherDatabase).mockClear();
			const locals = {
				user: { id: 'teacher', role: 'teacher' },
				session: { userId: 'teacher', expiresAt: new Date(Date.now() + 60000) }
			};
			const event = {
				request: new Request(url, {
					method: 'PATCH',
					headers: { origin: 'https://foreign.example', 'content-type': 'application/json' },
					body: '{}'
				}),
				url,
				params: {},
				locals
			} as unknown as RequestEvent;
			expect((await endpoint(event)).status).toBe(403);
			const validOriginRequest = new Request(url, {
				method: 'PATCH',
				headers: { origin: url.origin, 'content-type': 'application/json' },
				body: '{"role":"teacher"}'
			});
			expect((await endpoint({ ...event, request: validOriginRequest })).status).toBe(422);
			expect(withTeacherDatabase).not.toHaveBeenCalled();
		}
	);
	it.each([rubricLoad, gridLoad, correctionLoad, proposalLoad])(
		'redirects anonymous page access before looking up records',
		async (load) => {
			vi.mocked(withTeacherDatabase).mockClear();
			let failure: unknown;
			try {
				await load({ locals: anonymous, params: {}, url } as never);
			} catch (cause) {
				failure = cause;
			}
			expect(failure).toMatchObject({ status: 303, location: '/connexion' });
			expect(withTeacherDatabase).not.toHaveBeenCalled();
		}
	);
});
