import { describe, expect, it } from 'vitest';
import { createServerTiming } from './server-timing.js';

const clock = () => {
	let value = 0;
	return { now: () => value, advance: (duration: number) => (value += duration) };
};

describe('Request-local server timings', () => {
	it('reports nested phases without treating them as additive totals', async () => {
		const time = clock();
		const timing = createServerTiming(time.now);
		await timing.measure('auth', async () => time.advance(10));
		const result = await timing.measure('resolve', () =>
			timing.measure('data', async () => {
				await timing.measure('db', async () => time.advance(12));
				await timing.measure('db', async () => time.advance(8));
				time.advance(5);
				return { ready: true };
			})
		);
		expect(result).toEqual({ ready: true });
		expect(timing.header()).toBe(
			'app;dur=35.0, auth;dur=10.0, db;dur=20.0;desc="2 calls", data;dur=25.0, resolve;dur=25.0'
		);
	});

	it('records failed phases without retaining exception details', async () => {
		const time = clock();
		const timing = createServerTiming(time.now);
		const cause = new Error('PRIVATE driver SQL and identifiers');
		await expect(
			timing.measure('db', async () => {
				time.advance(7);
				throw cause;
			})
		).rejects.toBe(cause);
		expect(timing.header()).toBe('app;dur=7.0, db;dur=7.0;desc="1 calls"');
	});

	it('keeps overlapping requests independent', async () => {
		const time = clock();
		const first = createServerTiming(time.now);
		let release!: () => void;
		const pending = first.measure('db', () => new Promise<void>((done) => (release = done)));
		time.advance(3);
		const second = createServerTiming(time.now);
		await second.measure('auth', async () => time.advance(4));
		expect(second.header()).toBe('app;dur=4.0, auth;dur=4.0');
		release();
		await pending;
		expect(first.header()).toBe('app;dur=7.0, db;dur=7.0;desc="1 calls"');
	});
});
