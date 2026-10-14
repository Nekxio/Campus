import { describe, expect, it } from 'vitest';
import { fromDateInput, toDateInput } from './calendar.js';
describe('Paris teaching calendar', () => {
	it('uses Paris offsets independently of the server or browser time zone', () => {
		expect(fromDateInput('2026-10-13T09:00')).toBe('2026-10-13T07:00:00.000Z');
		expect(fromDateInput('2026-12-13T09:00')).toBe('2026-12-13T08:00:00.000Z');
		expect(toDateInput('2026-10-13T07:00:00.000Z')).toBe('2026-10-13T09:00');
	});
	it('rejects nonexistent and ambiguous daylight-saving times', () => {
		expect(() => fromDateInput('2026-03-29T02:30')).toThrow();
		expect(() => fromDateInput('2026-10-25T02:30')).toThrow();
	});
});
