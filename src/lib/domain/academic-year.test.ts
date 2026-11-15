import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentAcademicYear } from './academic-year.js';

describe('current academic year in Paris', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it.each(['UTC', 'America/Los_Angeles', 'Asia/Tokyo'])(
		'uses the Paris September boundary when the runtime time zone is %s',
		async (timeZone) => {
			vi.stubEnv('TZ', timeZone);
			vi.resetModules();
			const { currentAcademicYear } = await import('./academic-year.js');
			expect(currentAcademicYear(new Date('2026-08-31T21:59:59.999Z'))).toBe('2025-2026');
			expect(currentAcademicYear(new Date('2026-08-31T22:00:00.000Z'))).toBe('2026-2027');
		}
	);

	it.each([
		['2026-08-31T21:59:59.999Z', '2025-2026'],
		['2026-08-31T22:00:00.000Z', '2026-2027'],
		['2027-01-15T12:00:00.000Z', '2026-2027'],
		['2027-08-31T21:59:59.999Z', '2026-2027'],
		['2027-08-31T22:00:00.000Z', '2027-2028']
	])('%s gives %s', (instant, expected) => {
		expect(currentAcademicYear(new Date(instant))).toBe(expected);
	});
});
