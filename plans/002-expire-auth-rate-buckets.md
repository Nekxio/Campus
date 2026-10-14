# Plan 002: Bound the lifetime of persistent authentication rate-limit buckets

> Follow every step and verification gate. Preserve atomic quota consumption.
> First run `git diff --stat e0adfff..HEAD -- src/lib/server/auth/rate-limit.ts src/lib/server/auth/auth.test.ts src/lib/server/db/schema.ts` and compare `plans/baseline.json`.
> Most source was untracked when planned; verify excerpts and hashes, not HEAD alone.

## Status

- Priority: P1
- Effort: M
- Risk: MED; pruning must not reopen active buckets
- Depends on: none
- Category: security
- Planned at: commit `e0adfff`, 2026-10-13, including the uncommitted workspace
- Audit finding: 2

## Why this matters

The authentication limiter persists one hashed bucket for each client/path key and never removes
expired entries. The installed Better Auth invokes this custom storage before route matching;
three fictional unknown auth routes returned 404 but created three permanent rows in a local
probe. This is a storage/availability issue, not an authorization bypass. Retain the shared
database limiter because per-process memory is unsuitable for independent Workers.

## Current state

`src/lib/server/auth/rate-limit.ts:15` atomically consumes a bucket:

```sql
INSERT INTO auth_rate_limit (key, count, started_at) VALUES (?, 1, ?)
ON CONFLICT(key) DO UPDATE SET
count = CASE WHEN started_at <= ? THEN 1 ELSE count + 1 END,
started_at = CASE WHEN started_at <= ? THEN excluded.started_at ELSE started_at END
RETURNING count, started_at
```

`src/lib/server/auth.ts:62` configures `window: 60`, `max: 30` and
`customStorage: { consume: (key, rule) => consumeRateLimit(client, key, rule) }`.
Activation directly calls the same helper with window 60/max 10. Better Auth plugins can supply
different windows. Installed `better-auth/dist/api/rate-limiter/index.mjs` selects custom storage
before its built-in database-pruning implementation, so that pruning does not apply here.

`src/lib/server/db/schema.ts:7` defines only key/count/startedAt; no expiry index exists.
The hashing already prevents storing the literal IP/path key, but a deterministic hash is not
automatically anonymous data. `src/lib/server/auth/auth.test.ts:320` is the test exemplar:

```ts
const responses = await Promise.all(
	Array.from({ length: 8 }, () => consumeRateLimit(client, 'same-client', rule, now))
);
expect(responses.filter((response) => response.allowed)).toHaveLength(3);
```

These tests migrate an in-memory database and use invented addresses. Authentication remains
teacher-only, invitations single-use/24h, sessions eight hours, passkeys with device verification.

## Commands you will need

| Purpose                                        | Command                                                                                      | Expected                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------ |
| Focused tests                                  | `pnpm test:unit --run src/lib/server/auth/auth.test.ts src/lib/server/db/foundation.test.ts` | All pass                             |
| Offline migration generation, only if required | `pnpm db:generate`                                                                           | A new migration; no cloud connection |
| Types / lint / suite / build                   | `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build`                                         | Exit 0                               |
| Read installed version                         | `pnpm list better-auth --depth 0`                                                            | 1.7.7 at planning time               |

Format only changed files using `pnpm exec prettier --write <explicit paths>` before final gates.
Do not run `pnpm db:migrate`, invitation/key operators or any command that loads `.env`.

## Suggested executor toolkit

