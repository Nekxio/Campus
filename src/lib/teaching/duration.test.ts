import { describe, expect, it } from 'vitest';
import { formatDurationSeconds, formatDurationInput, parseDurationInput } from './duration.js';

describe('readable teaching durations', () => {
	it.each([
		[0, '0 s'],
		[1, '1 s'],
		[59, '59 s'],
		[60, '60 s'],
		[61, '1 min 1 s'],
		[90, '1 min 30 s'],
		[120, '2 min'],
		[600, '10 min'],
		[3600, '60 min'],
		[14400, '240 min']
	])('formats %s seconds as %s', (seconds, expected) => {
		expect(formatDurationSeconds(seconds)).toBe(expected);
	});

	it('never displays a negative countdown or hides a remaining fraction of a second', () => {
		expect(formatDurationSeconds(-1)).toBe('0 s');
		expect(formatDurationSeconds(0.1)).toBe('1 s');
		expect(formatDurationSeconds(60.1)).toBe('1 min 1 s');
	});

	it('keeps missing or invalid durations distinct from an elapsed timer', () => {
		for (const value of [null, undefined, NaN, Infinity]) {
			expect(formatDurationSeconds(value)).toBe('N/D');
		}
	});
});

describe('quiz duration input', () => {
	it.each([
		[30, '0:30'],
		[60, '1:00'],
		[90, '1:30'],
		[14400, '240:00'],
		[61, '1:01']
	])('formats %s as %s without rounding stored values', (seconds, text) => {
		expect(formatDurationInput(seconds)).toBe(text);
	});
	it.each([
		['0:30', 30],
		['1:00', 60],
		['1:30', 90],
		['2', 120],
		['240:00', 14400]
	])('converts %s to %s seconds', (text, seconds) => {
		expect(parseDurationInput(text)).toBe(seconds);
	});
	it.each(['', '0:00', '0:29', '1:15', '1:60', '240:30', '-1', '1.5', 'abc'])(
		'rejects invalid or off-step duration %s',
		(text) => {
			expect(parseDurationInput(text)).toBeNull();
		}
	);
});
