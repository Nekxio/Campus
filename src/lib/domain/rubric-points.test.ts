import { describe, expect, it } from 'vitest';
import { sectionPointsRule } from './rubric-points.js';
import { calculateStudent } from './grade-calculation.js';
import { sectionWeight } from './grade-export.js';
import {
	blankCorrection,
	rubricDraftSchema,
	type RubricAssessment,
	type RubricData,
	type StudentGrading
} from './grading.js';
import {
	rubricEditorSchema,
	rubricToDomain,
	rubricToInput,
	syncRubricSections
} from '../grading/rubric-form.js';

function section(
	title: string,
	maxima: number[],
	kind: RubricAssessment['kind'] = 'other'
): RubricAssessment {
	const groupId = crypto.randomUUID();
	return {
		id: crypto.randomUUID(),
		title,
		kind,
		purpose: 'graded',
		groups: [{ id: groupId, title: 'Critères' }],
		lines: maxima.map((maxPoints, index) => ({
			id: crypto.randomUUID(),
			groupId,
			label: `${title} ${index + 1}`,
			description: '',
			maxPoints
		}))
	};
}
function student(sections: RubricAssessment[], points: (number | null)[][]): StudentGrading {
	return {
		id: crypto.randomUUID(),
		name: 'Fictif',
		comment: { revision: 0, content: '' },
		retiredScores: [],
		corrections: sections.map((item, index) => ({
			...blankCorrection(item.id, 1),
			status: 'graded',
			scores: item.lines.map((line, lineIndex) => ({
				lineId: line.id,
				points: points[index][lineIndex]
			}))
		}))
	};
}
function data(assessments: RubricAssessment[], results: RubricData['results'] = []): RubricData {
	return {
		module: { id: crypto.randomUUID(), title: 'Fictif', revision: 1 },
		contexts: [],
		assessments,
		results
	};
}
function result(
	assessments: RubricAssessment[],
	quizMaxima: { assessmentId: string; maxPoints: number }[] = []
) {
	return {
		id: crypto.randomUUID(),
		title: 'Note du module',
		rule: sectionPointsRule(assessments, quizMaxima)
	};
}

