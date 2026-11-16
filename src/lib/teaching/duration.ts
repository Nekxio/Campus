export const formatDurationSeconds = (seconds: number | null | undefined): string => {
	if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return 'N/D';
	const totalSeconds = Math.max(0, Math.ceil(seconds));
	if (totalSeconds <= 60) return `${totalSeconds} s`;
	const minutes = Math.floor(totalSeconds / 60);
	const remainder = totalSeconds % 60;
	return `${minutes} min${remainder ? ` ${remainder} s` : ''}`;
};

export const formatDurationInput = (seconds: number): string =>
	`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export const parseDurationInput = (value: string): number | null => {
	const match = /^(\d{1,3})(?::([0-5]\d))?$/.exec(value.trim());
	if (!match) return null;
	const seconds = Number(match[1]) * 60 + Number(match[2] ?? 0);
	return seconds >= 30 && seconds <= 14400 && seconds % 30 === 0 ? seconds : null;
};
