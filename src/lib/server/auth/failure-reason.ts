import { isAPIError } from 'better-auth/api';

const privateFailureCodes = new Set([
	'SQLITE_ERROR',
	'SQLITE_AUTH',
	'SQLITE_PERM',
	'SQLITE_READONLY',
	'SQLITE_CANTOPEN',
	'SQLITE_BUSY',
	'SQLITE_LOCKED',
	'SQLITE_CONSTRAINT',
	'SQLITE_CONSTRAINT_CHECK',
	'SQLITE_CONSTRAINT_FOREIGNKEY',
	'SQLITE_CONSTRAINT_NOTNULL',
	'SQLITE_CONSTRAINT_PRIMARYKEY',
	'SQLITE_CONSTRAINT_UNIQUE',
	'SQLITE_MISMATCH',
	'SQLITE_MISUSE',
	'SERVER_ERROR',
	'CLIENT_CLOSED',
	'FETCH_ERROR',
	'HTTP_SERVER_ERROR',
	'HTTP_CLIENT_ERROR',
	'HRANA_PROTO_ERROR',
	'HRANA_CLOSED_ERROR',
	'HRANA_WEBSOCKET_ERROR',
	'PROTOCOL_VERSION_ERROR',
	'TRANSACTION_CLOSED',
	'INTERNAL_ERROR',
	'UNKNOWN'
]);

const knownErrorNames = new Set(['Error', 'TypeError', 'RangeError', 'LibsqlError', 'DrizzleQueryError', 'ZodError']);

export const privateFailureShape = (cause: unknown) => {
	const frames: { kind: string; code: string; message: string }[] = [];
	let current = cause;
	for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
		const code = 'code' in current && typeof current.code === 'string' ? current.code : null;
		frames.push({
			kind: knownErrorNames.has(current.name) ? current.name : 'OTHER',
			code: code === null ? 'NONE' : privateFailureCodes.has(code) ? code : 'OTHER',
			message: /foreign key constraint failed/i.test(current.message)
				? 'FOREIGN_KEY'
				: /no such (?:table|column)/i.test(current.message)
					? 'SCHEMA_MISSING'
					: /transaction/i.test(current.message)
						? 'TRANSACTION'
						: 'OTHER'
		});
		current = current.cause;
	}
	return frames;
};

const missingQuizSchema = (message: string) =>
	/^SQLITE_ERROR: (?:SQLite error: )?no such table: (?:main\.)?quiz_(?:draft|draft_receipt|run|grade_report|grade_receipt)$/.test(
		message
	) ||
	/^SQLITE_ERROR: (?:SQLite error: )?no such column: quiz_run\.(?:quiz_revision|opening_fingerprint|shuffle_seed|grade_baselines)$/.test(
		message
	);

const isWorkerSubrequestLimit = (cause: unknown) => {
	let current = cause;
	for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
		if (/\btoo many subrequests\b/i.test(current.message)) return true;
		current = current.cause;
	}
	return false;
};

export const privateFailureReason = (cause: unknown): string => {
	if (isWorkerSubrequestLimit(cause)) return 'WORKER_SUBREQUEST_LIMIT';
	let current = cause;
	let typeError = false;
	let rateLimitFailure = false;
	for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
		if (/\bno such table: (?:main\.)?auth_rate_limit\b/.test(current.message)) return 'AUTH_RATE_LIMIT_SCHEMA_MISSING';
		if (
			rateLimitFailure &&
			'code' in current &&
			typeof current.code === 'string' &&
			['JWT_EXPIRED', 'JWT_INVALID', 'AUTH_TOKEN_EXPIRED', 'AUTH_TOKEN_INVALID'].includes(current.code)
		)
			return 'DATABASE_AUTH';
		if (rateLimitFailure && 'status' in current && (current.status === 401 || current.status === 403))
			return 'DATABASE_AUTH';
		if (current.name === 'TypeError') typeError = true;
		if (current.message === 'CAMPUS_RATE_LIMIT_FAILED') rateLimitFailure = true;
		if ('code' in current && typeof current.code === 'string' && privateFailureCodes.has(current.code)) {
			if (current.code === 'SQLITE_ERROR' && missingQuizSchema(current.message)) return 'QUIZ_SCHEMA_MISSING';
			return current.code;
		}
		if (isAPIError(current)) {
			if (current.statusCode === 403) return 'AUTH_FORBIDDEN';
			if (current.body?.code === 'FAILED_TO_GET_SESSION') return 'AUTH_SESSION_HANDLER';
		}
		if (current.message.startsWith('Failed to decrypt private key.')) return 'SIGNING_KEY_DECRYPTION';
		if (current.name === 'AbortError' || current.name === 'TimeoutError') return 'TIMEOUT';
		current = current.cause;
	}
	return typeError ? 'TYPE_ERROR' : rateLimitFailure ? 'AUTH_RATE_LIMIT' : 'UNCLASSIFIED';
};
