import { describe, expect, it } from 'vitest';
import {
	completeGradingSelection,
	gradingSelectionQuery,
	type GradingNavigationSelection
} from './grading-selection.js';

const contexts = [
	{ id: 'context-a', classId: 'class-a', academicYear: '2026-2027' },
	{ id: 'context-b', classId: 'class-b', academicYear: '2027-2028' }
];

describe('grading navigation query', () => {
	it('uses the canonical order when both a return section and a student are selected', () => {
		expect(
			gradingSelectionQuery({
				academicYear: '2026-2027',
				classId: 'class-a',
				moduleId: 'module-a',
				contextId: 'context-a',
				section: 'planning',
				studentId: 'student-a'
			}).toString()
		).toBe('annee=2026-2027&classe=class-a&module=module-a&contexte=context-a&section=planning&etudiant=student-a');
	});

	it('keeps explicit empty values while omitting absent fields', () => {
		expect(
			gradingSelectionQuery({
				academicYear: '',
				classId: '',
				moduleId: undefined,
				contextId: null,
				section: null,
				studentId: ''
			}).toString()
		).toBe('annee=&classe=&etudiant=');
	});
});

describe('grading navigation completion', () => {
	it('completes a sole context without changing the module, student or return section', () => {
		const selection = Object.freeze({
			moduleId: 'module-a',
			studentId: 'student-a',
			section: 'preparation'
		});
		expect(completeGradingSelection(selection, [contexts[0]])).toEqual({
			...selection,
			academicYear: '2026-2027',
			classId: 'class-a',
			contextId: 'context-a'
		});
	});

	it.each([{ contextId: 'context-b' }, { classId: 'class-b' }, { academicYear: '2027-2028' }])(
		'completes the unique context compatible with %j',
		(selection) => {
			expect(completeGradingSelection(selection, contexts)).toEqual({
				academicYear: '2027-2028',
				classId: 'class-b',
				contextId: 'context-b'
			});
		}
	);

	it('treats null and undefined as absent when a unique context exists', () => {
		expect(
			completeGradingSelection({ academicYear: null, classId: undefined, contextId: null, studentId: null }, [
				contexts[0]
			])
		).toEqual({
			academicYear: '2026-2027',
			classId: 'class-a',
			contextId: 'context-a',
			studentId: null
		});
	});

	it('leaves ambiguous or unavailable contexts for the server without dropping the student', () => {
		const selection = { moduleId: 'module-a', studentId: 'student-a', academicYear: null };
		expect(completeGradingSelection(selection, contexts)).toEqual(selection);
		expect(completeGradingSelection(selection, [])).toEqual(selection);
	});

	it.each<GradingNavigationSelection>([
		{ contextId: 'unknown' },
		{ classId: 'unknown' },
		{ academicYear: 'invalid' },
		{ contextId: 'context-a', classId: 'class-b' },
		{ contextId: 'context-a', academicYear: '2027-2028' },
		{ contextId: '' },
		{ classId: '' },
		{ academicYear: '' }
	])('preserves explicit incompatible or cleared selections: %j', (scope) => {
		const selection = { ...scope, moduleId: 'module-a', studentId: 'student-a' };
		expect(completeGradingSelection(selection, contexts)).toEqual(selection);
	});

	it('does not use a context without a class or a year', () => {
		const selection = { moduleId: 'module-a', studentId: 'student-a' };
		expect(
			completeGradingSelection(selection, [
				{ id: 'detached', classId: null, academicYear: '2026-2027' },
				{ id: 'undated', classId: 'class-a', academicYear: '' }
			])
		).toEqual(selection);
	});
	it.each([
		{ id: 'detached', classId: null, academicYear: '2026-2027' },
		{ id: 'undated', classId: 'class-a', academicYear: '' }
	])('does not complete navigation from the sole incomplete context $id', (context) => {
		const selection = { moduleId: 'module-a', studentId: 'student-a' };
		expect(completeGradingSelection(selection, [context])).toEqual(selection);
	});

	it('does not choose the first context when a class has multiple compatible attachments', () => {
		const selection = { classId: 'class-a', moduleId: 'module-a' };
		expect(completeGradingSelection(selection, [contexts[0], { ...contexts[0], id: 'context-other' }])).toEqual(
			selection
		);
	});
});
