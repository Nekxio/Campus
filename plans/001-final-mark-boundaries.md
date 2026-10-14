# Plan 001: Export mathematically valid final marks at the /20 boundary

> Follow the steps and verification gates in order. Do not implement another plan implicitly.
> Update this plan's row in `plans/README.md` when verified, or record the blocking condition.
> First run `git diff --stat e0adfff..HEAD -- src/lib/domain/grade-calculation.ts src/lib/domain/grade-export.ts src/lib/domain/grade-calculation.test.ts src/lib/domain/grade-export.test.ts src/lib/server/teaching/grade-export.test.ts`.
> These files were largely untracked at planning time: also compare their hashes with
> `plans/baseline.json`. Git history alone cannot detect drift in this workspace.

## Status

- Priority: P1
- Effort: S, including regression tests
- Risk: LOW; normalize numerical noise without changing stored scores
- Depends on: none
- Category: bug
- Planned at: commit `e0adfff`, 2026-10-13, including the uncommitted workspace
- Audit finding: 1

## Why this matters

A perfect score with valid integer weights `[3, 79, 18]` produces
`20.000000000000004`. The calculation reports complete, the grid enables export, and the strict
export schema rejects the mark. One such student blocks the entire class PDF. Decimal weights
`[0.5, 79.8, 19.7]` reproduce the same failure. Fix only numerical boundary noise; intermediate
precision, raw criterion scores and the teacher's grading rules must remain intact.

## Current state

`src/lib/domain/grade-calculation.ts:166` accumulates and returns the weighted mark:

```ts
total += (((20 * points) / maximum) * component.weight) / 100;
// After the component loop:
return { ...base, state: 'ready', mark: total, rawMark: total };
```

`src/lib/domain/grading.ts:100` and `calculateResult` both accept coefficient totals within
`1e-8` of 100. `src/lib/domain/grade-export.ts:16` uses:

```ts
marks: z.array(z.number().finite().min(0).max(20)).min(1).max(100);
```

`gradeExportStatus` uses `calculateStudent.complete`; `projectFinalGradeExport` parses all final
marks through that schema. The server export service rereads saved results in one transaction.
Its route turns an unexpected schema exception into HTTP 503. No provisional or partial PDF exists.

Use `src/lib/domain/grade-export.test.ts` as the domain-test pattern. Service tests in
`src/lib/server/teaching/grade-export.test.ts` use this isolated setup:

```ts
client = createClient({ url: ':memory:' });
db = createDatabase(client);
await migrate(db, { migrationsFolder: './drizzle' });
ids = await seedGradingFixtures(db);
```

Vocabulary: criterion points are recorded integers; a result is calculated from those points.
`docs/grade-export.md` requires full calculation precision and final one-decimal formatting. The
export includes every student, defined results and module/class/year/date only. Absences,
criterion details, submission URLs and private comments are excluded.

## Commands you will need

| Purpose        | Command                                                                                                                                          | Expected on success                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Targeted tests | `pnpm test:unit --run src/lib/domain/grade-calculation.test.ts src/lib/domain/grade-export.test.ts src/lib/server/teaching/grade-export.test.ts` | All pass                                             |
| Types          | `pnpm check`                                                                                                                                     | Zero errors/warnings                                 |
| Lint           | `pnpm lint`                                                                                                                                      | Exit 0                                               |
| Full tests     | `pnpm test`                                                                                                                                      | All pass                                             |
| Workers build  | `pnpm build`                                                                                                                                     | Exit 0; existing lazy-PDF size advisories may remain |

Executor-only formatting: `pnpm exec prettier --write` followed by the explicit changed files.
Use installed Node 26.11.1/pnpm 12.11.2. No dependency installation is needed.

## Scope

In scope:

- `src/lib/domain/grade-calculation.ts`
- `src/lib/domain/grade-export.ts`, only if the final boundary contract needs it
- `src/lib/domain/grade-calculation.test.ts`
- `src/lib/domain/grade-export.test.ts`
- `src/lib/server/teaching/grade-export.test.ts`
- This plan's status row

