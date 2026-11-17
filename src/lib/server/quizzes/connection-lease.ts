export const maxQuizConnectionLifetime = 8 * 60 * 60 * 1000;

// Internal gateway headers only. Compare the issued duration on one clock, then
// cap the receiver's lease without ever extending the gateway's absolute expiry.
export const readQuizConnectionExpiry = (headers: Headers, now: number): number | null => {
	const rawExpiry = headers.get('x-campus-quiz-expires-at');
	const rawIssued = headers.get('x-campus-quiz-issued-at');
	if (!rawExpiry || !rawIssued) return null;
	const expiresAt = Number(rawExpiry);
	const issuedAt = Number(rawIssued);
	if (
		!Number.isSafeInteger(expiresAt) ||
		!Number.isSafeInteger(issuedAt) ||
		issuedAt < 0 ||
		expiresAt <= now ||
		expiresAt <= issuedAt ||
		expiresAt - issuedAt > maxQuizConnectionLifetime
	)
		return null;
	return Math.min(expiresAt, now + maxQuizConnectionLifetime);
};
