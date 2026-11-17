import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	calendarLateness,
	calculateAssessment,
	calculateResult,
	calculateStudent,
	formatMark
} from './grade-calculation.js';
import {
	blankCorrection,
	rubricDraftSchema,
	correctionWriteSchema,
	type RubricAssessment,
	type RubricResult,
	type StudentGrading
} from './grading.js';

function assessment(title: string, maxPoints: number, kind: RubricAssessment['kind'] = 'other'): RubricAssessment {
	const groupId = crypto.randomUUID();
	return {
		id: crypto.randomUUID(),
		title,
		kind,
		purpose: 'graded',
		groups: [{ id: groupId, title }],
		lines: [{ id: crypto.randomUUID(), groupId, label: title, description: '', maxPoints }]
	};
}
function correction(a: RubricAssessment, points: number | null) {
	return {
		...blankCorrection(a.id, 1),
		status: 'graded' as const,
		scores: [{ lineId: a.lines[0].id, points }]
	};
}
describe('Rubrics and precise grade calculations', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});
	it.each(['UTC', 'America/Los_Angeles', 'Asia/Tokyo'])(
		'counts lateness by the Paris date when the runtime time zone is %s',
		async (timeZone) => {
			vi.stubEnv('TZ', timeZone);
			vi.resetModules();
			const { calendarLateness } = await import('./grade-calculation.js');
			expect(calendarLateness('2026-10-10T21:59:00Z', '2026-10-10T23:01:00Z')).toBe(1);
		}
	);
	it.each([
		{ mark: 0, expected: 0 },
		{ mark: 20, expected: 20 },
		{ mark: -5e-9, expected: 0 },
		{ mark: 5e-9, expected: 5e-9 },
		{ mark: 20 - 5e-9, expected: 20 - 5e-9 },
		{ mark: 20 + 5e-9, expected: 20 }
	])('normalizes only outside-boundary noise for $mark while retaining the raw total', ({ mark, expected }) => {
		const a = assessment('A', 20);
		const grade = { ...calculateAssessment(a, correction(a, 20)), state: 'ready' as const, mark };
		const result: RubricResult = {
			id: crypto.randomUUID(),
			title: 'Result',
			rule: { kind: 'points_ratio', assessmentIds: [a.id] }
		};
		const rawTotal = (((20 * ((mark / 20) * grade.maxPoints)) / grade.maxPoints) * 100) / 100;
		expect(calculateResult(result, [a], { [a.id]: grade })).toMatchObject({
			state: 'ready',
			mark: expected,
			rawMark: rawTotal
		});
		expect(grade.rawPoints).toBe(20);
		expect(grade.mark).toBe(mark);
	});
	it.each([-2e-8, 20 + 2e-8, Number.NaN, Number.POSITIVE_INFINITY])(
		'rejects final marks outside the numerical allowance: %s',
		(mark) => {
			const a = assessment('A', 20);
			const result: RubricResult = {
				id: crypto.randomUUID(),
				title: 'Result',
				rule: { kind: 'points_ratio', assessmentIds: [a.id] }
			};
			const grade = { ...calculateAssessment(a, correction(a, 20)), state: 'ready' as const, mark };
			expect(calculateResult(result, [a], { [a.id]: grade })).toMatchObject({
				state: 'invalid',
				mark: null
			});
		}
	);
	it('keeps fractional final results at full precision away from the boundaries', () => {
		const a = assessment('A', 3);
		const result: RubricResult = {
			id: crypto.randomUUID(),
			title: 'Result',
			rule: { kind: 'points_ratio', assessmentIds: [a.id] }
		};
		const grade = calculateAssessment(a, correction(a, 1));
		expect(calculateResult(result, [a], { [a.id]: grade })).toMatchObject({
			state: 'ready',
			mark: 6.666666666666668,
			rawMark: 6.666666666666668
		});
	});
	it('preserves a legitimate tiny positive result from valid weights and integer points', () => {
		const a = assessment('A', 10),
			b = assessment('B', 10);
		const result: RubricResult = {
			id: crypto.randomUUID(),
			title: 'Result',
			rule: {
				kind: 'weighted',
				components: [
					{ assessmentIds: [a.id], weight: 5e-9 },
					{ assessmentIds: [b.id], weight: 100 - 5e-9 }
				]
			}
		};
		expect(rubricDraftSchema.safeParse({ assessments: [a, b], results: [result], contexts: [] }).success).toBe(true);
		const grades = {
			[a.id]: calculateAssessment(a, correction(a, 10)),
			[b.id]: calculateAssessment(b, correction(b, 0))
		};
		expect(calculateResult(result, [a, b], grades)).toMatchObject({
			state: 'ready',
			mark: 9.999999999999999e-10,
			rawMark: 9.999999999999999e-10
		});
	});
	it('rejects weight sums outside the existing tolerance and preserves excessive raw scores', () => {
		const a = assessment('A', 10);
		const result: RubricResult = {
			id: crypto.randomUUID(),
			title: 'Result',
			rule: {
				kind: 'weighted',
				components: [{ assessmentIds: [a.id], weight: 100 - 2e-8 }]
			}
		};
		expect(rubricDraftSchema.safeParse({ assessments: [a], results: [result], contexts: [] }).success).toBe(false);
		expect(calculateResult(result, [a], { [a.id]: calculateAssessment(a, correction(a, 10)) }).state).toBe('invalid');
		result.rule = { kind: 'points_ratio', assessmentIds: [a.id] };
		const student: StudentGrading = {
			id: crypto.randomUUID(),
			name: 'Demo',
			corrections: [correction(a, 11)],
			comment: { revision: 0, content: '' },
			retiredScores: []
		};
		const calculated = calculateStudent([a], [result], student);
		expect(calculated.complete).toBe(false);
		expect(calculated.results[result.id].state).toBe('invalid');
		expect(calculated.assessments[a.id].rawPoints).toBe(11);
		expect(student.corrections[0].scores[0].points).toBe(11);
	});
	it('never exposes NaN raw points when previewing invalid numeric input', () => {
		const a = assessment('A', 10);
		expect(calculateAssessment(a, correction(a, Number.NaN))).toMatchObject({
			state: 'invalid',
			rawPoints: null,
			mark: null
		});
		expect(calculateAssessment(a, correction(a, 1.5))).toMatchObject({
			state: 'invalid',
			rawPoints: null,
			mark: null
		});
	});

	it('matches the approved 15.2 example and the 14.7 two-calendar-day penalty', () => {
		const q = assessment('Quiz', 15, 'quiz'),
			p = assessment('Project', 100, 'project'),
			s = assessment('Oral', 120, 'oral');
		const result: RubricResult = {
			id: crypto.randomUUID(),
			title: 'Final',
			rule: {
				kind: 'weighted',
				components: [
					{ assessmentIds: [q.id], weight: 15 },
					{ assessmentIds: [p.id], weight: 25 },
					{ assessmentIds: [s.id], weight: 60 }
				]
			}
		};
		const student: StudentGrading = {
			id: crypto.randomUUID(),
			name: 'Demo',
			corrections: [correction(q, 11), correction(p, 80), correction(s, 90)],
			comment: { revision: 0, content: '' },
			retiredScores: []
		};
		expect(calculateStudent([q, p, s], [result], student).results[result.id].mark).toBeCloseTo(15.2);
		student.corrections[1].submittedAt = '2026-10-12T07:10:00Z';
		const calculated = calculateStudent([q, p, s], [result], student, [
			{ assessmentId: p.id, dueAt: '2026-10-10T21:59:00Z' }
		]);
		expect(calculated.assessments[p.id]).toMatchObject({
			rawPoints: 80,
			rawMark: 16,
			latenessDays: 2,
			mark: 14
		});
		expect(calculated.results[result.id].mark).toBeCloseTo(14.7);
		expect(formatMark(calculated.results[result.id].mark)).toBe('14,7');
	});
	it('gives each normalized quiz equal weight, including an explicitly absent quiz at zero', () => {
		const a = assessment('Quiz1', 5, 'quiz'),
			b = assessment('Quiz2', 10, 'quiz');
		const result: RubricResult = {
			id: crypto.randomUUID(),
			title: 'Quiz',
			rule: { kind: 'points_ratio', assessmentIds: [a.id, b.id] }
		};
		const grades = {
			[a.id]: calculateAssessment(a, correction(a, 4)),
			[b.id]: calculateAssessment(b, correction(b, 7))
		};
		expect(calculateResult(result, [a, b], grades).mark).toBeCloseTo((16 + 14) / 2);
		grades[b.id] = calculateAssessment(b, { ...correction(b, 7), status: 'absent_unjustified' });
		expect(calculateResult(result, [a, b], grades).mark).toBeCloseTo((16 + 0) / 2);
	});
	it('adds non-quiz criterion points with unequal maxima and success ratios', () => {
		const dossier = assessment('Dossier', 5);
		const secondLine = {
			...dossier.lines[0],
			id: crypto.randomUUID(),
			label: 'Second criterion',
			maxPoints: 15
		};
		dossier.lines.push(secondLine);
		const graded = correction(dossier, 4);
		graded.scores.push({ lineId: secondLine.id, points: 9 });
		expect(calculateAssessment(dossier, graded)).toMatchObject({
			state: 'ready',
			rawPoints: 13,
			maxPoints: 20,
			rawMark: 13,
			mark: 13
		});
	});
	it('weights non-quiz point-ratio results by their different point maxima', () => {
		const first = assessment('First dossier', 5);
		const second = assessment('Second dossier', 15);
		const result: RubricResult = {
			id: crypto.randomUUID(),
			title: 'Combined dossiers',
			rule: { kind: 'points_ratio', assessmentIds: [first.id, second.id] }
		};
		const grades = {
			[first.id]: calculateAssessment(first, correction(first, 4)),
			[second.id]: calculateAssessment(second, correction(second, 9))
		};
		expect(calculateResult(result, [first, second], grades)).toMatchObject({
			state: 'ready',
			rawMark: 13,
			mark: 13
		});
	});
	it('keeps mixed quiz and oral point ratios proportional while excluding formative work', () => {
		const practice = { ...assessment('Practice', 100), purpose: 'formative' as const };
		const quiz = assessment('Quiz', 5, 'quiz');
		const oral = assessment('Oral', 15, 'oral');
		const result: RubricResult = {
			id: crypto.randomUUID(),
			title: 'Combined result',
			rule: { kind: 'points_ratio', assessmentIds: [quiz.id, oral.id] }
		};
		expect(
			rubricDraftSchema.safeParse({ assessments: [practice, quiz, oral], results: [result], contexts: [] }).success
		).toBe(true);
		const grades = {
			[practice.id]: calculateAssessment(practice, correction(practice, 100)),
			[quiz.id]: calculateAssessment(quiz, correction(quiz, 4)),
			[oral.id]: calculateAssessment(oral, correction(oral, 9))
		};
		expect(calculateResult(result, [practice, quiz, oral], grades)).toMatchObject({
			state: 'ready',
			rawMark: 13,
			mark: 13
		});
	});
	it('does not consider completed assessments final until a result is defined', () => {
		const dossier = assessment('Dossier', 20);
		const student: StudentGrading = {
			id: crypto.randomUUID(),
			name: 'Fictional student',
			corrections: [correction(dossier, 16)],
			comment: { revision: 0, content: '' },
			retiredScores: []
		};
		expect(rubricDraftSchema.safeParse({ assessments: [dossier], results: [], contexts: [] }).success).toBe(true);
		expect(calculateStudent([dossier], [], student)).toMatchObject({
			complete: false,
			assessments: { [dossier.id]: { state: 'ready', mark: 16 } },
			results: {}
		});
	});
	it('applies each project deadline by identity rather than reusing the first deadline', () => {
		const first = assessment('First project', 100, 'project');
		const second = assessment('Second project', 100, 'project');
		const result: RubricResult = {
			id: crypto.randomUUID(),
			title: 'Projects',
			rule: { kind: 'points_ratio', assessmentIds: [first.id, second.id] }
		};
		const student: StudentGrading = {
			id: crypto.randomUUID(),
			name: 'Fictional student',
			corrections: [first, second].map((project) => ({
				...correction(project, 80),
				submittedAt: '2026-10-12T08:00:00Z'
			})),
			comment: { revision: 0, content: '' },
			retiredScores: []
		};
		const calculated = calculateStudent([first, second], [result], student, [
			{ assessmentId: first.id, dueAt: '2026-10-10T21:59:00Z' },
			{ assessmentId: second.id, dueAt: '2026-10-11T21:59:00Z' }
		]);
		expect(calculated.assessments[first.id]).toMatchObject({ rawMark: 16, latenessDays: 2, penalty: 2, mark: 14 });
		expect(calculated.assessments[second.id]).toMatchObject({ rawMark: 16, latenessDays: 1, penalty: 1, mark: 15 });
		expect(calculated.results[result.id]).toMatchObject({ state: 'ready', mark: 14.5 });
		expect(calculated.complete).toBe(true);
	});
	it('equally averages normalized non-quiz assessments within a weighted component', () => {
		const first = assessment('First dossier', 5);
		const second = assessment('Second dossier', 15);
		const result: RubricResult = {
			id: crypto.randomUUID(),
			title: 'Combined dossiers',
			rule: {
				kind: 'weighted',
				components: [{ assessmentIds: [first.id, second.id], weight: 100 }]
			}
		};
		expect(
			rubricDraftSchema.safeParse({
				assessments: [first, second],
				results: [result],
				contexts: []
			}).success
		).toBe(true);
		const grades = {
			[first.id]: calculateAssessment(first, correction(first, 4)),
			[second.id]: calculateAssessment(second, correction(second, 9))
		};
		expect(calculateResult(result, [first, second], grades)).toMatchObject({
			state: 'ready',
			rawMark: 14,
			mark: 14
		});
	});
	it('keeps independent 60/80 dossiers and excludes formative activities without inventing an average', () => {
		const a = assessment('Dossier1', 60),
			b = assessment('Dossier2', 80),
			f = { ...assessment('Practice', 10), purpose: 'formative' as const };
		const outputs = [a, b].map((v) => ({
			id: crypto.randomUUID(),
			title: v.title,
			rule: { kind: 'points_ratio' as const, assessmentIds: [v.id] }
		}));
		const calculated = calculateStudent([a, b, f], outputs, {
			id: 'fictional',
			name: 'Demo',
			corrections: [correction(a, 45), correction(b, 68)],
			comment: { revision: 0, content: '' },
			retiredScores: []
		});
		expect(Object.values(calculated.results).map((v) => v.mark)).toEqual([15, 17]);
		expect(calculated.complete).toBe(true);
		expect(
			rubricDraftSchema.safeParse({
				assessments: [a, b, f],
				results: [{ ...outputs[0], rule: { kind: 'points_ratio', assessmentIds: [f.id] } }],
				contexts: []
			}).success
		).toBe(false);
	});
	it('does not turn blank, justified absence or invalid replacement points into definitive zero', () => {
		const a = assessment('A', 10);
		expect(calculateAssessment(a, correction(a, null)).state).toBe('pending');
		expect(calculateAssessment(a, correction(a, 0))).toMatchObject({ state: 'ready', mark: 0 });
		expect(calculateAssessment(a, { ...correction(a, 8), status: 'absent_justified' }).state).toBe('pending');
		a.lines[0].maxPoints = 5;
		expect(calculateAssessment(a, correction(a, 8))).toMatchObject({
			state: 'invalid',
			rawPoints: 8,
			mark: null
		});
		a.lines[0].maxPoints = 20;
		expect(calculateAssessment(a, correction(a, 8)).mark).toBe(8);
	});
	it('requires newly added scoring lines without stealing removed-line points', () => {
		const a = assessment('A', 10),
			c = correction(a, 8);
		a.lines.push({ ...a.lines[0], id: crypto.randomUUID(), label: 'New', maxPoints: 5 });
		expect(calculateAssessment(a, c).state).toBe('pending');
		a.lines.shift();
		expect(calculateAssessment(a, c).rawPoints).toBe(0);
	});
	it('counts Paris calendar changes, weekends and both DST changes without 24-hour rounding', () => {
		expect(calendarLateness('2026-10-10T21:59:00Z', '2026-10-10T23:01:00Z')).toBe(1);
		expect(calendarLateness('2026-03-28T22:59:00Z', '2026-03-30T07:00:00Z')).toBe(2);
		expect(calendarLateness('2026-10-24T21:59:00Z', '2026-10-26T08:00:00Z')).toBe(2);
		expect(calendarLateness('2026-10-12T21:59:00Z', '2026-10-12T08:00:00Z')).toBe(0);
	});
	it.each([
		['2026-02-28T22:59:00Z', '2026-03-01T08:00:00Z', 1],
		['2028-02-28T22:59:00Z', '2028-03-01T08:00:00Z', 2],
		['2026-12-31T22:59:00Z', '2027-01-01T08:00:00Z', 1],
		['2026-10-12T21:59:00Z', '2026-10-11T08:00:00Z', 0]
	])('counts calendar days from %s to %s as %s', (dueAt, submittedAt, expected) => {
		expect(calendarLateness(dueAt, submittedAt)).toBe(expected);
	});
	it.each([
		{ submittedAt: '2026-10-15T08:00:00Z', days: 5, penalty: 5, mark: 11 },
		{ submittedAt: '2026-10-16T08:00:00Z', days: 6, penalty: 16, mark: 0 }
	])('applies the project cutoff after exactly $days calendar days', ({ submittedAt, days, penalty, mark }) => {
		const project = assessment('Project', 100, 'project');
		expect(
			calculateAssessment(project, { ...correction(project, 80), submittedAt }, '2026-10-10T21:59:00Z')
		).toMatchObject({ state: 'ready', rawPoints: 80, rawMark: 16, latenessDays: days, penalty, mark });
	});
	it.each(['quiz', 'oral', 'other'] as const)('does not apply project lateness rules to a %s', (kind) => {
		const item = assessment('Assessment', 10, kind);
		const completed = { ...correction(item, 8), submittedAt: '2026-10-20T08:00:00Z' };
		for (const dueAt of [undefined, '2026-10-10T21:59:00Z']) {
			expect(calculateAssessment(item, completed, dueAt)).toMatchObject({
				state: 'ready',
				rawPoints: 8,
				mark: 16,
				latenessDays: 0,
				penalty: 0
			});
		}
	});
	it('displays an undefined mark differently from an awarded zero', () => {
		expect(formatMark(null)).toBe('N/D');
		expect(formatMark(0)).toBe('0,0');
	});
	it('keeps raw points and caps late penalties at zero, respecting explicit exemption/refusal', () => {
		const a = assessment('Project', 100, 'project'),
			c = { ...correction(a, 10), submittedAt: '2026-10-20T07:00:00Z' };
		expect(calculateAssessment(a, c, '2026-10-10T21:59:00Z')).toMatchObject({
			mark: 0,
			rawPoints: 10
		});
		expect(calculateAssessment(a, { ...c, latenessDecision: 'exempt' }, '2026-10-10T21:59:00Z').mark).toBe(2);
		expect(calculateAssessment(a, { ...c, latenessDecision: 'refused' }).mark).toBe(0);
		expect(calculateAssessment(a, { ...c, submittedAt: null }, '2026-10-10T21:59:00Z').state).toBe('pending');
	});
	it('preserves raw awarded points and the unpenalized mark when a project is explicitly refused', () => {
		const project = assessment('Refused project', 10, 'project');
		const graded = { ...correction(project, 8), latenessDecision: 'refused' as const };
		const original = structuredClone(graded);
		expect(calculateAssessment(project, graded)).toMatchObject({
			state: 'ready',
			rawPoints: 8,
			rawMark: 16,
			mark: 0
		});
		expect(graded).toEqual(original);
	});
	it('rejects decimal points, bad references, duplicate identities and invalid weights as structured data', () => {
		const a = assessment('A', 10);
		const { assessmentId: _id, revision: _rev, ...write } = correction(a, 1.5);
		void _id;
		void _rev;
		expect(correctionWriteSchema.safeParse({ ...write, expectedRevision: 0 }).success).toBe(false);
		const result: RubricResult = {
			id: crypto.randomUUID(),
			title: 'Result',
			rule: { kind: 'weighted', components: [{ assessmentIds: [a.id], weight: 90 }] }
		};
		expect(rubricDraftSchema.safeParse({ assessments: [a], results: [result], contexts: [] }).success).toBe(false);
		result.rule = { kind: 'points_ratio', assessmentIds: [crypto.randomUUID()] };
		expect(rubricDraftSchema.safeParse({ assessments: [a], results: [result], contexts: [] }).success).toBe(false);
		expect(rubricDraftSchema.safeParse({ assessments: [a, a], results: [], contexts: [] }).success).toBe(false);
	});
});
