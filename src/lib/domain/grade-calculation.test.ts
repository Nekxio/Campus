import { describe, expect, it } from 'vitest';
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

function assessment(
	title: string,
	maxPoints: number,
	kind: RubricAssessment['kind'] = 'other'
): RubricAssessment {
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
	it.each([
		{ mark: 0, expected: 0 },
		{ mark: 20, expected: 20 },
		{ mark: -5e-9, expected: 0 },
		{ mark: 5e-9, expected: 5e-9 },
		{ mark: 20 - 5e-9, expected: 20 - 5e-9 },
		{ mark: 20 + 5e-9, expected: 20 }
	])(
		'normalizes only outside-boundary noise for $mark while retaining the raw total',
		({ mark, expected }) => {
			const a = assessment('A', 20);
			const grade = { ...calculateAssessment(a, correction(a, 20)), mark };
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
		}
	);
	it.each([-2e-8, 20 + 2e-8, Number.NaN, Number.POSITIVE_INFINITY])(
		'rejects final marks outside the numerical allowance: %s',
		(mark) => {
			const a = assessment('A', 20);
			const result: RubricResult = {
				id: crypto.randomUUID(),
				title: 'Result',
				rule: { kind: 'points_ratio', assessmentIds: [a.id] }
			};
			const grade = { ...calculateAssessment(a, correction(a, 20)), mark };
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
		expect(
			rubricDraftSchema.safeParse({ assessments: [a, b], results: [result], contexts: [] }).success
		).toBe(true);
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
		expect(
			rubricDraftSchema.safeParse({ assessments: [a], results: [result], contexts: [] }).success
		).toBe(false);
		expect(
			calculateResult(result, [a], { [a.id]: calculateAssessment(a, correction(a, 10)) }).state
		).toBe('invalid');
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
		expect(calculateStudent([q, p, s], [result], student).results[result.id].mark).toBeCloseTo(
			15.2
		);
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
	it('sums quiz raw points/maxima instead of averaging percentages, including absent quiz maxima', () => {
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
		expect(calculateResult(result, [a, b], grades).mark).toBeCloseTo((20 * 11) / 15);
		grades[b.id] = calculateAssessment(b, { ...correction(b, 7), status: 'absent_unjustified' });
		expect(calculateResult(result, [a, b], grades).mark).toBeCloseTo((20 * 4) / 15);
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
		expect(calculateAssessment(a, { ...correction(a, 8), status: 'absent_justified' }).state).toBe(
			'pending'
		);
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
	it('keeps raw points and caps late penalties at zero, respecting explicit exemption/refusal', () => {
		const a = assessment('Project', 100, 'project'),
			c = { ...correction(a, 10), submittedAt: '2026-10-20T07:00:00Z' };
		expect(calculateAssessment(a, c, '2026-10-10T21:59:00Z')).toMatchObject({
			mark: 0,
			rawPoints: 10
		});
		expect(
			calculateAssessment(a, { ...c, latenessDecision: 'exempt' }, '2026-10-10T21:59:00Z').mark
		).toBe(2);
		expect(calculateAssessment(a, { ...c, latenessDecision: 'refused' }).mark).toBe(0);
		expect(calculateAssessment(a, { ...c, submittedAt: null }, '2026-10-10T21:59:00Z').state).toBe(
			'pending'
		);
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
		expect(
			rubricDraftSchema.safeParse({ assessments: [a], results: [result], contexts: [] }).success
		).toBe(false);
		result.rule = { kind: 'points_ratio', assessmentIds: [crypto.randomUUID()] };
		expect(
			rubricDraftSchema.safeParse({ assessments: [a], results: [result], contexts: [] }).success
		).toBe(false);
		expect(
			rubricDraftSchema.safeParse({ assessments: [a, a], results: [], contexts: [] }).success
		).toBe(false);
	});
});
