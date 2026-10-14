import { describe, expect, it } from 'vitest';
import { demoGradeError, gradeInputSchema } from './grade-input';

describe('grade input preview', () => {
	const schema = gradeInputSchema(20);

	it('keeps an empty input distinct from a zero grade', () => {
		expect(schema.parse('')).toBeNull();
		expect(schema.parse('  ')).toBeNull();
		expect(schema.parse('0')).toBe(0);
	});

	it('accepts integer grades and rejects decimal or exponential input', () => {
		expect(schema.parse('20')).toBe(20);
		for (const value of ['12.5', '12,5', '1e1', '-1', '21', 'hello']) {
			expect(schema.safeParse(value).success).toBe(false);
		}
	});

	it('does not apply grade validation to an absent student', () => {
		expect(demoGradeError('12,5', true)).toBeUndefined();
		expect(demoGradeError('12,5', false)).toBeDefined();
	});

	it('provides a French recovery message and clears it for a valid integer', () => {
		for (const value of ['12.5', '12,5']) {
			expect(demoGradeError(value, false)).toMatch(/note entière entre 0 et 20/);
		}
		expect(demoGradeError('21', false)).toMatch(/comprise entre 0 et 20/);
		expect(demoGradeError('15', false)).toBeUndefined();
	});

	it('supports a different assessment maximum without a global twenty-point limit', () => {
		expect(gradeInputSchema(100).parse('100')).toBe(100);
		expect(gradeInputSchema(10).safeParse('11').success).toBe(false);
	});
});
