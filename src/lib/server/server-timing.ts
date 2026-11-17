type TimingPhase = 'auth' | 'resolve' | 'data' | 'db';

type TimingEntry = { duration: number; calls: number };

export const createServerTiming = (now: () => number = () => performance.now()) => {
	const started = now();
	const entries = new Map<TimingPhase, TimingEntry>();
	const measure = async <T>(phase: TimingPhase, operation: () => Promise<T>): Promise<T> => {
		const start = now();
		try {
			return await operation();
		} finally {
			const entry = entries.get(phase) ?? { duration: 0, calls: 0 };
			entry.duration += Math.max(0, now() - start);
			entry.calls += 1;
			entries.set(phase, entry);
		}
	};
	const header = () =>
		[
			`app;dur=${Math.max(0, now() - started).toFixed(1)}`,
			...Array.from(
				entries,
				([phase, entry]) =>
					`${phase};dur=${entry.duration.toFixed(1)}` + (phase === 'db' ? `;desc="${entry.calls} calls"` : '')
			)
		].join(', ');
	return { measure, header };
};

export type ServerTiming = ReturnType<typeof createServerTiming>;

export const measureServerTiming = <T>(
	timing: ServerTiming | undefined,
	phase: TimingPhase,
	operation: () => Promise<T>
): Promise<T> => (timing ? timing.measure(phase, operation) : operation());
