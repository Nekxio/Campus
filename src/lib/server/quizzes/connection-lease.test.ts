import { describe, expect, it } from 'vitest';
import { maxQuizConnectionLifetime as lifetime, readQuizConnectionExpiry } from './connection-lease.js';
const now = 1_000_000;
const headers = (issued: number, expiry: number) =>
	new Headers({
		'x-campus-quiz-issued-at': String(issued),
		'x-campus-quiz-expires-at': String(expiry)
	});
describe('internal quiz lease clocks', () => {
	it('accepts either direction of clock skew without extending either expiry bound', () => {
		for (const skew of [-60_000, -1, 0, 1, 60_000]) {
			const expiry = now + skew + lifetime;
			expect(readQuizConnectionExpiry(headers(now + skew, expiry), now)).toBe(Math.min(expiry, now + lifetime));
		}
	});
	it('rejects expired, malformed, missing and overlong issued leases', () => {
		for (const input of [
			headers(now - 1, now),
			headers(now, now),
			headers(now, now + lifetime + 1),
			headers(NaN, now + 1),
			headers(-1, now + 1),
			headers(now, Infinity),
			new Headers()
		])
			expect(readQuizConnectionExpiry(input, now)).toBeNull();
	});
	it('never renews a lease on receipt or accepts an already expired session', () => {
		const input = headers(now, now + 1000);
		expect(readQuizConnectionExpiry(input, now + 999)).toBe(now + 1000);
		expect(readQuizConnectionExpiry(input, now + 1000)).toBeNull();
	});
});
