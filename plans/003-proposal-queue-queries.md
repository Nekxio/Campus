# Plan 003: Load proposal queue titles without a full rubric per row

> Run each verification gate and keep selection/decision access checks intact.
> First run `git diff --stat e0adfff..HEAD -- src/lib/server/teaching/proposals.ts src/lib/server/teaching/proposals.test.ts` and compare `plans/baseline.json`.
> Compare the excerpts because much of this source was untracked when planned.

## Status

- Priority: P2
- Effort: S
- Risk: LOW; preserve queue scope and retired-title fallback
- Depends on: none
- Category: perf
- Planned at: commit `e0adfff`, 2026-10-13, including uncommitted source
- Audit finding: 3

## Why this matters

The queue needs titles and identities, but loads an entire rubric for every proposal.
A local in-memory query logger observed 26 SQL statements for one proposal and 103 for twelve
proposals on the same module: seven extra statements per row. Production latency was not measured.
Read only queue metadata in the queue query, leaving complete private correction/rubric reads for
the selected proposal.

## Current state

`src/lib/server/teaching/proposals.ts:194` contains:

```ts
const queue = await Promise.all(
	rows.map(async ({ proposal: p, student, context }) => {
		const rubric = await getRubric(db, context.moduleId);
		// assessmentTitle uses rubric.assessments.find(...), or 'Évaluation retirée'.
		// moduleTitle uses rubric.module.title.
	})
);
```

The preceding query joins proposals, students and teaching contexts. It filters active contexts,
optional contextId, and proposals whose points OR comment decision is pending. It orders by
createdAt then proposal ID. `getRubric` performs up to seven SELECTs for module, assessments,
results, contexts, groups, lines and deadlines. `selection(db, chosen)` subsequently loads the
selected proposal with complete validation. Explicit IDs can select already-decided proposals.

Test exemplar `src/lib/server/teaching/proposals.test.ts` uses local migrated fixtures and calls
`createCorrectionProposal` with stable request/proposal IDs and current baselines. Preserve that
pattern; a proposal never overwrites scores until a teacher decides. Comments and points have
separate decisions, legacy proposals cannot be accepted, and retired assessments remain viewable
or refusible through existing handling.

## Commands you will need

| Purpose                           | Command                                                                                                  | Expected              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------- |
| Targeted tests                    | `pnpm test:unit --run src/lib/server/teaching/proposals.test.ts src/lib/server/teaching/grading.test.ts` | All pass              |
| Types / lint / full suite / build | `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build`                                                     | Exit 0                |
| Check removed loop                | `rg -n 'getRubric\(db, context.moduleId\)' src/lib/server/teaching/proposals.ts`                         | No per-queue-row call |

Format explicit changed files before final gates. Dependencies are installed already.

## Scope

In scope: `src/lib/server/teaching/proposals.ts`,
`src/lib/server/teaching/proposals.test.ts`, and this plan's status row.
Out of scope: `getRubric` internals, schemas/migrations, proposal decision services, API payload
shapes, UI, pagination, global caches, grade calculation and annual purge.

## Git workflow

Preserve pending work and the saved `wip/database-auth` branch. Use GitButler for mutations only
when requested; no automatic commits, pushes, merges or snapshot application. An executor dispatch
uses an isolated checkout. Match tabs/single quotes/no trailing commas/100 columns and `.js` imports.

## Steps

### Step 1: Characterize queue behavior and query count

Create one and twelve pending proposals on the same fictional module, plus a second module/context.
Capture SQL using a test-local Drizzle logger without adding logging to production `createDatabase`.
The installed `drizzle(client, { schema, logger })` can be used only in the test setup.
Count SELECT statements during `getProposalReview`, excluding fixture setup. Fix proposal timestamps
or compare explicit expected ordering so the test does not depend on concurrent insertion timing.

Verify: targeted tests preserve ordering, comment-only pending rows, context isolation and removed
assessment fallback. Record the before-change count; its increase must reveal the seven-per-row
pattern. Do not assert absolute historical total 26 because selected-proposal reads may evolve.

### Step 2: Join only the titles needed by the queue

Import `modules` and `assessments` from the schema. Add the module title to the queue query and a
LEFT JOIN for the assessment title, scoped by both `assessmentId` from the proposal payload and
`context.moduleId`, and restricted to active assessments. Payload is persisted JSON: use the
existing database JSON representation with parameter-safe Drizzle SQL, never string interpolation
from input. Read its shape/types first. If a safe JSON extraction cannot be typed clearly, use
one additional batched title query for all distinct scoped assessment IDs and a request-local Map.
That is an acceptable fallback; do not load full rubrics or use a process-global cache.

Map queue rows synchronously. Missing/retired assessments must keep `Évaluation retirée`; an
assessment from another module must never supply its title. Keep the existing chosen-selection
logic and every selected-proposal access/revision check. Remove only the queue's rubric call.

Verify: targeted tests pass; the difference in SELECT count between one and twelve queue rows is
zero (at most one for a deliberately batched fallback), including twelve distinct modules.

### Step 3: Verify output equivalence and private boundaries

Assert the entire queue projection's keys/values match the original contract. No payload scores,
comments, preparation or extra student fields may be added. Test a retired assessment, an empty
queue, an explicit already-decided proposal, missing scope and context filtering. Retain rejection
of unrelated roster/context/module references in the existing suite.

Verify: no per-row rubric call, targeted tests, explicit-file formatting, lint, types, full suite
and Workers build all pass. Review only the two scoped source/test files and update the index.

## Test plan

Add query-count cases for repeated and distinct modules, plus output/fallback/scope assertions.
Prefer real in-memory database queries to mocks of `getRubric`. Count query growth rather than
latency or a brittle exact count. Existing decision, stale-reference, replay and comment tests
must still pass without modification of their expectations.

## Privacy and French/EU requirements

Minimize private reads and serialization; do not introduce cross-request caching of rosters or
corrections. Use fictional fixtures and no production query logs. Keep teacher authorization,
private/no-store responses and purgeable proposal/decision records. This implements data
minimization and confidentiality, RGPD Articles 5 and 25; see the
[CNIL principles](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre2).
Operator confirmed individual use under his responsibility. No real records or provider accounts
are needed; remaining operational questions are in `plans/PRIVACY.md`.

## Done criteria

- [x] Queue SELECT count does not grow with the number of rows for these test fixtures.
- [x] Titles/fallback, queue order, pending filters and exact selection are preserved.
- [x] No new private fields or cross-request cache were introduced.
- [x] Tests, formatting/lint, types and Workers build pass.
- [x] Scope respected and the index row updated with query-count evidence.

## STOP conditions

Stop on unexplained drift, repeated gate failures, an out-of-scope requirement, a missing module
that changes the current fail-closed behavior, or an unscoped assessment-title join. Do not
silently turn malformed/legacy proposal payloads into accepted proposals to make the query work.

## Maintenance notes

Changes to persisted proposal payload versions must preserve title extraction and legacy handling.
Keep the count tests around selected-proposal reads so future growth is attributed correctly.
Database-index and batched-write improvements remain separate until measurements justify them.