Out of scope: stored corrections, rubric validation tolerance, database schemas/migrations,
PDF layout/fonts, publication, grading UI and assessment delay rules. Do not loosen the export
schema to accept arbitrary above-20 values. Do not round every intermediate mark to one decimal.

## Git workflow

Preserve all existing changes. Use `but status` and GitButler for branch/commit mutations only
when asked; do not commit, push, merge or apply `wip/database-auth` as part of this plan.
If dispatched through `improve execute`, work only in the executor's isolated checkout and
leave a reviewable diff. Match tabs, single quotes, no trailing commas, width 100 and explicit
`.js` imports. Existing commit style includes `🔧 configure linting, formatting & unit tests`.

## Steps

### Step 1: Add the failing boundary regressions

Build three synthetic graded assessments using the existing test helpers. Award each line its
maximum; define independent weighted results with both weight sets above. Assert that the rubric
accepts them, readiness is true and the final export contains a valid 20. Add an accepted near-100
sum at the existing coefficient tolerance to ensure the chosen numerical bound covers that case.

Verify: run the targeted test command. Before the fix, only the new export-boundary assertions
must fail with the reproduced above-20 validation error. Other failures mean stop and investigate.

### Step 2: Establish one narrow final-result boundary rule

In `calculateResult`, normalize only a final mark within a documented numerical tolerance of
0 or 20. Choose the tolerance from the existing accepted weight-sum error: its worst-case mark
error is approximately `20 * 1e-8 / 100`, plus floating arithmetic noise. A bound such as `1e-8`
on the final /20 mark covers this without display rounding. Document that bound and verify it.
An actually out-of-range or nonfinite final mark must not remain `ready`; report it as invalid.
Preserve `rawPoints`, stored line points and intermediate computations. Keep the strict export
schema as the authoritative serialization check; avoid a second unrelated normalization policy.

Verify: targeted tests pass, including exact 0/20 boundaries, tiny tolerated noise, genuinely
invalid above-20 input, unrounded fractional results and excessive raw criterion points.

### Step 3: Cover saved full-class export

Extend the existing migrated service test with awkward valid weights and a fully graded fictional
class. Assert all names/results survive projection, marks are within `[0, 20]`, every student is
included, and incomplete/excessive scores still block export. Reuse `replaceRubric`, `saveCorrection`
and `getFinalGradeExport`; do not bypass their contracts with direct writes for the happy path.

Verify: targeted tests, formatting of changed files, then `pnpm lint`, `pnpm check`, `pnpm test`
and `pnpm build` all succeed. Check the diff against the scope before updating the index.

## Test plan

Add at least five meaningful cases: integer weights, decimal weights, accepted coefficient-sum
tolerance, rejection outside the numerical allowance and saved full-class projection. Retain the
existing approved 15.2/14.7 examples, formative exclusion, independent results and raw-point
aggregation checks. Tests must assert exact normalization at the boundary and retained precision
away from it, rather than only `toBeCloseTo` everywhere.

## Privacy and French/EU requirements

Use invented names only. Keep the private export allowlist and teacher authorization intact; no
new logs, PDF storage or external renderer. Accuracy and minimization are required by RGPD
Article 5; relevant text is reproduced by the [CNIL](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre2).
Passing these technical tests does not settle legal basis or retention. The operator confirmed
individual use under his own responsibility; future student records remain subject to the
pre-use decisions described in `plans/PRIVACY.md`.

## Done criteria

- [x] The integer and decimal perfect-score export regressions pass.
- [x] Truly invalid raw scores still block export; no stored score is clamped.
- [x] Targeted tests, full tests, lint, types and Workers build exit 0.
- [x] Only the scoped files changed relative to the executor's starting workspace.
- [x] The index row includes DONE and verification results, or a precise blocking reason.

## STOP conditions

Stop if excerpts/hashes drift without an explained earlier-plan change; any step fails twice
after a reasonable correction; a change outside scope is necessary; or the proposed fix changes
valid non-boundary grades, penalties or stored scoring history. Do not claim completion with the
new failing regression skipped.

## Maintenance notes

Review the final tolerance whenever coefficient precision or its accepted sum tolerance changes.
Display rounding stays in `formatMark`. Archived PDFs use the same current calculation rules,
so this boundary rule must remain shared by active and archived exports.