describe('Section maxima authoring over the established grading engine', () => {
	it('calculates a dossier alone without imposing quiz, project or oral sections', () => {
		const dossier = section('Dossier', [20, 40]);
		const output = result([dossier]);
		const calculated = calculateStudent([dossier], [output], student([dossier], [[15, 30]]));
		expect(calculated.results[output.id].mark).toBe(15);
		expect(output.rule.components).toEqual([{ assessmentIds: [dossier.id], weight: 100 }]);
	});
	it('uses the maxima of dossier and oral criteria as their respective weights', () => {
		const sections = [section('Dossier', [35]), section('Soutenance', [60], 'oral')];
		const output = result(sections);
		expect(
			calculateStudent(sections, [output], student(sections, [[28], [30]])).results[output.id].mark
		).toBeCloseTo((20 * (28 + 30)) / 95);
		expect(sectionWeight(sections[0], output, sections)).toBeCloseTo((100 * 35) / 95);
	});
	it('normalizes different quiz maxima before their equal average and chosen section contribution', () => {
		const sections = [
			section('Soutenance', [60], 'oral'),
			section('Projet', [35], 'project'),
			section('Quiz', [5, 20], 'quiz')
		];
		const output = result(sections, [{ assessmentId: sections[2].id, maxPoints: 20 }]);
		const calculated = calculateStudent(
			sections,
			[output],
			student(sections, [[48], [28], [5, 10]])
		);
		expect(calculated.assessments[sections[2].id].mark).toBe(15);
		expect(calculated.results[output.id].mark).toBeCloseTo((20 * (48 + 28 + 15)) / 115);
		expect(output.rule.components.map((component) => component.weight)).toEqual(
			[60, 35, 20].map((maximum) => (100 * maximum) / 115)
		);
	});
	it.each([0, 1, 5, 6])(
		'preserves the Paris calendar penalty at %i days in the project contribution',
		(days) => {
			const sections = [section('Dossier', [35], 'project'), section('Soutenance', [60], 'oral')];
			const output = result(sections),
				person = student(sections, [[28], [48]]);
			person.corrections[0].submittedAt = `2026-10-${String(10 + days).padStart(2, '0')}T12:00:00Z`;
			const calculated = calculateStudent(sections, [output], person, [
				{ assessmentId: sections[0].id, dueAt: '2026-10-10T12:00:00Z' }
			]);
			const projectMark = days > 5 ? 0 : 16 - days;
			expect(calculated.assessments[sections[0].id].mark).toBe(projectMark);
			expect(calculated.results[output.id].mark).toBeCloseTo(
				(20 * ((projectMark / 20) * 35 + 48)) / 95
			);
		}
	);
	it('keeps blank pending and manual absence at zero without filling missing scores', () => {
		const sections = [section('Dossier', [35]), section('Oral', [60], 'oral')],
			output = result(sections),
			person = student(sections, [[null], [48]]);
		expect(calculateStudent(sections, [output], person)).toMatchObject({
			complete: false,
			results: { [output.id]: { state: 'pending', mark: null } }
		});
		person.corrections[0].status = 'absent_unjustified';
		expect(calculateStudent(sections, [output], person).results[output.id].mark).toBeCloseTo(
			(20 * 48) / 95
		);
		expect(person.corrections[0].scores[0].points).toBeNull();
		person.corrections[0].status = 'absent_justified';
		expect(calculateStudent(sections, [output], person).complete).toBe(false);
	});
	it('excludes formative sections and rejects stale or tampered generated weights on server writes', () => {
		const sections = [
				section('Dossier', [60]),
				{ ...section('Exercice', [40]), purpose: 'formative' as const }
			],
			output = result(sections);
		const draft = { assessments: sections, results: [output], contexts: [] };
		expect(rubricDraftSchema.safeParse(draft).success).toBe(true);
		sections[0].lines[0].maxPoints = 80;
		sections.push(section('Oral', [20], 'oral'));
		expect(rubricDraftSchema.safeParse(draft).success).toBe(false);
		output.rule = sectionPointsRule(sections, []);
		expect(rubricDraftSchema.safeParse(draft).success).toBe(true);
		output.rule.components[0].weight = 50;
		output.rule.components[1].weight = 50;
		expect(rubricDraftSchema.safeParse(draft).success).toBe(false);
	});
	it('rejects missing, duplicate or foreign quiz section maxima', () => {
		const quiz = section('Quiz', [5, 20], 'quiz');
		for (const maxima of [
			[],
			[{ assessmentId: crypto.randomUUID(), maxPoints: 20 }],
			[
				{ assessmentId: quiz.id, maxPoints: 20 },
				{ assessmentId: quiz.id, maxPoints: 20 }
			]
		])
			expect(
				rubricDraftSchema.safeParse({
					assessments: [quiz],
					results: [result([quiz], maxima)],
					contexts: []
				}).success
			).toBe(false);
	});
	it('starts new empty rubrics in section mode, keeps stable result IDs and roundtrips quiz maxima', () => {
		let input = rubricToInput(data([]));
		expect(input.calculationMode).toBe('sections');
		input.assessments.push(section('Quiz', [5, 20], 'quiz'));
		input = syncRubricSections(input);
		const id = input.results[0].id;
		expect(syncRubricSections(input).results[0].id).toBe(id);
		const schema = rubricEditorSchema(() => ({}));
		const missingMaximum = schema.safeParse(input);
		expect(missingMaximum.success).toBe(false);
		if (!missingMaximum.success)
			expect(missingMaximum.error.issues.every((issue) => issue.path[0] === 'quizMaxima')).toBe(
				true
			);
		input.quizMaxima[0].maxPoints = 12;
		expect(schema.safeParse(input).success).toBe(true);
		const domain = rubricToDomain(input, {});
		const reloaded = rubricToInput({ ...data([]), ...domain, contexts: [] });
		expect(reloaded.calculationMode).toBe('sections');
		expect(reloaded.quizMaxima[0].maxPoints).toBe(12);
		expect(rubricToDomain(reloaded, {})).toEqual(domain);
	});
	it('roundtrips independent legacy results exactly, including custom weighted rules', () => {
		const sections = [section('Dossier 1', [60]), section('Dossier 2', [80])];
		const results: RubricData['results'] = [
			{
				id: crypto.randomUUID(),
				title: 'Dossier 1',
				rule: { kind: 'points_ratio', assessmentIds: [sections[0].id] }
			},
			{
				id: crypto.randomUUID(),
				title: 'Dossier 2',
				rule: { kind: 'weighted', components: [{ assessmentIds: [sections[1].id], weight: 100 }] }
			}
		];
		const original = data(sections, results),
			input = rubricToInput(original);
		expect(input.calculationMode).toBe('custom');
		expect(rubricToDomain(syncRubricSections(input), {})).toEqual({
			assessments: sections,
			results,
			contexts: []
		});
		expect(
			Object.values(
				calculateStudent(sections, results, student(sections, [[45], [68]])).results
			).map((grade) => grade.mark)
		).toEqual([15, 17]);
	});
	it('keeps rubric-review blocking and excessive raw points rather than inventing scores', () => {
		const sections = [section('Dossier', [60])],
			output = result(sections),
			person = student(sections, [[45]]);
		person.corrections[0].needsReview = true;
		expect(calculateStudent(sections, [output], person).complete).toBe(false);
		sections[0].lines[0].maxPoints = 40;
		const calculated = calculateStudent(sections, [result(sections)], person);
		expect(calculated.assessments[sections[0].id]).toMatchObject({
			state: 'invalid',
			rawPoints: 45,
			mark: null
		});
		expect(person.corrections[0].scores[0].points).toBe(45);
	});
});