Read the repository's `better-auth-best-practices` and `better-auth-security-best-practices`
skills. Their older `get/set` examples are not compatible with the installed API; retain atomic
`consume`. Use the installed types and [Better Auth 1.7.7 rate-limit documentation](https://better-auth.com/docs/concepts/rate-limit).
Never transmit private code or data to documentation services.

## Scope

In scope:

- `src/lib/server/auth/rate-limit.ts`
- `src/lib/server/auth/rate-limit.test.ts` (new isolated tests)
- `src/lib/server/auth/auth.test.ts`
- `src/lib/server/db/schema.ts`, only a cleanup index if justified
- A newly generated migration and its generated metadata under `drizzle/`, if needed
- This plan's index row

Out of scope: auth endpoint allowlists, teacher/student records, existing migrations, new Redis/KV
services, IP tracking policies, session configuration and Cloudflare settings. Route allowlisting
is a deferred option because duplicating plugin route registries can break legitimate endpoints.

## Git workflow

Keep pending work intact. Branch/commit mutations use GitButler (`but status` first) only when
requested; no automatic commit, push, merge or snapshot application. An `execute` dispatch uses an
isolated checkout. Follow tabs/single quotes/no trailing commas/100 columns and `.js` imports.

## Steps

### Step 1: Define expiry safety from the actual windows

Inventory the installed Better Auth default/plugin/custom windows and activation's explicit
window. Introduce a documented retention horizon that is greater than every supported active
window, for example one hour when the verified maximum is at most one minute. Guard helper calls
with a longer rule: do not prune using an unsafe shorter horizon. Record the selected operational
lifetime as security metadata retention, not student-grade retention.

Verify: `rg -n 'window:|timeWindow:|customRules|rateLimit' src/lib/server/auth.ts src/routes/api/activation node_modules/better-auth/dist/api/rate-limiter node_modules/@better-auth/passkey/dist`
and focused tests. Every discovered active window must fit within the documented horizon.
If they do not, stop and revise this plan rather than prune active rows.

### Step 2: Add bounded cleanup beside atomic consumption

Keep the existing upsert and allowed/retryAfter results authoritative. Add parameterized deletion
of expired rows using `started_at` and the safe horizon, limited to a fixed batch (for example
100 keys). Use a primary-key subquery with a deterministic order and add an index on
`started_at` if the query otherwise scans the entire table. Start with one bounded cleanup per
consumption: no process-global state, timers or unawaited promises on Workers. Cleanup exceptions
must not turn a rejected quota into an allowed request. Do not log bucket keys or addresses.

Verify: `pnpm test:unit --run src/lib/server/auth/rate-limit.test.ts` passes expiry, active-bucket,
boundary and bounded-batch tests. If an index is added, generate a new migration offline and
verify the test migrations apply from an empty in-memory database. Never edit `0000_foundation.sql`.

### Step 3: Prove concurrent quotas and bounded historical retention

Reuse the existing concurrency test with the injected `now` argument. Create synthetic expired
keys and active keys, consume at controlled instants, and assert the batch maximum, surviving
active quota and eventual removal over repeated calls. Exercise an unknown auth path through
`auth.handler`: it may still create one temporary bucket, but that bucket must expire through
the normal cleanup path. Verify cleanup does not include session or student tables.

Verify: focused tests pass, then `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build` after
formatting explicit files. Inspect the generated migration if any; it must contain only the index.

## Test plan

At least six new cases: expired deletion, active preservation, exact cutoff, bounded batch,
eventual drain and a longer unsupported window refusing unsafe cleanup. Retain concurrent
consumption/reset coverage and add cleanup-failure behavior. In-memory fixture databases only;
use the real Better Auth handler for one integration test rather than mocking its route order.

## Privacy and French/EU requirements

Purpose is protecting authentication. Store only hashed bucket/count/time metadata and remove
it when no longer needed; do not create a security event archive or reuse it for profiling.
RGPD Article 5 covers storage limitation; Article 32 covers security appropriate to risk.
See the [CNIL principles](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre2)
and [security text](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre4).
The selected short technical horizon is a product choice, not a statutory retention period.
Operator confirmed individual responsibility; no real student data is needed for this change.

## Done criteria

- [x] Expired buckets disappear through a bounded, indexed operation when an index is needed.
- [x] Concurrent callers receive exactly the permitted number of approvals.
- [x] Longer windows cannot be pruned prematurely; cleanup errors never fail open.
- [x] Fresh in-memory migrations and all verification gates pass.
- [x] No unrelated records, existing migration or infrastructure settings changed.
- [x] Index row updated with results and the retention horizon.

## STOP conditions

Stop on unexplained drift, two repeated verification failures, a required out-of-scope change,
an active window exceeding the horizon, or a design requiring a new cloud service. If bounded
SQL deletion is unsupported by the installed libSQL driver, report the failed statement/feature
without changing database architecture. Never test deletion against Turso or existing local data.

## Maintenance notes

Any new auth plugin or quota rule must be checked against the retention horizon. Review its
indexed query plan and batch work if auth traffic increases; do not replace atomic consumption
with separate reads and writes. Generated migrations remain unapplied until an operator runs them.
