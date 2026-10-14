import type { Client } from '@libsql/client/web';

// Authentication security metadata only: retain buckets for one hour, then drain on requests.
// Better Auth 1.7.7 defaults/special rules use 10/60 seconds; Coursely and activation use 60.
// Passkey/API-key plugins add no custom-storage windows; the separate API-key quota is 60s.
// Recheck every new plugin/rule. Never store a window reaching this shared cleanup horizon.
export const rateLimitRetentionMs = 60 * 60 * 1000;
const cleanupBatchSize = 100;

export async function consumeRateLimit(
	client: Client,
	key: string,
	rule: { window: number; max: number },
	now = Date.now()
) {
	if (
		!Number.isFinite(rule.window) ||
		rule.window <= 0 ||
		rule.window * 1000 >= rateLimitRetentionMs
	)
		throw new RangeError('La fenêtre du quota doit être positive et inférieure à une heure.');
	const boundary = now - rule.window * 1000;
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
	const hashedKey = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join(
		''
	);
	const result = await client.execute({
		sql: `INSERT INTO auth_rate_limit (key, count, started_at) VALUES (?, 1, ?)
		ON CONFLICT(key) DO UPDATE SET
		count = CASE WHEN started_at <= ? THEN 1 ELSE count + 1 END,
		started_at = CASE WHEN started_at <= ? THEN excluded.started_at ELSE started_at END
		RETURNING count, started_at`,
		args: [hashedKey, now, boundary, boundary]
	});
	const row = result.rows[0];
	try {
		await client.execute({
			sql: `DELETE FROM auth_rate_limit WHERE key IN (
				SELECT key FROM auth_rate_limit WHERE started_at < ?
				ORDER BY started_at, key LIMIT ?
			)`,
			args: [now - rateLimitRetentionMs, cleanupBatchSize]
		});
	} catch {
		// Cleanup is best effort; its failure must never change the atomic quota decision.
	}
	return {
		allowed: Number(row.count) <= rule.max,
		retryAfter: Math.max(1, Math.ceil((Number(row.started_at) + rule.window * 1000 - now) / 1000))
	};
}
